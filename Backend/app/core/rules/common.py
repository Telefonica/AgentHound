"""Shared graph-inspection helpers used by the rule modules.

These read node types/properties off the capability graph and are used by both
``path_rules`` and ``node_rules``; keeping them here avoids one rule module
importing another's internals.
"""

from __future__ import annotations

from ..coerce import as_bool  # noqa: F401  (re-exported for the rule modules)
from ..graph.traversal import CapabilityGraph, SENSITIVE_LEVELS

# Rule IDs that are hygiene/compliance signals rather than exploitable attack
# paths. Any finding whose rule_id appears here is classified as "hygiene";
# all others are classified as "attack".  This is the single source of truth
# used by Finding.finding_class, the API serialization, and the test helpers.
HYGIENE_RULE_IDS: frozenset[str] = frozenset(
    {
        "FH-018",  # default (unclassified) data asset sensitivity
        "FH-020",  # shared memory without write validation
        "FH-021",  # untrusted input without sanitisation or injection detector
        "FH-022",  # external output without content filter or PII redaction
        "FH-026",  # GDPR data without consent enforcement
        "FH-027",  # side-effect tool without audit logging
        "FH-028",  # full-auto agent without decision audit trail
        "FH-029",  # memory without retention TTL
        "FH-033",  # injection detector absent on decision-making input
        "FH-034",  # DLP scanner absent on sensitive external output
        "FH-035",  # anomaly detection absent on full-auto agent
    }
)

SENSITIVITY_ORDER = ["public", "low", "medium", "high", "critical"]


def node_props(cg: CapabilityGraph, node_id: str) -> dict:
    return cg.graph.nodes[node_id].get("properties", {})


def node_type(cg: CapabilityGraph, node_id: str) -> str:
    return cg.graph.nodes[node_id].get("type", "")


def agents_on_path(cg: CapabilityGraph, path: list[str]) -> list[str]:
    return [n for n in path if node_type(cg, n) == "agent"]


def max_sensitivity(cg: CapabilityGraph, path: list[str]) -> str:
    best = "public"
    for node_id in path:
        if node_type(cg, node_id) == "data_asset":
            sens = node_props(cg, node_id).get("sensitivity", "public")
            if sens not in SENSITIVITY_ORDER:
                continue  # ignore unknown/malformed sensitivity values
            if SENSITIVITY_ORDER.index(sens) > SENSITIVITY_ORDER.index(best):
                best = sens
    return best


def sensitive_assets_on_path(cg: CapabilityGraph, path: list[str]) -> list[str]:
    return [
        n
        for n in path
        if node_type(cg, n) == "data_asset" and node_props(cg, n).get("sensitivity") in SENSITIVE_LEVELS
    ]


def has_content_validation(cg: CapabilityGraph, path: list[str]) -> bool:
    """True if a contentValidation control is present on the path (Phase 1: rarely)."""
    for node_id in path:
        if node_type(cg, node_id) == "control":
            props = node_props(cg, node_id)
            kind = str(props.get("control_kind", "")).lower()
            if "contentvalidation" in kind or "content_validation" in kind:
                return props.get("status", "absent") == "present"
    return False


def is_shared_memory(props: dict) -> bool:
    """True when a memory node is accessible across agents.

    Four independent signals are recognised (any one is sufficient):
    - shared is true (the catalogued flag the LangGraph adapter writes)
    - memory_kind == "shared_between_agents"
    - shared_with_agents is a non-empty list
    - scope in {organization, global}
    """
    if as_bool(props.get("shared", False)):
        return True
    if props.get("memory_kind") == "shared_between_agents":
        return True
    if props.get("shared_with_agents"):
        return True
    return props.get("scope") in {"organization", "global"}


def tool_mediated_hops(cg: CapabilityGraph, agent: str, capability: str) -> list[tuple[str, str]]:
    """``(tool, target)`` pairs where ``agent`` invokes ``tool`` and the tool
    performs ``capability`` on ``target``.

    The framework adapters never put an effect verb on the agent -> tool hop:
    they emit ``agent -invokeTool-> tool -<verb>-> target`` (see
    ``_common.route_tool_effect``). Rules written for the generic format's direct
    ``agent -<verb>-> target`` shape use this to also match the adapter shape.
    """
    pairs: list[tuple[str, str]] = []
    for tool in cg.graph.successors(agent):
        if node_type(cg, tool) != "tool" or "invokeTool" not in cg.hop_capabilities(agent, tool):
            continue
        for target in cg.graph.successors(tool):
            if capability in cg.hop_capabilities(tool, target):
                pairs.append((tool, target))
    return pairs


def has_interpret_intent(cg: CapabilityGraph, agent: str) -> bool:
    """True when agent has an interpretIntent edge in either direction."""
    return any(
        "interpretIntent" in cg.hop_capabilities(agent, s)
        for s in cg.graph.successors(agent)
    ) or any(
        "interpretIntent" in cg.hop_capabilities(p, agent)
        for p in cg.graph.predecessors(agent)
    )


def has_control_targeting(cg: CapabilityGraph, node_id: str, control_kind: str) -> bool:
    """True if an applied (present) control of the given kind targets node_id.

    Control nodes are added to the graph only after a simulation step, so this
    returns False on the initial analysis and True once the control is applied.
    """
    for _n, data in cg.graph.nodes(data=True):
        if data.get("type") != "control":
            continue
        props = data.get("properties", {})
        if props.get("control_kind") != control_kind:
            continue
        if props.get("target_node_id") != node_id:
            continue
        if props.get("status") == "present":
            return True
    return False
