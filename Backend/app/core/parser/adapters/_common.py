"""Shared adapter helpers: id hygiene and name-based property inference.

The framework adapters (CrewAI/Dify/LangGraph) all face the same problem: a
concrete artefact (a tool called ``gmail.send``, an input called ``Inbound
email``) has to become a typed IR node carrying the *risk-relevant* properties
the rule engine reads. The heuristics here centralise that inference so the three
adapters stay thin and behave consistently.

Everything emitted here is expressed in the **current** IR vocabulary: typed
nodes with a ``properties`` map (spec sections 3-4) and edges whose ``capability``
is a neutral verb from ``capabilities.yaml`` (spec section 6). Sensitivity,
externality and reversibility live on node properties, never in the verb.
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Mapping
from typing import Any

from ...catalogs import default_properties
from ...ir.models import Edge, Node, NodeType
from ...ir.normalizer import capabilities_for_tool

# Descriptive properties an adapter may copy from raw YAML on top of the
# risk-relevant ones catalogued in node_properties.yaml. These are the
# uncatalogued keys the adapters already copied before the catalog-driven
# helper; they carry no safe default, so they are not in the catalog.
_EXTRA_DECLARABLE: dict[NodeType, tuple[str, ...]] = {
    NodeType.INPUT: ("source_type",),
    NodeType.TOOL: ("capability_kinds", "access_kind"),
    NodeType.DATA_ASSET: ("asset_kind",),
    NodeType.OUTPUT: ("output_kind",),
    # The two is_shared_memory() signals that have no catalog default.
    NodeType.MEMORY: ("memory_kind", "shared_with_agents"),
}

# Declarable properties whose value is a list of strings. A scalar is wrapped so
# rules do a membership test, not a substring match over a string.
_LIST_PROPERTIES = {"capability_kinds", "shared_with_agents"}

# Declaring one of these verbs on a tool means it publishes or moves something
# out of the system: a side effect that can't simply be undone. FH-032 keys on
# side_effect_reversible, which otherwise keeps its reversible default.
_IRREVERSIBLE_VERBS = {"deployRelease", "moveResource"}

# output_kind of the destination a deployRelease/moveResource tool writes to.
DEPLOYMENT_TARGET = "deployment_target"

# How close an unknown key must be to a declarable property to be reported as
# a likely typo. Framework files carry many native keys (backstory, desc,
# model...); only near-misses of a property name are worth a warning.
_TYPO_CUTOFF = 0.85


def slugify(value: str) -> str:
    """Lowercase, collapse non-alphanumerics to underscores, trim."""
    return re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_") or "item"


def as_list(value: Any) -> list[Any]:
    """Coerce a scalar/None/list into a list (None -> [])."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def declarable_properties(node_type: NodeType) -> set[str]:
    """Property names a framework file may declare for a node of this type.

    Every property catalogued for the type in ``node_properties.yaml`` plus the
    few descriptive extras above. Deriving the set from the catalog means a new
    catalogued property is accepted by every adapter without touching them.
    """
    return set(default_properties(node_type.value)) | set(_EXTRA_DECLARABLE.get(node_type, ()))


def apply_declared_properties(props: dict[str, Any], raw: Any, node_type: NodeType) -> None:
    """Copy the declarable properties present in ``raw`` onto ``props``.

    Declared values win over inferred ones. Unknown keys are ignored so a
    structural key (``tools``, ``inputs``...) or a typo cannot clobber a derived
    property; ``ignored_declarations`` reports the likely mistakes among them.
    List-valued properties are coerced to a list of strings.
    """
    if not isinstance(raw, Mapping):
        return
    list_keys = _LIST_PROPERTIES | {
        key for key, value in default_properties(node_type.value).items() if isinstance(value, list)
    }
    for key in declarable_properties(node_type):
        value = raw.get(key)
        # An explicit null reads as "not declared": keep the inferred value.
        if value is None:
            continue
        props[key] = [str(v) for v in as_list(value)] if key in list_keys else value

    if node_type == NodeType.TOOL and _IRREVERSIBLE_VERBS & set(as_list(raw.get("capability_kinds"))):
        for key, implied in (("side_effect", True), ("side_effect_reversible", False)):
            if raw.get(key) is None:
                props[key] = implied


def ignored_declarations(raw: Any, node_type: NodeType) -> list[dict[str, Any]]:
    """Keys in ``raw`` that look like a property declaration but are dropped.

    Two cases are reported, each as ``{property, suggestion}``:

    - a catalogued property of another node type (``suggestion`` is None), and
    - a near-miss of a property this node type accepts, i.e. a likely typo
      (``suggestion`` is the property it resembles).

    Every other unknown key is taken to be the framework's own (``backstory``,
    ``title``, ``tools``...) and stays silent.
    """
    if not isinstance(raw, Mapping):
        return []
    accepted = declarable_properties(node_type)
    elsewhere = set().union(*(declarable_properties(t) for t in NodeType if t != node_type)) - accepted
    ignored: list[dict[str, Any]] = []
    for key in raw:
        key = str(key)
        if key in accepted:
            continue
        if key in elsewhere:
            ignored.append({"property": key, "suggestion": None})
            continue
        close = difflib.get_close_matches(key, accepted, n=1, cutoff=_TYPO_CUTOFF)
        if close:
            ignored.append({"property": key, "suggestion": close[0]})
    return ignored


def ignored_property_warning(node_type: NodeType, name: str, item: dict[str, Any]) -> dict[str, Any]:
    """The ``warnings[]`` entry for one ``ignored_declarations`` item."""
    key, suggestion = item["property"], item["suggestion"]
    if suggestion:
        message = f"`{key}` on {node_type.value} '{name}' is not a known property and was ignored; did you mean `{suggestion}`?"
    else:
        message = f"`{key}` is not read on {node_type.value} nodes, so it was ignored on '{name}'."
    return {
        "kind": "ignored_property",
        "rules": [],
        "message": message,
        "properties": [key],
        "node": name,
        "node_type": node_type.value,
        "suggestion": suggestion,
    }


class IdFactory:
    """Hands out unique, type-prefixed node ids and remembers what it created.

    Repeated names collide by design (the same asset referenced twice is one
    node); a genuinely new name that slugs to an existing id gets a numeric
    suffix so two different artefacts never share an id.
    """

    _PREFIX = {
        NodeType.INPUT: "input",
        NodeType.AGENT: "agent",
        NodeType.TOOL: "tool",
        NodeType.DATA_ASSET: "asset",
        NodeType.OUTPUT: "output",
        NodeType.MEMORY: "memory",
        NodeType.CONTROL: "control",
    }

    def __init__(self) -> None:
        self._used: set[str] = set()
        # (type, normalised name) -> id, so a re-reference to the same artefact
        # returns the same id and de-duplicates into one node.
        self._by_name: dict[tuple[NodeType, str], str] = {}

    def make(self, node_type: NodeType, name: str) -> str:
        key = (node_type, str(name).strip().casefold())
        existing = self._by_name.get(key)
        if existing is not None:
            return existing
        base = f"{self._PREFIX[node_type]}_{slugify(name)}"
        candidate = base
        suffix = 2
        while candidate in self._used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        self._used.add(candidate)
        self._by_name[key] = candidate
        return candidate


# --- capability-verb kinds used to route a tool's "effect" edge -------------
# Precedence matters: an executor tool that also sends is treated as executing.
_EFFECT_PRECEDENCE = [
    "executeCode",
    "deleteResource",
    # Only ever present when declared via capability_kinds: no tool name maps
    # to them. Routed to an external destination so FH-012 can see the hop.
    "deployRelease",
    "moveResource",
    "modifyResource",
    "createResource",
    "send",
    "fetchWeb",
    "search",
    "extractInformation",
    "read",
]


def _keyword_capabilities(name: str) -> list[str]:
    """Keyword fallback when the concrete tool name is not in the catalog map."""
    lowered = name.lower()

    def has(*tokens: str) -> bool:
        return any(token in lowered for token in tokens)

    if has("delete", "remove", "drop", "purge"):
        return ["deleteResource", "invokeTool"]
    if has("update", "modify", "edit", "patch", "overwrite"):
        return ["modifyResource", "invokeTool"]
    if has("create", "insert", "add", "schedule"):
        return ["createResource", "invokeTool"]
    if has("python", "shell", "bash", "exec", "code", "run", "interpreter"):
        return ["executeCode"]
    if has("fetch", "visit", "browser", "scrape", "crawl", "linkedin", "requests.get"):
        return ["fetchWeb"]
    if has("send", "email", "smtp", "gmail", "slack", "webhook", "notify", "post"):
        return ["send", "invokeTool"]
    if has("search", "query", "lookup"):
        return ["read", "search"]
    if has("parse", "extract"):
        return ["read", "extractInformation"]
    if has("read", "drive", "doc", "db", "database", "crm", "ats", "knowledge", "file"):
        return ["read"]
    return ["invokeTool"]


def infer_tool_capabilities(name: str) -> list[str]:
    """Concrete tool name -> generic capability verbs (spec section 6).

    Prefers the catalog map in the normalizer; falls back to keyword heuristics
    when the name is unknown (the map returns the bare ``["invokeTool"]``).
    """
    mapped = capabilities_for_tool(name)
    if mapped != ["invokeTool"]:
        return mapped
    return _keyword_capabilities(name)


def _primary_effect(capabilities: list[str]) -> str:
    for verb in _EFFECT_PRECEDENCE:
        if verb in capabilities:
            return verb
    return "invokeTool"


def infer_tool_properties(name: str) -> dict[str, Any]:
    """Build a tool node's risk properties from its name (spec section 6).

    ``requires_approval`` and ``sandbox_enabled`` default false/false so an
    unconstrained tool reads as dangerous; a mutating/destructive tool defaults
    to irreversible. Adapters override these from explicit YAML fields.
    """
    capabilities = infer_tool_capabilities(name)
    effect = _primary_effect(capabilities)

    external = effect in {"send", "fetchWeb"}
    mutating = effect in {"modifyResource", "deleteResource", "createResource"}
    executes = effect == "executeCode"
    side_effect = external or mutating or executes

    operation_kind = {
        "send": "send",
        "fetchWeb": "fetch",
        "modifyResource": "modify",
        "deleteResource": "delete",
        "createResource": "create",
        "executeCode": "execute",
        "read": "read",
        "search": "read",
        "extractInformation": "read",
    }.get(effect, "invoke")

    return {
        "capability_kinds": capabilities,
        "operation_kind": operation_kind,
        "target_boundary": "external" if external else "internal",
        "access_kind": "external_send" if effect == "send" else (
            "external_call" if effect == "fetchWeb" else "internal_read"
        ),
        "side_effect": side_effect,
        # Destructive/mutating changes and code execution are assumed irreversible
        # unless the source states otherwise; a plain send is not "reversible" in a
        # meaningful sense but is not destructive either, so we keep it true.
        "side_effect_reversible": not (mutating or executes),
        "requires_approval": False,
        "sandbox_enabled": False,
        "allowlist_present": False,
        "audit_logging_enabled": False,
    }


def infer_input_properties(name: str) -> dict[str, Any]:
    """Any externally-sourced input is untrusted by default (spec section 4.2)."""
    lowered = name.lower()
    if "email" in lowered:
        source_type = "external_email"
    elif "attachment" in lowered:
        source_type = "attachment"
    elif "webhook" in lowered:
        source_type = "webhook"
    elif "form" in lowered:
        source_type = "web_form"
    else:
        source_type = "user_input"
    return {"trust_level": "untrusted", "source_type": source_type, "content_types": []}


def infer_asset_properties(name: str) -> dict[str, Any]:
    """Infer a data asset's sensitivity/kind from its name."""
    lowered = name.lower()
    if any(t in lowered for t in ("drive", "folder")):
        return {"sensitivity": "high", "boundary": "internal", "contains_pii": True, "asset_kind": "drive_folder"}
    if any(t in lowered for t in ("db", "database", "crm", "ats", "record")):
        return {"sensitivity": "high", "boundary": "internal", "contains_pii": True, "asset_kind": "database"}
    if any(t in lowered for t in ("calendar", "schedule")):
        return {"sensitivity": "medium", "boundary": "internal", "contains_pii": False, "asset_kind": "calendar"}
    return {"sensitivity": "medium", "boundary": "internal", "contains_pii": False, "asset_kind": "knowledge_base"}


def infer_output_properties(name: str, *, external: bool | None = None) -> dict[str, Any]:
    """Infer an output sink's boundary. External reach is the cautious default."""
    lowered = name.lower()
    if external is None:
        external = any(t in lowered for t in ("email", "webhook", "http", "slack", "external", "send"))
    return {
        "boundary": "external" if external else "internal",
        "approval_gate_present": False,
        "side_effect": True,
        "output_kind": "external_action" if external else "chat_response",
    }


def infer_control_kind(name: str) -> str:
    lowered = name.lower()
    if "approval" in lowered or "human" in lowered:
        return "human_approval"
    if "content" in lowered and "valid" in lowered:
        return "content_validation"
    if "policy" in lowered or "block" in lowered:
        return "policy_block"
    if "allow" in lowered:
        return "tool_allowlist"
    return "policy_block"


class IRBuilder:
    """Accumulates nodes and de-duplicated edges into IR lists.

    De-duplication is by id: adapters routinely rediscover the same node/edge
    (a shared asset, a re-referenced agent) and must not emit it twice, which the
    validators would reject as a duplicate id.
    """

    def __init__(self) -> None:
        self.nodes: list[Node] = []
        self.edges: list[Edge] = []
        # ignored_property warnings, one per (node type, node name, key).
        self.warnings: list[dict[str, Any]] = []
        self._node_ids: set[str] = set()
        self._edge_ids: set[str] = set()
        self._warned: set[tuple[str, str, str]] = set()
        self._edge_seq = 0

    def declare(self, props: dict[str, Any], raw: Any, node_type: NodeType, name: str) -> None:
        """``apply_declared_properties`` plus a warning for each ignored key."""
        apply_declared_properties(props, raw, node_type)
        for item in ignored_declarations(raw, node_type):
            seen = (node_type.value, name, item["property"])
            if seen not in self._warned:
                self._warned.add(seen)
                self.warnings.append(ignored_property_warning(node_type, name, item))

    def add_node(self, node_id: str, node_type: NodeType, name: str, properties: dict[str, Any]) -> str:
        if node_id not in self._node_ids:
            self.nodes.append(Node(id=node_id, type=node_type, name=name, properties=properties))
            self._node_ids.add(node_id)
        return node_id

    def add_edge(self, source: str, target: str, capability: str, properties: dict[str, Any] | None = None) -> None:
        # Guard against re-adding the exact same hop+capability under a new id;
        # the sequence is only consumed for edges actually emitted, so ids stay
        # contiguous.
        signature = f"{source}->{target}:{capability}"
        if signature in self._edge_ids:
            return
        self._edge_ids.add(signature)
        self._edge_seq += 1
        edge_id = f"edge_{self._edge_seq:03d}"
        self.edges.append(
            Edge(id=edge_id, source=source, target=target, capability=capability, properties=properties or {})
        )

    def node_props(self, node_id: str) -> dict[str, Any] | None:
        for node in self.nodes:
            if node.id == node_id:
                return node.properties
        return None


def tool_effect(tool_props: dict[str, Any]) -> str:
    """The single most dangerous capability verb a tool exposes."""
    return _primary_effect(as_list(tool_props.get("capability_kinds") or ["invokeTool"]))


def synthesize_tool_effect(
    builder: IRBuilder,
    ids: IdFactory,
    tool_id: str,
    tool_props: dict[str, Any],
) -> None:
    """Create the downstream node + verb edge that expresses a tool's effect.

    A send/mutating tool gains an output sink; a read/fetch tool gains a data
    asset. ``executeCode`` is deliberately NOT handled here: the tool is itself
    the execution sink, so the verb belongs on the agent -> tool hop, which the
    caller adds.
    """
    effect = tool_effect(tool_props)
    tool_name = _display_name(builder, tool_id)

    if effect in {"deployRelease", "moveResource"}:
        # Publishing a release or moving a resource lands outside the system,
        # which is what FH-012 (external publication) keys on. It's not a
        # message, so FH-022's content filter / PII redaction doesn't apply.
        out_id = ids.make(NodeType.OUTPUT, f"{tool_name} destination")
        out_props = infer_output_properties(tool_name, external=True)
        out_props["output_kind"] = DEPLOYMENT_TARGET
        builder.add_node(out_id, NodeType.OUTPUT, f"{tool_name} destination", out_props)
        builder.add_edge(tool_id, out_id, effect)
        return

    if effect in {"send", "createResource"}:
        # Case-insensitive: this runs during adapter build, before the normalizer
        # canonicalises the (user-overridable) target_boundary field.
        external = str(tool_props.get("target_boundary", "")).strip().lower() == "external" or effect == "send"
        out_id = ids.make(NodeType.OUTPUT, f"{tool_name} output")
        builder.add_node(
            out_id,
            NodeType.OUTPUT,
            f"{tool_name} output",
            infer_output_properties(tool_name, external=external),
        )
        builder.add_edge(tool_id, out_id, effect)
        return

    if effect in {"modifyResource", "deleteResource"}:
        # A mutating verb acts ON a resource, modelled as the data asset the tool
        # changes (spec FH-011 keys on the asset's sensitivity).
        asset_id = ids.make(NodeType.DATA_ASSET, f"{tool_name} resource")
        builder.add_node(
            asset_id, NodeType.DATA_ASSET, f"{tool_name} resource", infer_asset_properties(tool_name)
        )
        builder.add_edge(tool_id, asset_id, effect)
        return

    if effect == "fetchWeb":
        asset_id = ids.make(NodeType.DATA_ASSET, f"{tool_name} web content")
        props = {"sensitivity": "low", "boundary": "external", "contains_pii": False, "asset_kind": "web_content"}
        builder.add_node(asset_id, NodeType.DATA_ASSET, f"{tool_name} web content", props)
        builder.add_edge(tool_id, asset_id, "fetchWeb")
        return

    if effect in {"read", "search", "extractInformation"}:
        asset_id = ids.make(NodeType.DATA_ASSET, f"{tool_name} data")
        builder.add_node(asset_id, NodeType.DATA_ASSET, f"{tool_name} data", infer_asset_properties(tool_name))
        builder.add_edge(tool_id, asset_id, "read")
        return


def route_tool_effect(
    builder: IRBuilder,
    ids: IdFactory,
    agent_id: str,
    tool_id: str,
    tool_props: dict[str, Any],
) -> None:
    """Wire an agent's use of a tool plus the tool's downstream effect.

    The agent always ``invokeTool``s the tool (baseline reachability); an
    executor tool additionally gets an ``executeCode`` hop from the agent, while
    every other effect is synthesised downstream of the tool.
    """
    builder.add_edge(agent_id, tool_id, "invokeTool")
    if tool_effect(tool_props) == "executeCode":
        builder.add_edge(agent_id, tool_id, "executeCode")
        return
    synthesize_tool_effect(builder, ids, tool_id, tool_props)


def _display_name(builder: IRBuilder, node_id: str) -> str:
    for node in builder.nodes:
        if node.id == node_id:
            return node.name
    return node_id
