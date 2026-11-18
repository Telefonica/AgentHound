"""End-to-end tests for the Phase 3 framework adapters (spec section 5).

Each framework has a risky fixture (which must surface specific findings) and a
safe fixture (which must surface none), all driven through the full pipeline via
``analyze_text`` with automatic framework detection.
"""

import pytest

from app.core.ir.models import SourceFramework
from app.core.parser.yaml_loader import detect_framework, load_yaml_text
from app.core.pipeline import analyze_text
from app.core.rules.common import HYGIENE_RULE_IDS

from .conftest import fixture_text


def _rule_ids(findings):
    return {f.rule_id for f in findings}


def _attack_findings(findings):
    """Return findings whose finding_class is 'attack' (not hygiene/compliance)."""
    return [f for f in findings if f.finding_class == "attack"]


@pytest.mark.parametrize(
    "fixture,expected",
    [
        ("crewai_risky.yaml", SourceFramework.CREWAI),
        ("crewai_safe.yaml", SourceFramework.CREWAI),
        ("dify_risky.yaml", SourceFramework.DIFY),
        ("dify_safe.yaml", SourceFramework.DIFY),
        ("langgraph_risky.yaml", SourceFramework.LANGGRAPH),
        ("langgraph_safe.yaml", SourceFramework.LANGGRAPH),
    ],
)
def test_framework_detection(fixture, expected):
    assert detect_framework(load_yaml_text(fixture_text(fixture))) is expected


def test_stray_workflow_key_is_not_misrouted_to_dify():
    # A top-level `workflow` without the Dify `graph` shape must fall through to
    # the intended adapter (generic here), not be forced into the Dify adapter.
    data = load_yaml_text(
        "workflow: {name: my flow}\nnodes:\n  - {id: n1, type: agent, name: N}\n"
    )
    assert detect_framework(data) is SourceFramework.GENERIC


# --- finding_class channel separation ---------------------------------------


def test_finding_class_attack_channel_empty_for_safe_fixture():
    # The attack channel of a safe fixture must be empty; the hygiene channel
    # may still surface compliance gaps (that is the point of the separation).
    result = analyze_text(fixture_text("crewai_safe.yaml"))
    attack = [f for f in result.findings if f.finding_class == "attack"]
    hygiene = [f for f in result.findings if f.finding_class == "hygiene"]
    assert attack == []
    assert all(f.rule_id in HYGIENE_RULE_IDS for f in hygiene)


def test_finding_class_serialized_in_model_dump():
    result = analyze_text(fixture_text("crewai_risky.yaml"))
    for finding in result.findings:
        d = finding.model_dump()
        assert d["finding_class"] in {"attack", "hygiene"}


# --- CrewAI -----------------------------------------------------------------


def test_crewai_risky_surfaces_expected_findings():
    result = analyze_text(fixture_text("crewai_risky.yaml"))
    assert result.ir.source_framework is SourceFramework.CREWAI
    ids = _rule_ids(result.findings)
    assert {"FH-002", "FH-003", "FH-014"} <= ids


def test_crewai_safe_is_clean():
    result = analyze_text(fixture_text("crewai_safe.yaml"))
    assert _attack_findings(result.findings) == []


# --- Dify -------------------------------------------------------------------


def test_dify_risky_surfaces_read_and_external_send():
    result = analyze_text(fixture_text("dify_risky.yaml"))
    assert result.ir.source_framework is SourceFramework.DIFY
    ids = _rule_ids(result.findings)
    assert {"FH-002", "FH-003"} <= ids


def test_dify_safe_is_clean():
    result = analyze_text(fixture_text("dify_safe.yaml"))
    assert _attack_findings(result.findings) == []


def test_dify_agent_to_agent_edge_is_dataflow_not_delegation():
    # A Dify LLM -> LLM transition is ordinary data flow, not authority
    # delegation, so it must not be labelled delegateTo (which could trip FH-014).
    dsl = """
app: {name: TwoAgents, mode: workflow}
workflow:
  graph:
    nodes:
      - {id: start, data: {type: start, title: In}}
      - {id: a, data: {type: llm, title: Planner}}
      - {id: b, data: {type: llm, title: Worker}}
      - {id: answer, data: {type: answer, title: Out}}
    edges:
      - {source: start, target: a, data: {}}
      - {source: a, target: b, data: {}}
      - {source: b, target: answer, data: {}}
"""
    result = analyze_text(dsl, framework_hint="dify")
    caps = {e.capability for e in result.ir.edges if e.source.startswith("agent_") and e.target.startswith("agent_")}
    assert caps == {"dataFlow"}
    assert "delegateTo" not in {e.capability for e in result.ir.edges}
    assert "FH-014" not in _rule_ids(result.findings)


# --- LangGraph --------------------------------------------------------------


def test_langgraph_risky_surfaces_exec_delegation_and_destruction():
    result = analyze_text(fixture_text("langgraph_risky.yaml"))
    assert result.ir.source_framework is SourceFramework.LANGGRAPH
    ids = _rule_ids(result.findings)
    assert {"FH-010", "FH-011", "FH-014"} <= ids


def test_langgraph_safe_is_clean():
    result = analyze_text(fixture_text("langgraph_safe.yaml"))
    assert _attack_findings(result.findings) == []


def test_output_derived_fields_consistent_for_mixed_case_boundary():
    # A declared "EXTERNAL" boundary must yield an external output_kind, not a
    # stale chat_response, even though the normalizer only canonicalises boundary.
    dsl = """
name: MixedCaseBoundary
state_graph:
  entry_point: agent
  nodes:
    - {name: user, type: input}
    - {name: agent, type: agent}
    - {name: sink, type: output, boundary: EXTERNAL}
  edges:
    - {source: user, target: agent}
    - {source: agent, target: sink}
"""
    result = analyze_text(dsl, framework_hint="langgraph")
    sink = next(n for n in result.ir.nodes if n.id == "output_sink")
    assert sink.properties["boundary"] == "external"
    assert sink.properties["output_kind"] == "external_action"


# --- adapter shape sanity ---------------------------------------------------


def test_crewai_single_file_shape_with_agents_and_tasks():
    result = analyze_text(fixture_text("crewai_risky.yaml"))
    types = {n.type.value for n in result.ir.nodes}
    assert {"agent", "input", "tool", "data_asset"} <= types


_CREWAI_DELEGATION = """
agents:
  intake:
    role: Intake
    trust_level: untrusted
    delegates_to: [privileged]
    has_scoped_delegation: {scoped}
  privileged:
    role: Privileged
    trust_level: trusted_core
tasks: {{}}
"""


def test_crewai_quoted_scoped_flag_does_not_suppress_fh014():
    # A quoted "false" must be coerced at ingestion; otherwise it becomes a truthy
    # string, marks the delegation scoped, and silently suppresses FH-014.
    result = analyze_text(_CREWAI_DELEGATION.format(scoped='"false"'), framework_hint="crewai")
    assert "FH-014" in _rule_ids(result.findings)


def test_crewai_genuinely_scoped_delegation_suppresses_fh014():
    result = analyze_text(_CREWAI_DELEGATION.format(scoped="true"), framework_hint="crewai")
    assert "FH-014" not in _rule_ids(result.findings)


def test_crewai_mixed_case_control_kind_gates_output():
    # A human-approval control declared with non-canonical casing must still be
    # recognised and gate the output, suppressing FH-003.
    yaml_text = """
agents:
  support:
    role: Support
    inputs:
      - {name: Inbound email, trust_level: untrusted}
    tools:
      - name: gmail.send
    controls:
      - {name: Approval, control_kind: Human_Approval, scope: [gmail.send]}
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert "FH-003" not in _rule_ids(result.findings)


# --- LangGraph shared memory -----------------------------------------------

_LANGGRAPH_MEMORY = """
graph:
  entry_point: intake
  nodes:
    - {{name: intake, type: agent}}
    - {{name: worker, type: agent, tools: ["gmail.send"]}}
    - {{name: shared_memory, type: memory, shared: {shared}, sensitivity: high}}
  edges:
    - {{source: START, target: intake}}
    - {{source: intake, target: shared_memory}}
    - {{source: shared_memory, target: worker}}
"""


def test_langgraph_shared_memory_fires_memory_rules():
    # `shared: true` must count as shared memory (FH-020), and the memory -> agent
    # hop must be readMemory so the poisoning path is traversable (FH-009).
    result = analyze_text(_LANGGRAPH_MEMORY.format(shared="true"), framework_hint="langgraph")
    assert {"FH-009", "FH-020"} <= _rule_ids(result.findings)
    caps = {(e.source, e.target): e.capability for e in result.ir.edges}
    assert caps[("memory_shared_memory", "agent_worker")] == "readMemory"


@pytest.mark.parametrize(
    "declaration",
    ["scope: organization", "memory_kind: shared_between_agents", "shared_with_agents: [intake, worker]"],
)
def test_langgraph_every_shared_memory_signal_fires_memory_rules(declaration):
    # is_shared_memory() accepts four signals; the adapter must keep all of them.
    yaml_text = _LANGGRAPH_MEMORY.format(shared="false").replace("shared: false", declaration)
    result = analyze_text(yaml_text, framework_hint="langgraph")
    assert {"FH-009", "FH-020"} <= _rule_ids(result.findings)
    fh020 = next(f for f in result.findings if f.rule_id == "FH-020")
    key, value = (part.strip() for part in declaration.split(":", 1))
    if key == "shared_with_agents":
        assert fh020.evidence[key] == ["intake", "worker"]
    elif key == "memory_kind":
        assert fh020.evidence[key] == value


def test_fh020_evidence_reports_the_shared_flag():
    # scope keeps its "session" default; the evidence must say why it's shared.
    result = analyze_text(_LANGGRAPH_MEMORY.format(shared="true"), framework_hint="langgraph")
    fh020 = next(f for f in result.findings if f.rule_id == "FH-020")
    assert fh020.evidence["shared"] is True
    assert fh020.evidence["scope"] == "session"


def test_langgraph_unshared_memory_does_not_fire_memory_rules():
    result = analyze_text(_LANGGRAPH_MEMORY.format(shared="false"), framework_hint="langgraph")
    fired = _rule_ids(result.findings)
    assert not {"FH-009", "FH-020"} & fired
    # The memory still carries the route to the send: path rules report it.
    assert "FH-003" in fired


def test_langgraph_memory_keeps_declared_properties():
    yaml_text = """
graph:
  nodes:
    - {name: notes, type: memory, scope: organization, write_validated: true, retention_ttl_days: 30}
  edges: []
"""
    result = analyze_text(yaml_text, framework_hint="langgraph")
    memory = next(n for n in result.ir.nodes if n.type.value == "memory")
    assert memory.properties["scope"] == "organization"
    assert memory.properties["write_validated"] is True
    assert memory.properties["retention_ttl_days"] == 30
    # write_validated suppresses FH-020 even though the scope is shared.
    assert "FH-020" not in _rule_ids(result.findings)


# --- CrewAI crew memory -----------------------------------------------------

_CREWAI_MEMORY = """
memory: {memory}
agents:
  intake:
    role: Intake
    inputs: [{{name: Customer chat, trust_level: untrusted}}]
  sender:
    role: Sender
    tools: [gmail.send]{opt_out}
tasks: {{}}
"""


def _memory_nodes(result):
    return [n for n in result.ir.nodes if n.type.value == "memory"]


def _memory_hops(result):
    return {(e.source, e.capability, e.target) for e in result.ir.edges if e.capability.endswith("Memory")}


def test_crewai_crew_memory_is_shared_by_every_agent():
    result = analyze_text(_CREWAI_MEMORY.format(memory="true", opt_out=""), framework_hint="crewai")
    [memory] = _memory_nodes(result)
    assert memory.id == "memory_crew_memory"
    assert memory.properties["shared"] is True
    assert memory.properties["sensitivity"] == "medium"
    assert memory.properties["retention_ttl_days"] is None
    assert _memory_hops(result) == {
        ("agent_intake", "writeMemory", memory.id),
        ("agent_sender", "writeMemory", memory.id),
        (memory.id, "readMemory", "agent_intake"),
        (memory.id, "readMemory", "agent_sender"),
    }
    # Intake writes what the untrusted chat says; Sender reads it and sends.
    assert {"FH-009", "FH-020", "FH-029"} <= _rule_ids(result.findings)


def test_route_only_through_crew_memory_is_still_reported():
    # Intake and Sender are linked only through the memory, so FH-003 has no
    # other route to report.
    result = analyze_text(_CREWAI_MEMORY.format(memory="true", opt_out=""), framework_hint="crewai")
    [fh003] = [f for f in result.findings if f.rule_id == "FH-003"]
    assert "memory_crew_memory" in fh003.path


_CREWAI_MEMORY_HUB = """
memory: true
agents:
  intake:
    role: Intake
    inputs: [{{name: Customer chat, trust_level: untrusted}}]{delegation}
  helper:
    role: Helper
    delegates_to: [sender]
  sender:
    role: Sender
    tools: [gmail.send]
tasks: {{}}
"""


def test_routes_through_crew_memory_collapse_to_one_finding():
    # The chat reaches gmail.send via memory -> Sender and via memory -> Helper
    # -> Sender: one entry and sink, so one FH-003.
    result = analyze_text(_CREWAI_MEMORY_HUB.format(delegation=""), framework_hint="crewai")
    [fh003] = [f for f in result.findings if f.rule_id == "FH-003"]
    assert "memory_crew_memory" in fh003.path


def test_direct_route_replaces_routes_through_crew_memory():
    result = analyze_text(
        _CREWAI_MEMORY_HUB.format(delegation="\n    delegates_to: [sender]"), framework_hint="crewai"
    )
    [fh003] = [f for f in result.findings if f.rule_id == "FH-003"]
    assert "memory_crew_memory" not in fh003.path


@pytest.mark.parametrize("memory", ["false", '"false"', "null"])
def test_crewai_without_crew_memory_has_no_memory_node(memory):
    result = analyze_text(_CREWAI_MEMORY.format(memory=memory, opt_out=""), framework_hint="crewai")
    assert _memory_nodes(result) == []
    assert not {"FH-009", "FH-020", "FH-029"} & _rule_ids(result.findings)


def test_crewai_agent_can_opt_out_of_crew_memory():
    # With Sender out, only Intake uses the memory: it is not shared.
    result = analyze_text(
        _CREWAI_MEMORY.format(memory="true", opt_out="\n    memory: false"), framework_hint="crewai"
    )
    [memory] = _memory_nodes(result)
    assert memory.properties["shared"] is False
    assert {hop[0] for hop in _memory_hops(result)} == {"agent_intake", memory.id}
    fired = _rule_ids(result.findings)
    assert not {"FH-009", "FH-020"} & fired
    assert "FH-029" in fired


def test_crewai_crew_memory_mapping_declares_properties():
    memory = "{name: Case notes, sensitivity: high, retention_ttl_days: 30, write_validated: true}"
    result = analyze_text(_CREWAI_MEMORY.format(memory=memory, opt_out=""), framework_hint="crewai")
    [node] = _memory_nodes(result)
    assert (node.id, node.name) == ("memory_case_notes", "Case notes")
    assert node.properties["sensitivity"] == "high"
    assert node.properties["retention_ttl_days"] == 30
    assert not {"FH-009", "FH-020", "FH-029"} & _rule_ids(result.findings)


def test_crewai_declared_unshared_memory_wins():
    result = analyze_text(_CREWAI_MEMORY.format(memory="{shared: false}", opt_out=""), framework_hint="crewai")
    [node] = _memory_nodes(result)
    assert node.properties["shared"] is False
    assert not {"FH-009", "FH-020"} & _rule_ids(result.findings)


# --- Dify conversation variables --------------------------------------------

_DIFY_MEMORY = """
workflow:
  conversation_variables:
    - {{id: v1, name: notes, value_type: string, value: "", description: Running notes{declared}}}
  graph:
    nodes:
      - {{id: s, data: {{type: start, title: Customer chat}}}}
      - {{id: a, data: {{type: llm, title: Intake}}}}
      - id: save
        data:
          type: assigner
          title: Save notes
          items: [{{variable_selector: [conversation, notes], input_type: variable, value: [{source}, text]}}]
      - id: b
        data:
          type: llm
          title: Writer
          prompt_template: [{{role: system, text: "Notes so far: {{{{#conversation.notes#}}}}"}}]
      - {{id: m, data: {{type: tool, title: gmail send}}}}
    edges:
      - {{source: s, target: a}}
      - {{source: a, target: save}}
      - {{source: save, target: b}}
      - {{source: b, target: m}}
"""


def test_dify_conversation_variable_is_written_by_assigner_and_read_by_reference():
    result = analyze_text(_DIFY_MEMORY.format(declared="", source="a"), framework_hint="dify")
    [memory] = _memory_nodes(result)
    assert (memory.id, memory.name) == ("memory_notes", "notes")
    assert memory.properties["shared"] is True
    assert _memory_hops(result) == {
        ("agent_intake", "writeMemory", "memory_notes"),
        ("memory_notes", "readMemory", "agent_writer"),
    }
    assert {"FH-009", "FH-020", "FH-029"} <= _rule_ids(result.findings)
    # Native Dify keys on the variable (value_type, description...) stay silent.
    assert _ignored(result) == []


def test_dify_conversation_variable_keeps_declared_properties():
    declared = ", sensitivity: high, retention_ttl_days: 7, write_validated: true"
    result = analyze_text(_DIFY_MEMORY.format(declared=declared, source="a"), framework_hint="dify")
    [memory] = _memory_nodes(result)
    assert memory.properties["sensitivity"] == "high"
    assert memory.properties["retention_ttl_days"] == 7
    assert not {"FH-009", "FH-020", "FH-029"} & _rule_ids(result.findings)


def test_dify_system_value_is_written_by_the_start_node():
    # sys.query is the user's message, so the start node is the writer. Only
    # Writer is an agent on the variable: not shared.
    result = analyze_text(_DIFY_MEMORY.format(declared="", source="sys"), framework_hint="dify")
    [memory] = _memory_nodes(result)
    assert ("input_customer_chat", "writeMemory", "memory_notes") in _memory_hops(result)
    assert memory.properties["shared"] is False
    assert "FH-020" not in _rule_ids(result.findings)


def test_dify_legacy_assigner_and_selector_reference():
    # The single-variable assigner shape, and a [conversation, name] selector
    # (not a template) as the reference on a tool.
    dsl = """
workflow:
  conversation_variables: [{name: prefs}]
  graph:
    nodes:
      - {id: s, data: {type: start, title: In}}
      - {id: a, data: {type: llm, title: Agent}}
      - {id: c, data: {type: code, title: Clean up}}
      - id: w
        data: {type: assigner, assigned_variable_selector: [conversation, prefs], input_variable_selector: [c, result]}
      - {id: t, data: {type: tool, title: crm lookup, tool_parameters: {q: {value: [conversation, prefs]}}}}
    edges:
      - {source: s, target: a}
      - {source: a, target: c}
      - {source: c, target: w}
"""
    result = analyze_text(dsl, framework_hint="dify")
    # The code node isn't mapped, so the agent that feeds it is the writer.
    assert _memory_hops(result) == {
        ("agent_agent", "writeMemory", "memory_prefs"),
        ("memory_prefs", "readMemory", "tool_crm_lookup"),
    }


def test_dify_constant_assignment_has_no_writer():
    dsl = """
workflow:
  conversation_variables: [{name: stage}]
  graph:
    nodes:
      - {id: a, data: {type: llm, title: Agent}}
      - id: w
        data:
          type: assigner
          items: [{variable_selector: [conversation, stage], input_type: constant, value: done}]
      - {id: r, data: {type: llm, title: Router, prompt: "Stage: {{#conversation.stage#}}"}}
    edges:
      - {source: a, target: w}
      - {source: w, target: r}
"""
    result = analyze_text(dsl, framework_hint="dify")
    assert [n.id for n in _memory_nodes(result)] == ["memory_stage"]
    assert _memory_hops(result) == {("memory_stage", "readMemory", "agent_router")}


def test_dify_unused_conversation_variable_is_skipped():
    # Nothing writes or reads `unused`, so it is no memory flow and must not
    # trip FH-029 (memory without retention TTL).
    dsl = """
workflow:
  conversation_variables: [{name: unused}]
  graph:
    nodes:
      - {id: s, data: {type: start, title: In}}
      - {id: a, data: {type: llm, title: Agent}}
    edges:
      - {source: s, target: a}
"""
    result = analyze_text(dsl, framework_hint="dify")
    assert _memory_nodes(result) == []
    assert "FH-029" not in _rule_ids(result.findings)


def test_dify_answer_node_reads_the_variable_it_renders():
    dsl = """
workflow:
  conversation_variables: [{name: notes}]
  graph:
    nodes:
      - {id: s, data: {type: start, title: In}}
      - {id: ans, data: {type: answer, title: Reply, answer: "Your notes: {{#conversation.notes#}}"}}
    edges:
      - {source: s, target: ans}
"""
    result = analyze_text(dsl, framework_hint="dify")
    assert _memory_hops(result) == {("memory_notes", "readMemory", "output_reply")}


# --- tool-mediated FH-008 / FH-025 ------------------------------------------


def test_crewai_browser_tool_without_allowlist_fires_fh008():
    # Adapters emit agent -invokeTool-> tool -fetchWeb-> asset; FH-008 used to
    # look only for fetchWeb on the agent -> tool hop and never fired.
    yaml_text = """
agents:
  researcher: {role: Researcher, tools: ["browser.visit"]}
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    fh008 = [f for f in result.findings if f.rule_id == "FH-008"]
    assert len(fh008) == 1
    # Both the invoke hop and the tool's fetchWeb hop are highlighted.
    capabilities = {e.id: e.capability for e in result.ir.edges}
    assert {capabilities[eid] for eid in fh008[0].edges} == {"invokeTool", "fetchWeb"}
    # Every highlighted edge has both ends on the path, so playback reaches it.
    ends = {e.id: (e.source, e.target) for e in result.ir.edges}
    for eid in fh008[0].edges:
        assert set(ends[eid]) <= set(fh008[0].path)


def test_crewai_browser_tool_with_allowlist_does_not_fire_fh008():
    yaml_text = """
agents:
  researcher: {role: Researcher, tools: [{name: browser.visit, allowlist_present: true}]}
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert "FH-008" not in _rule_ids(result.findings)


def test_crewai_tool_read_of_external_asset_fires_fh025():
    yaml_text = """
agents:
  analyst:
    role: Analyst
    tools: [{name: db.query, reads_asset: {name: Partner DB, boundary: external}}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    fh025 = [f for f in result.findings if f.rule_id == "FH-025"]
    assert len(fh025) == 1
    assert fh025[0].path == ["agent_analyst", "tool_db_query", "asset_partner_db"]


def test_dify_external_knowledge_fires_fh025():
    dsl = """
workflow:
  graph:
    nodes:
      - {id: s, data: {type: start, title: In}}
      - {id: l, data: {type: llm, title: Answerer}}
      - {id: k, data: {type: knowledge-retrieval, title: Vendor KB, boundary: external}}
    edges:
      - {source: s, target: l}
      - {source: l, target: k}
"""
    result = analyze_text(dsl, framework_hint="dify")
    assert "FH-025" in _rule_ids(result.findings)


# --- declared properties reach the analysis ---------------------------------


def test_crewai_regulated_data_fires_fh026():
    yaml_text = """
agents:
  clerk:
    role: Clerk
    data_assets: [{name: Patients, sensitivity: critical, contains_regulated_data: [gdpr]}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert "FH-026" in _rule_ids(result.findings)


def test_crewai_public_channel_recipient_is_kept():
    yaml_text = """
agents:
  bot:
    role: Bot
    outputs: [{name: Community forum, boundary: external, recipient_type: public_channel}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    output = next(n for n in result.ir.nodes if n.type.value == "output")
    assert output.properties["recipient_type"] == "public_channel"


def test_crewai_elevated_tool_from_exposed_agent_fires_fh017():
    yaml_text = """
agents:
  frontdesk:
    role: Front desk
    exposure_boundary: external
    tools: [{name: admin.console, authentication_scope: elevated}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert "FH-017" in _rule_ids(result.findings)


@pytest.mark.parametrize("verb", ["deployRelease", "moveResource"])
def test_crewai_declared_publish_capability_fires_fh012(verb):
    # A declared deployRelease/moveResource used to produce only invokeTool, so
    # external publication (FH-012) was unreachable from any framework file.
    yaml_text = f"""
agents:
  releaser:
    role: Releaser
    inputs: ["Inbound email"]
    tools: [{{name: release.tool, capability_kinds: [{verb}]}}]
tasks: {{}}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert verb in {e.capability for e in result.ir.edges}
    assert "FH-012" in _rule_ids(result.findings)


@pytest.mark.parametrize("verb", ["deployRelease", "moveResource"])
def test_declared_publish_capability_is_irreversible_and_not_a_message(verb):
    # The verb implies an irreversible side effect (FH-032 for deployRelease),
    # and its destination isn't a message output (no FH-022).
    yaml_text = f"""
agents:
  releaser:
    role: Releaser
    inputs: ["Inbound email"]
    tools: [{{name: release.tool, capability_kinds: [{verb}]}}]
tasks: {{}}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    tool = next(n for n in result.ir.nodes if n.type.value == "tool")
    assert tool.properties["side_effect"] is True
    assert tool.properties["side_effect_reversible"] is False
    fired = _rule_ids(result.findings)
    assert "FH-022" not in fired
    assert ("FH-032" in fired) == (verb == "deployRelease")


def test_declared_reversibility_overrides_the_publish_default():
    yaml_text = """
agents:
  releaser:
    role: Releaser
    tools: [{name: release.tool, capability_kinds: [deployRelease], side_effect_reversible: true}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    tool = next(n for n in result.ir.nodes if n.type.value == "tool")
    assert tool.properties["side_effect_reversible"] is True
    assert "FH-032" not in _rule_ids(result.findings)


def test_dify_http_request_keeps_declared_properties():
    # http-request defaults to an external send, but what the file declares wins.
    dsl = """
workflow:
  graph:
    nodes:
      - {id: s, data: {type: start, title: In}}
      - {id: l, data: {type: llm, title: Agent}}
      - id: h
        data: {type: http-request, title: Inventory API, capability_kinds: [read],
               target_boundary: internal, side_effect: false}
      - {id: d, data: {type: http-request, title: Partner API}}
    edges:
      - {source: s, target: l}
      - {source: l, target: h}
      - {source: l, target: d}
"""
    result = analyze_text(dsl, framework_hint="dify")
    tools = {n.name: n.properties for n in result.ir.nodes if n.type.value == "tool"}
    declared = tools["Inventory API"]
    assert declared["capability_kinds"] == ["read"]
    assert declared["target_boundary"] == "internal"
    assert declared["side_effect"] is False
    # Undeclared, it's still treated as an external send.
    assert tools["Partner API"]["capability_kinds"] == ["send", "invokeTool"]
    assert tools["Partner API"]["target_boundary"] == "external"


# --- ignored property declarations -------------------------------------------


def _ignored(result):
    return [w for w in result.ir.parse_warnings if w["kind"] == "ignored_property"]


def test_typo_in_declared_property_is_reported():
    yaml_text = """
agents:
  clerk:
    role: Clerk
    data_assets: [{name: Patients, contains_regulated_dta: [gdpr]}]
tasks: {}
"""
    result = analyze_text(yaml_text, framework_hint="crewai")
    assert "FH-026" not in _rule_ids(result.findings)
    [warning] = _ignored(result)
    assert warning["properties"] == ["contains_regulated_dta"]
    assert warning["suggestion"] == "contains_regulated_data"
    assert warning["node"] == "Patients"
    assert warning["node_type"] == "data_asset"
    assert warning["rules"] == []


def test_property_of_another_node_type_is_reported():
    yaml_text = """
graph:
  nodes:
    - {name: intake, type: agent, recipient_type: public_channel}
  edges: []
"""
    result = analyze_text(yaml_text, framework_hint="langgraph")
    [warning] = _ignored(result)
    assert warning["properties"] == ["recipient_type"]
    assert warning["suggestion"] is None
    assert warning["node_type"] == "agent"


def test_dify_typo_is_reported():
    dsl = """
workflow:
  graph:
    nodes:
      - {id: l, data: {type: llm, title: Agent, exposure_boundry: external}}
    edges: []
"""
    result = analyze_text(dsl, framework_hint="dify")
    [warning] = _ignored(result)
    assert warning["suggestion"] == "exposure_boundary"


@pytest.mark.parametrize(
    "fixture",
    ["crewai_risky.yaml", "crewai_safe.yaml", "dify_risky.yaml", "dify_safe.yaml",
     "langgraph_risky.yaml", "langgraph_safe.yaml"],
)
def test_framework_native_keys_are_not_reported(fixture):
    # backstory, goal, title, delegates_to... belong to the framework.
    assert _ignored(analyze_text(fixture_text(fixture))) == []


def test_dify_declared_properties_are_kept():
    dsl = """
workflow:
  graph:
    nodes:
      - {id: s, data: {type: start, title: In, trust_level: semi_trusted}}
      - {id: l, data: {type: llm, title: Agent, exposure_boundary: external}}
      - {id: a, data: {type: answer, title: Reply, boundary: external}}
    edges:
      - {source: s, target: l}
      - {source: l, target: a}
"""
    result = analyze_text(dsl, framework_hint="dify")
    props = {n.type.value: n.properties for n in result.ir.nodes}
    assert props["input"]["trust_level"] == "semi_trusted"
    assert props["agent"]["exposure_boundary"] == "external"
    assert props["output"]["boundary"] == "external"
    assert props["output"]["output_kind"] == "external_action"


def test_empty_crewai_agents_rejected():
    from app.core.ir.models import IRValidationError

    with pytest.raises(IRValidationError):
        analyze_text("agents: {}\ntasks: {}\n", framework_hint="crewai")
