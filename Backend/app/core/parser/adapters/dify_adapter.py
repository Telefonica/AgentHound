"""Dify adapter (spec section 5).

A Dify DSL describes an app plus a ``workflow.graph`` of typed nodes and edges.
Node ``data.type`` selects the IR node type (``start`` -> input, ``llm``/``agent``
-> agent, ``tool``/``http-request`` -> tool, ``knowledge-retrieval`` -> data
asset, ``answer``/``end`` -> output); graph edges become capability edges keyed by
the pair of endpoint kinds. Each tool's downstream effect (an external send, a web
fetch, a sensitive read) is synthesised so it is visible to the rule engine even
when the DSL routes the tool into an internal answer node. Each conversation
variable becomes a memory node, written by ``assigner`` nodes and read by the
nodes that reference it (see ``_add_conversation_memory``).

Ported from the earlier prototype adapter into the current
capability-verb IR.
"""

from __future__ import annotations

import re
from collections import deque
from collections.abc import Mapping
from typing import Any

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
    synthesize_tool_effect,
    tool_effect,
)

_INPUT_TYPES = {"start"}
_AGENT_TYPES = {"llm", "agent"}
_TOOL_TYPES = {"tool", "http-request"}
_ASSET_TYPES = {"knowledge-retrieval", "dataset-retrieval", "knowledge"}
_OUTPUT_TYPES = {"answer", "end"}
_ASSIGNER_TYPES = {"assigner"}

# Node kinds that read a conversation variable they reference. An answer/end
# node that renders one sends the memory straight to an output.
_READER_KINDS = {NodeType.AGENT, NodeType.TOOL, NodeType.OUTPUT}

# A conversation variable is referenced as {{#conversation.name#}} in prompt
# and answer text, and as a ["conversation", "name"] selector elsewhere.
_CONVERSATION_TEMPLATE = re.compile(r"\{\{#conversation\.([^.#}]+)")


def _capability_for(source_kind: NodeType, target_kind: NodeType) -> str:
    if source_kind == NodeType.INPUT and target_kind == NodeType.AGENT:
        return "receiveInstruction"
    if target_kind == NodeType.TOOL:
        return "invokeTool"
    if target_kind == NodeType.DATA_ASSET:
        return "read"
    if target_kind == NodeType.OUTPUT:
        return "send"
    # Everything else -- including an agent -> agent workflow transition -- is
    # ordinary data/control flow. A Dify edge does NOT imply authority
    # delegation, so it is never labelled delegateTo (that would risk spuriously
    # tripping FH-014); explicit delegation would need a dedicated signal.
    return "dataFlow"


def load(data: dict[str, Any], analysis_id: str) -> AnalysisIR:
    workflow = data.get("workflow")
    if not isinstance(workflow, Mapping):
        raise IRValidationError("INVALID_INPUT", "Dify DSL must contain a 'workflow' section.")
    graph = workflow.get("graph")
    if not isinstance(graph, Mapping):
        raise IRValidationError("INVALID_INPUT", "Dify 'workflow.graph' must be a mapping.")
    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges") or []
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise IRValidationError("INVALID_INPUT", "Dify 'graph.nodes' and 'graph.edges' must be lists.")
    if not raw_nodes:
        raise IRValidationError("EMPTY_IR", "Dify workflow declares no nodes.")

    builder = IRBuilder()
    ids = IdFactory()
    # dify node id -> (ir_id, NodeType)
    node_map: dict[str, tuple[str, NodeType]] = {}
    tool_nodes: list[str] = []
    # dify node id -> data block, for every node (mapped or not).
    sections: dict[str, Mapping[str, Any]] = {}

    for raw_node in raw_nodes:
        if not isinstance(raw_node, Mapping):
            continue
        dify_id = str(raw_node.get("id") or "")
        section = raw_node.get("data")
        if not dify_id or not isinstance(section, Mapping):
            continue
        sections[dify_id] = section
        node_type = str(section.get("type") or "").lower()
        title = str(section.get("title") or section.get("name") or node_type or dify_id)

        # Risk properties may be declared directly in the node's ``data`` block;
        # Dify keeps unknown keys there, and its own keys (title, model, memory,
        # variables...) do not collide with catalogued property names.
        if node_type in _INPUT_TYPES:
            nid = ids.make(NodeType.INPUT, title)
            props = infer_input_properties(title)
            builder.declare(props, section, NodeType.INPUT, title)
            builder.add_node(nid, NodeType.INPUT, title, props)
            node_map[dify_id] = (nid, NodeType.INPUT)
        elif node_type in _AGENT_TYPES:
            nid = ids.make(NodeType.AGENT, title)
            props = {"role_type": "worker", "trust_level": "internal_logic", "autonomy_level": "full_auto", "guardrails": []}
            builder.declare(props, section, NodeType.AGENT, title)
            builder.add_node(nid, NodeType.AGENT, title, props)
            node_map[dify_id] = (nid, NodeType.AGENT)
        elif node_type in _TOOL_TYPES:
            props = infer_tool_properties(title)
            if node_type == "http-request" and tool_effect(props) not in {"send", "fetchWeb"}:
                # An HTTP request leaves the system whatever its title says.
                # Applied before the declared values so the file still wins.
                props["capability_kinds"] = ["send", "invokeTool"]
                props["target_boundary"] = "external"
                props["access_kind"] = "external_call"
                props["side_effect"] = True
            builder.declare(props, section, NodeType.TOOL, title)
            nid = ids.make(NodeType.TOOL, title)
            builder.add_node(nid, NodeType.TOOL, title, props)
            node_map[dify_id] = (nid, NodeType.TOOL)
            tool_nodes.append(nid)
        elif node_type in _ASSET_TYPES:
            nid = ids.make(NodeType.DATA_ASSET, title)
            props = infer_asset_properties(title)
            builder.declare(props, section, NodeType.DATA_ASSET, title)
            builder.add_node(nid, NodeType.DATA_ASSET, title, props)
            node_map[dify_id] = (nid, NodeType.DATA_ASSET)
        elif node_type in _OUTPUT_TYPES:
            nid = ids.make(NodeType.OUTPUT, title)
            # A Dify answer/end node is internal unless it declares otherwise;
            # derive output_kind from the declared boundary so they stay consistent.
            boundary = section.get("boundary")
            external = boundary is not None and str(boundary).strip().lower() == "external"
            props = infer_output_properties(title, external=external)
            builder.declare(props, section, NodeType.OUTPUT, title)
            builder.add_node(nid, NodeType.OUTPUT, title, props)
            node_map[dify_id] = (nid, NodeType.OUTPUT)
        # Unsupported node kinds are skipped; their edges drop out below.

    for raw_edge in raw_edges:
        if not isinstance(raw_edge, Mapping):
            continue
        src = str(raw_edge.get("source") or "")
        tgt = str(raw_edge.get("target") or "")
        if src not in node_map or tgt not in node_map:
            continue
        src_id, src_kind = node_map[src]
        tgt_id, tgt_kind = node_map[tgt]
        builder.add_edge(src_id, tgt_id, _capability_for(src_kind, tgt_kind))

    # Synthesise each tool's downstream effect (external output / web asset /
    # read) so exfiltration and injection paths surface even when the DSL routes
    # the tool into an internal answer node. Executor tools instead get an
    # executeCode verb on their incoming agent hops.
    for tool_id in tool_nodes:
        props = builder.node_props(tool_id) or {}
        if tool_effect(props) == "executeCode":
            for edge in list(builder.edges):
                if edge.target == tool_id and edge.capability == "invokeTool":
                    builder.add_edge(edge.source, tool_id, "executeCode")
        else:
            synthesize_tool_effect(builder, ids, tool_id, props)

    _add_conversation_memory(builder, ids, workflow.get("conversation_variables"), sections, node_map, raw_edges)

    name = "Dify workflow"
    app = data.get("app")
    if isinstance(app, Mapping) and app.get("name"):
        name = str(app["name"])
    return AnalysisIR(
        analysis_id=analysis_id,
        source_framework=SourceFramework.DIFY,
        metadata=Metadata(name=name),
        nodes=builder.nodes,
        edges=builder.edges,
        parse_warnings=builder.warnings,
    )


def _add_conversation_memory(
    builder: IRBuilder,
    ids: IdFactory,
    raw_variables: Any,
    sections: dict[str, Mapping[str, Any]],
    node_map: dict[str, tuple[str, NodeType]],
    raw_edges: list[Any],
) -> None:
    """Map each conversation variable to a memory node.

    A conversation variable persists across the turns of a chat, so it is memory
    in the IR. ``assigner`` nodes write it: the writer is the node whose output
    is assigned (``sys.*`` values come from the start node). Agents, tools and
    answer/end nodes whose ``data`` block references it read it. A variable no
    node writes or reads is skipped, since there is no memory flow to show. It
    counts as shared once two agents use it, unless the variable declares
    ``shared`` itself.
    """
    variables = [v for v in as_list(raw_variables) if isinstance(v, Mapping) and v.get("name")]
    if not variables:
        return

    preds: dict[str, list[str]] = {}
    for edge in raw_edges:
        if isinstance(edge, Mapping):
            preds.setdefault(str(edge.get("target") or ""), []).append(str(edge.get("source") or ""))

    writers: dict[str, set[str]] = {}
    for dify_id, section in sections.items():
        if str(section.get("type") or "").lower() in _ASSIGNER_TYPES:
            for variable, value in _assignments(section):
                for writer in _writers_of(value, dify_id, sections, node_map, preds):
                    writers.setdefault(variable, set()).add(writer)

    agent_ids = {nid for nid, kind in node_map.values() if kind == NodeType.AGENT}
    for variable in variables:
        name = str(variable["name"])
        readers = [
            nid
            for dify_id, (nid, kind) in node_map.items()
            if kind in _READER_KINDS and name in _conversation_refs(sections[dify_id])
        ]
        written_by = sorted(writers.get(name, set()))
        if not written_by and not readers:
            continue
        agents = agent_ids & {*written_by, *readers}

        props: dict[str, Any] = {"sensitivity": "medium", "shared": len(agents) >= 2}
        builder.declare(props, variable, NodeType.MEMORY, name)
        memory_id = ids.make(NodeType.MEMORY, name)
        builder.add_node(memory_id, NodeType.MEMORY, name, props)
        for writer in written_by:
            builder.add_edge(writer, memory_id, "writeMemory")
        for reader in readers:
            builder.add_edge(memory_id, reader, "readMemory")


def _assignments(section: Mapping[str, Any]) -> list[tuple[str, Any]]:
    """``(variable name, assigned value selector)`` pairs of an assigner node.

    Covers both assigner shapes: a list of ``items`` and the single
    ``assigned_variable_selector`` / ``input_variable_selector`` pair. A
    constant value has no source node, so it comes back as ``None``.
    """
    pairs = [
        (item.get("variable_selector"), None if item.get("input_type") == "constant" else item.get("value"))
        for item in as_list(section.get("items"))
        if isinstance(item, Mapping)
    ]
    pairs.append((section.get("assigned_variable_selector"), section.get("input_variable_selector")))
    return [
        (str(target[1]), value)
        for target, value in pairs
        if isinstance(target, list) and len(target) >= 2 and target[0] == "conversation"
    ]


def _writers_of(
    value: Any,
    assigner_id: str,
    sections: dict[str, Mapping[str, Any]],
    node_map: dict[str, tuple[str, NodeType]],
    preds: dict[str, list[str]],
) -> list[str]:
    """IR ids of the nodes whose output an assigner writes into a variable."""
    if not isinstance(value, list) or not value:
        return []
    source = str(value[0])
    if source == "sys":
        return [
            nid
            for dify_id, (nid, _) in node_map.items()
            if str(sections[dify_id].get("type") or "").lower() == "start"
        ]
    if source in node_map:
        return [node_map[source][0]]
    if source in sections and source != assigner_id:
        # An unmapped node (code, template...) passes on what reached it, so
        # the nearest mapped nodes upstream of it are the writers.
        return _mapped_predecessors(source, node_map, preds)
    return []


def _mapped_predecessors(
    start: str, node_map: dict[str, tuple[str, NodeType]], preds: dict[str, list[str]]
) -> list[str]:
    found: list[str] = []
    seen = {start}
    queue = deque(preds.get(start, []))
    while queue:
        node = queue.popleft()
        if node in seen:
            continue
        seen.add(node)
        if node in node_map:
            found.append(node_map[node][0])
        else:
            queue.extend(preds.get(node, []))
    return found


def _conversation_refs(value: Any) -> set[str]:
    """Conversation variable names referenced anywhere in a node's data block."""
    if isinstance(value, str):
        return set(_CONVERSATION_TEMPLATE.findall(value))
    if isinstance(value, list):
        if len(value) >= 2 and value[0] == "conversation" and isinstance(value[1], str):
            return {value[1]}
        return set().union(*(_conversation_refs(v) for v in value))
    if isinstance(value, Mapping):
        return set().union(*(_conversation_refs(v) for v in value.values()))
    return set()
