"""CrewAI adapter (spec section 5).

CrewAI describes a crew as a set of ``agents`` and a set of ``tasks``. This
backend ingests them as a single YAML document with top-level ``agents`` and
``tasks`` mappings (that is exactly what ``detect_framework`` keys on), which
sidesteps the two-file upload problem: the caller concatenates the two CrewAI
files under those keys.

Each agent becomes an ``agent`` node; its declared ``tools`` become ``tool``
nodes whose effect (read/send/executeCode/...) is wired downstream by
``route_tool_effect``. Trust and autonomy default cautiously (untrusted inputs,
full-auto agents) so the rule engine does not under-report. A crew-level
``memory: true`` becomes one memory node that every agent writes and reads
(see ``_add_crew_memory``). Heuristics are ported
from the earlier prototype adapter but re-expressed in the
current capability-verb IR.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...coerce import as_bool
from ...ir.models import (
    AnalysisIR,
    IRValidationError,
    Metadata,
    NodeType,
    SourceFramework,
)
from ._common import (
    IRBuilder,
    IdFactory,
    as_list,
    infer_asset_properties,
    infer_control_kind,
    infer_input_properties,
    infer_output_properties,
    infer_tool_properties,
    route_tool_effect,
    slugify,
)


def _require_mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise IRValidationError(
            "INVALID_INPUT",
            f"CrewAI '{field}' must be a mapping.",
            {"field": field, "got": type(value).__name__},
        )
    return dict(value)


def load(data: dict[str, Any], analysis_id: str) -> AnalysisIR:
    agents_data = _require_mapping(data.get("agents"), "agents")
    tasks_data = _require_mapping(data.get("tasks") or {}, "tasks")
    if not agents_data:
        raise IRValidationError("EMPTY_IR", "CrewAI input declares no agents.")

    builder = IRBuilder()
    ids = IdFactory()

    # agent_key -> (agent_id, has_explicit_inputs) so tasks can fill gaps and
    # delegation references can resolve.
    agents_index: dict[str, str] = {}
    agent_has_inputs: set[str] = set()
    # tool_name (lower) -> tool_id, per agent, so controls can target a tool.
    delegations: list[tuple[str, str, dict[str, Any]]] = []

    for agent_key, raw_payload in agents_data.items():
        payload = raw_payload if isinstance(raw_payload, Mapping) else {}
        role = str(payload.get("role") or agent_key)
        agent_id = ids.make(NodeType.AGENT, str(agent_key))
        agents_index[str(agent_key)] = agent_id
        # allow_delegation defaults to True (unstated -> assume full autonomy, the
        # cautious default); a quoted "false" is honoured via as_bool.
        autonomy = "advisor_only" if not as_bool(payload.get("allow_delegation", True)) else "full_auto"
        agent_props: dict[str, Any] = {
            "role_type": "worker",
            "trust_level": "internal_logic",
            "autonomy_level": autonomy,
            "guardrails": [],
            "has_scoped_delegation": False,
        }
        builder.declare(agent_props, payload, NodeType.AGENT, role)
        builder.add_node(agent_id, NodeType.AGENT, role, agent_props)

        for raw_input in as_list(payload.get("inputs") or payload.get("allowed_inputs")):
            spec = _input_spec(builder, raw_input)
            input_id = ids.make(NodeType.INPUT, spec["name"])
            builder.add_node(input_id, NodeType.INPUT, spec["name"], spec["properties"])
            builder.add_edge(input_id, agent_id, "receiveInstruction")
            agent_has_inputs.add(agent_id)

        tools_by_name: dict[str, str] = {}
        for raw_tool in as_list(payload.get("tools")):
            added = _add_tool(builder, ids, agent_id, raw_tool)
            if added is not None:
                tool_id, tool_name = added
                tools_by_name[slugify(tool_name)] = tool_id

        for raw_asset in as_list(payload.get("data_assets") or payload.get("sensitive_assets")):
            spec = _asset_spec(builder, raw_asset)
            asset_id = ids.make(NodeType.DATA_ASSET, spec["name"])
            builder.add_node(asset_id, NodeType.DATA_ASSET, spec["name"], spec["properties"])
            builder.add_edge(agent_id, asset_id, "read")

        for raw_output in as_list(payload.get("outputs") or payload.get("external_outputs")):
            spec = _output_spec(builder, raw_output)
            out_id = ids.make(NodeType.OUTPUT, spec["name"])
            builder.add_node(out_id, NodeType.OUTPUT, spec["name"], spec["properties"])
            builder.add_edge(agent_id, out_id, "send")

        for raw_control in as_list(payload.get("controls")):
            _apply_control(builder, ids, agent_id, raw_control, tools_by_name)

        for target_ref in as_list(payload.get("delegates_to")):
            delegations.append((str(agent_key), str(target_ref), dict(payload)))

    # Resolve delegation edges once every agent id is known.
    for source_key, target_ref, payload in delegations:
        source_id = agents_index.get(source_key)
        target_id = agents_index.get(target_ref)
        if source_id is None or target_id is None:
            continue
        builder.add_edge(
            source_id,
            target_id,
            "delegateTo",
            {"has_scoped_delegation": as_bool(payload.get("has_scoped_delegation", False))},
        )

    _infer_task_inputs(builder, ids, tasks_data, agents_index, agent_has_inputs)
    _add_crew_memory(builder, ids, data.get("memory"), agents_data, agents_index)

    metadata = Metadata(name=str(data.get("name") or "CrewAI crew"))
    return AnalysisIR(
        analysis_id=analysis_id,
        source_framework=SourceFramework.CREWAI,
        metadata=metadata,
        nodes=builder.nodes,
        edges=builder.edges,
        parse_warnings=builder.warnings,
    )


def _input_spec(builder: IRBuilder, raw: Any) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        name = str(raw.get("name") or "Input")
        props = infer_input_properties(name)
        builder.declare(props, raw, NodeType.INPUT, name)
        return {"name": name, "properties": props}
    name = str(raw)
    return {"name": name, "properties": infer_input_properties(name)}


def _asset_spec(builder: IRBuilder, raw: Any) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        name = str(raw.get("name") or "asset")
        props = infer_asset_properties(name)
        builder.declare(props, raw, NodeType.DATA_ASSET, name)
        return {"name": name, "properties": props}
    name = str(raw)
    return {"name": name, "properties": infer_asset_properties(name)}


def _output_spec(builder: IRBuilder, raw: Any) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        name = str(raw.get("name") or "output")
        external = None
        if "boundary" in raw:
            external = str(raw["boundary"]).strip().lower() == "external"
        props = infer_output_properties(name, external=external)
        builder.declare(props, raw, NodeType.OUTPUT, name)
        return {"name": name, "properties": props}
    name = str(raw)
    return {"name": name, "properties": infer_output_properties(name)}


def _add_tool(builder: IRBuilder, ids: IdFactory, agent_id: str, raw_tool: Any) -> tuple[str, str] | None:
    """Create a tool node (and its effect) and return ``(tool_id, name)``."""
    name = raw_tool.get("name") if isinstance(raw_tool, Mapping) else str(raw_tool)
    if not name:
        return None
    name = str(name)
    props = infer_tool_properties(name)
    builder.declare(props, raw_tool, NodeType.TOOL, name)

    tool_id = ids.make(NodeType.TOOL, name)
    builder.add_node(tool_id, NodeType.TOOL, name, props)

    # An explicit reads_asset wins over the routed default asset so declared
    # sensitivity is preserved.
    if isinstance(raw_tool, Mapping) and raw_tool.get("reads_asset"):
        spec = _asset_spec(builder, raw_tool["reads_asset"])
        asset_id = ids.make(NodeType.DATA_ASSET, spec["name"])
        builder.add_node(asset_id, NodeType.DATA_ASSET, spec["name"], spec["properties"])
        builder.add_edge(agent_id, tool_id, "invokeTool")
        builder.add_edge(tool_id, asset_id, "read")
        return tool_id, name

    route_tool_effect(builder, ids, agent_id, tool_id, props)
    return tool_id, name


def _apply_control(
    builder: IRBuilder,
    ids: IdFactory,
    agent_id: str,
    raw_control: Any,
    tools_by_name: dict[str, str],
) -> None:
    name = raw_control.get("name") if isinstance(raw_control, Mapping) else str(raw_control)
    name = str(name or "control")
    # Lowercase so an explicit control_kind (e.g. "Human_Approval") still matches
    # the checks below and stores a canonical value.
    kind = (
        str(raw_control.get("control_kind")).strip().lower()
        if isinstance(raw_control, Mapping) and raw_control.get("control_kind")
        else infer_control_kind(name)
    )
    scope = [slugify(str(s)) for s in as_list(raw_control.get("scope"))] if isinstance(raw_control, Mapping) else []

    control_id = ids.make(NodeType.CONTROL, name)
    builder.add_node(control_id, NodeType.CONTROL, name, {"status": "present", "control_kind": kind, "effect": "total"})

    # A human-approval control on a send tool closes the exfiltration path by
    # marking both the tool and its downstream output as approval-gated.
    targeted = [tid for slug, tid in tools_by_name.items() if not scope or slug in scope]
    for tool_id in targeted:
        builder.add_edge(tool_id, control_id, "invokeTool")
        if kind == "human_approval":
            tool_props = builder.node_props(tool_id) or {}
            tool_props["requires_approval"] = True
            _gate_downstream_outputs(builder, tool_id)


def _gate_downstream_outputs(builder: IRBuilder, tool_id: str) -> None:
    """Mark outputs the tool sends to as approval-gated (rules read this flag)."""
    for edge in builder.edges:
        if edge.source == tool_id:
            target_props = builder.node_props(edge.target)
            if target_props is not None and "approval_gate_present" in target_props:
                target_props["approval_gate_present"] = True


def _add_crew_memory(
    builder: IRBuilder,
    ids: IdFactory,
    raw_memory: Any,
    agents_data: dict[str, Any],
    agents_index: dict[str, str],
) -> None:
    """Map crew-level ``memory`` to one memory node the crew's agents share.

    CrewAI keeps one memory per crew, so every agent writes into it and reads
    back from it; an agent with ``memory: false`` stays out. ``memory`` may be a
    mapping of memory properties (``sensitivity``, ``retention_ttl_days``...)
    instead of ``true``. It counts as shared once two agents use it, unless the
    file declares ``shared`` itself.
    """
    if isinstance(raw_memory, Mapping):
        declared: Mapping[str, Any] = raw_memory
    elif as_bool(raw_memory):
        declared = {}
    else:
        return

    members = []
    for agent_key, payload in agents_data.items():
        opt_out = isinstance(payload, Mapping) and payload.get("memory") is not None and not as_bool(payload["memory"])
        if not opt_out:
            members.append(agents_index[str(agent_key)])
    if not members:
        return

    name = str(declared.get("name") or "Crew memory")
    props: dict[str, Any] = {"sensitivity": "medium", "shared": len(members) >= 2}
    builder.declare(props, declared, NodeType.MEMORY, name)
    memory_id = ids.make(NodeType.MEMORY, name)
    builder.add_node(memory_id, NodeType.MEMORY, name, props)
    for agent_id in members:
        builder.add_edge(agent_id, memory_id, "writeMemory")
        builder.add_edge(memory_id, agent_id, "readMemory")


def _infer_task_inputs(
    builder: IRBuilder,
    ids: IdFactory,
    tasks_data: dict[str, Any],
    agents_index: dict[str, str],
    agent_has_inputs: set[str],
) -> None:
    """Give an input-less agent a low-confidence untrusted input when a task
    description implies external content (email/attachment/chat/webhook)."""
    for task_name, raw_payload in tasks_data.items():
        payload = raw_payload if isinstance(raw_payload, Mapping) else {}
        agent_ref = str(payload.get("agent") or "").strip()
        agent_id = agents_index.get(agent_ref)
        if agent_id is None or agent_id in agent_has_inputs:
            continue
        text = " ".join(str(payload.get(f) or "") for f in ("description", "expected_output")).lower()
        if any(token in text for token in ("email", "attachment", "chat", "user", "webhook", "request")):
            input_id = ids.make(NodeType.INPUT, f"{task_name} input")
            builder.add_node(
                input_id,
                NodeType.INPUT,
                f"Inferred input for {task_name}",
                infer_input_properties("user_input"),
            )
            builder.add_edge(input_id, agent_id, "receiveInstruction", {"confidence": 0.4})
            agent_has_inputs.add(agent_id)
