"""LangGraph adapter (spec section 5).

LangGraph builds a ``StateGraph`` of named nodes (each a function, agent, or
tool) with directed transitions and an entry point. This framework was not
covered by the earlier proof of concept, so the ingest shape is defined here as
a thin declarative layer:

    state_graph:            # or "graph"
      entry_point: intake
      nodes:
        - name: intake
          type: agent       # agent|input|tool|data_asset|output|memory
          tools: [ "gmail.send" ]
          trust_level: internal_logic
          delegates_to: [ privileged_agent ]
      edges:
        - { source: START, target: intake }
        - { source: intake, target: privileged_agent }

Node ``type`` is honoured when given and inferred from the name otherwise.
``START``/``END`` sentinels are recognised; if the entry agent has no declared
input, an untrusted input is synthesised so reachability rules still apply.
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
    infer_input_properties,
    infer_output_properties,
    infer_tool_properties,
    route_tool_effect,
)

_SENTINELS = {"start", "__start__", "end", "__end__"}
_VALID_TYPES = {t.value for t in NodeType}


def _infer_node_type(name: str, payload: Mapping[str, Any]) -> NodeType:
    declared = str(payload.get("type") or payload.get("kind") or "").lower()
    if declared in _VALID_TYPES:
        return NodeType(declared)
    if payload.get("tools") or declared in {"llm", "agent", "chatbot", "worker"}:
        return NodeType.AGENT
    lowered = name.lower()
    if any(t in lowered for t in ("input", "email", "webhook", "form", "request", "user")):
        return NodeType.INPUT
    if any(t in lowered for t in ("db", "database", "drive", "crm", "ats", "knowledge", "docs", "record")):
        return NodeType.DATA_ASSET
    if any(t in lowered for t in ("output", "answer", "reply", "response", "send", "email")):
        return NodeType.OUTPUT
    if "memory" in lowered or "state" in lowered:
        return NodeType.MEMORY
    return NodeType.AGENT


def _capability_for(source_kind: NodeType, target_kind: NodeType) -> str:
    if source_kind == NodeType.INPUT and target_kind == NodeType.AGENT:
        return "receiveInstruction"
    # FH-009 keys on readMemory for the memory -> agent hop; dataFlow there
    # would hide every memory-poisoning path.
    if source_kind == NodeType.MEMORY and target_kind == NodeType.AGENT:
        return "readMemory"
    if target_kind == NodeType.TOOL:
        return "invokeTool"
    if target_kind == NodeType.DATA_ASSET:
        return "read"
    if target_kind == NodeType.OUTPUT:
        return "send"
    if target_kind == NodeType.MEMORY:
        return "writeMemory"
    return "dataFlow"


def _build_node(builder: IRBuilder, ids: IdFactory, name: str, payload: Mapping[str, Any], node_type: NodeType) -> str:
    if node_type == NodeType.AGENT:
        nid = ids.make(NodeType.AGENT, name)
        agent_props: dict[str, Any] = {
            "role_type": "worker",
            "trust_level": "internal_logic",
            "autonomy_level": "full_auto",
            "guardrails": [],
            "has_scoped_delegation": False,
        }
        builder.declare(agent_props, payload, NodeType.AGENT, name)
        builder.add_node(nid, NodeType.AGENT, name, agent_props)
        for raw_tool in as_list(payload.get("tools")):
            tname = raw_tool.get("name") if isinstance(raw_tool, Mapping) else str(raw_tool)
            if not tname:
                continue
            props = infer_tool_properties(str(tname))
            builder.declare(props, raw_tool, NodeType.TOOL, str(tname))
            tool_id = ids.make(NodeType.TOOL, str(tname))
            builder.add_node(tool_id, NodeType.TOOL, str(tname), props)
            route_tool_effect(builder, ids, nid, tool_id, props)
        return nid

    if node_type == NodeType.INPUT:
        nid = ids.make(NodeType.INPUT, name)
        props = infer_input_properties(name)
        builder.declare(props, payload, NodeType.INPUT, name)
        builder.add_node(nid, NodeType.INPUT, name, props)
        return nid

    if node_type == NodeType.DATA_ASSET:
        nid = ids.make(NodeType.DATA_ASSET, name)
        props = infer_asset_properties(name)
        builder.declare(props, payload, NodeType.DATA_ASSET, name)
        builder.add_node(nid, NodeType.DATA_ASSET, name, props)
        return nid

    if node_type == NodeType.OUTPUT:
        nid = ids.make(NodeType.OUTPUT, name)
        # Derive external from a case-insensitive boundary so a declared
        # "EXTERNAL" does not leave output_kind/side_effect inconsistent (the
        # normalizer canonicalises boundary later, but only that one field).
        boundary = payload.get("boundary") if "boundary" in payload else None
        external = None if boundary is None else str(boundary).strip().lower() == "external"
        props = infer_output_properties(name, external=external)
        builder.declare(props, payload, NodeType.OUTPUT, name)
        builder.add_node(nid, NodeType.OUTPUT, name, props)
        return nid

    if node_type == NodeType.MEMORY:
        nid = ids.make(NodeType.MEMORY, name)
        props = {"sensitivity": "medium", "shared": False}
        builder.declare(props, payload, NodeType.MEMORY, name)
        builder.add_node(nid, NodeType.MEMORY, name, props)
        return nid

    nid = ids.make(NodeType.CONTROL, name)
    props = {"status": "present", "effect": "total"}
    builder.declare(props, payload, NodeType.CONTROL, name)
    builder.add_node(nid, NodeType.CONTROL, name, props)
    return nid


def load(data: dict[str, Any], analysis_id: str) -> AnalysisIR:
    graph = data.get("state_graph")
    if graph is None:
        graph = data.get("graph")
    if not isinstance(graph, Mapping):
        raise IRValidationError("INVALID_INPUT", "LangGraph input must contain a 'graph' or 'state_graph' mapping.")

    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges") or []
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise IRValidationError("INVALID_INPUT", "LangGraph 'nodes' and 'edges' must be lists.")
    if not raw_nodes:
        raise IRValidationError("EMPTY_IR", "LangGraph declares no nodes.")

    builder = IRBuilder()
    ids = IdFactory()
    # node name -> (ir_id, NodeType)
    name_map: dict[str, tuple[str, NodeType]] = {}
    delegations: list[tuple[str, str, dict[str, Any]]] = []

    for raw_node in raw_nodes:
        if isinstance(raw_node, Mapping):
            name = str(raw_node.get("name") or raw_node.get("id") or "")
            payload = raw_node
        else:
            name = str(raw_node)
            payload = {}
        if not name or name.lower() in _SENTINELS:
            continue
        node_type = _infer_node_type(name, payload)
        nid = _build_node(builder, ids, name, payload, node_type)
        name_map[name] = (nid, node_type)
        for target_ref in as_list(payload.get("delegates_to")):
            delegations.append((name, str(target_ref), dict(payload)))

    entry_point = str(graph.get("entry_point") or "").strip()
    fed_agents: set[str] = set()

    for raw_edge in raw_edges:
        if not isinstance(raw_edge, Mapping):
            continue
        src = str(raw_edge.get("source") or "")
        # LangGraph conditional edges may list several targets.
        targets = as_list(raw_edge.get("target") or raw_edge.get("targets"))
        for tgt in targets:
            tgt = str(tgt)
            if src.lower() in _SENTINELS:
                if not entry_point and tgt in name_map:
                    entry_point = tgt
                continue
            if tgt.lower() in _SENTINELS or src not in name_map or tgt not in name_map:
                continue
            src_id, src_kind = name_map[src]
            tgt_id, tgt_kind = name_map[tgt]
            builder.add_edge(src_id, tgt_id, _capability_for(src_kind, tgt_kind))
            if tgt_kind == NodeType.AGENT and src_kind == NodeType.INPUT:
                fed_agents.add(tgt_id)

    for source_name, target_ref, payload in delegations:
        src = name_map.get(source_name)
        tgt = name_map.get(target_ref)
        if src is None or tgt is None:
            continue
        builder.add_edge(
            src[0],
            tgt[0],
            "delegateTo",
            {"has_scoped_delegation": as_bool(payload.get("has_scoped_delegation", False))},
        )

    # If the entry agent has no upstream input, synthesise an untrusted one so
    # reachability rules have a source to start from.
    if entry_point in name_map:
        entry_id, entry_kind = name_map[entry_point]
        if entry_kind == NodeType.AGENT and entry_id not in fed_agents:
            input_id = ids.make(NodeType.INPUT, f"{entry_point} input")
            builder.add_node(
                input_id,
                NodeType.INPUT,
                f"Inferred input for {entry_point}",
                infer_input_properties("user_input"),
            )
            builder.add_edge(input_id, entry_id, "receiveInstruction", {"confidence": 0.4})

    return AnalysisIR(
        analysis_id=analysis_id,
        source_framework=SourceFramework.LANGGRAPH,
        metadata=Metadata(name=str(data.get("name") or "LangGraph app")),
        nodes=builder.nodes,
        edges=builder.edges,
        parse_warnings=builder.warnings,
    )
