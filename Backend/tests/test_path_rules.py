"""Unit tests for the path/traversal rules in ``app/core/rules/path_rules.py``.

These rules reason over multi-node capability paths (untrusted input →
… → sensitive sink). Each rule is exercised with a minimal inline
architecture so the trigger and its negative case are isolated.

Fixture-based, cross-rule pipeline assertions live in test_rules_engine.py.
"""

from app.core.pipeline import analyze_text

from .conftest import findings_for, rule_ids


# --- FH-001 / FH-002 / FH-003: exfiltration path preconditions ----------------
# fh_001 and fh_003 live in path_rules.py; fh_002 lives in node_rules.py, but its
# read-edge precondition is exercised here alongside its FH-001 sibling because
# they share the same graph shape and spec section (section 8).

def test_sensitive_asset_reached_without_read_does_not_fire_fh002():
    # The sensitive asset is reached via dataFlow, not a read edge; per spec
    # section 8 FH-002 must not fire even though a read exists earlier on the
    # path (agent reads a public asset).
    yaml_text = """
metadata: {name: NoReadIntoSensitive}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: agA, type: agent, name: A}
  - {id: asPub, type: data_asset, name: Public, properties: {sensitivity: low}}
  - {id: agB, type: agent, name: B}
  - {id: asSens, type: data_asset, name: Secret, properties: {sensitivity: high}}
edges:
  - {id: e1, source: in1, target: agA, capability: receiveInstruction}
  - {id: e2, source: agA, target: asPub, capability: read}
  - {id: e3, source: asPub, target: agB, capability: dataFlow}
  - {id: e4, source: agB, target: asSens, capability: dataFlow}
"""
    result = analyze_text(yaml_text)
    assert "FH-002" not in rule_ids(result.findings)


def test_fh001_needs_read_edge_into_sensitive_asset():
    # Sensitive asset is reached via dataFlow (read is into a public asset), so
    # per spec section 8 the "read into a high/critical asset" hop is absent and
    # FH-001 must not fire.
    yaml_text = """
metadata: {name: FH001NoSensitiveRead}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: agA, type: agent, name: A}
  - {id: asPub, type: data_asset, name: Public, properties: {sensitivity: low}}
  - {id: agB, type: agent, name: B}
  - {id: asSens, type: data_asset, name: Secret, properties: {sensitivity: high}}
  - {id: agC, type: agent, name: C}
  - {id: out1, type: output, name: Email, properties: {boundary: external, approval_gate_present: false}}
edges:
  - {id: e1, source: in1, target: agA, capability: receiveInstruction}
  - {id: e2, source: agA, target: asPub, capability: read}
  - {id: e3, source: asPub, target: agB, capability: dataFlow}
  - {id: e4, source: agB, target: asSens, capability: dataFlow}
  - {id: e5, source: asSens, target: agC, capability: dataFlow}
  - {id: e6, source: agC, target: out1, capability: send}
"""
    assert "FH-001" not in rule_ids(analyze_text(yaml_text).findings)


def test_fh001_needs_send_edge_into_output():
    # A sensitive read exists, but the final hop into the external output is
    # dataFlow, not send, so FH-001 must not fire (spec section 8).
    yaml_text = """
metadata: {name: FH001NoSendToOutput}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: agA, type: agent, name: A}
  - {id: asSens, type: data_asset, name: Secret, properties: {sensitivity: high}}
  - {id: agB, type: agent, name: B}
  - {id: out1, type: output, name: Email, properties: {boundary: external, approval_gate_present: false}}
edges:
  - {id: e1, source: in1, target: agA, capability: receiveInstruction}
  - {id: e2, source: agA, target: asSens, capability: read}
  - {id: e3, source: asSens, target: agB, capability: dataFlow}
  - {id: e4, source: agB, target: out1, capability: dataFlow}
"""
    assert "FH-001" not in rule_ids(analyze_text(yaml_text).findings)


def test_fh003_needs_send_edge_into_output():
    # A send occurs earlier on the path, but the final hop into the external
    # output is dataFlow, so FH-003 must not fire (spec section 8).
    yaml_text = """
metadata: {name: FH003NoSendToOutput}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: agA, type: agent, name: A}
  - {id: agB, type: agent, name: B}
  - {id: out1, type: output, name: Email, properties: {boundary: external, approval_gate_present: false}}
edges:
  - {id: e1, source: in1, target: agA, capability: receiveInstruction}
  - {id: e2, source: agA, target: agB, capability: send}
  - {id: e3, source: agB, target: out1, capability: dataFlow}
"""
    assert "FH-003" not in rule_ids(analyze_text(yaml_text).findings)


# --- FH-009: untrusted write to shared memory, then a second agent acts -------
# Canonical example ported from the removed test_rules_fase3.py: a shared memory
# (memory_kind=shared_between_agents, scope=user) written by an untrusted path
# and read by a second agent that can reach an external output.

_FH009_SHARED_MEMORY = """
metadata: {name: FH009MemoryKind}
nodes:
  - {id: in1, type: input, name: UserMsg, properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: Writer}
  - {id: m1,  type: memory, name: SharedPrefs,
     properties: {memory_kind: shared_between_agents, scope: user, write_validated: false}}
  - {id: ag2, type: agent, name: Reader}
  - {id: out1, type: output, name: Ext, properties: {boundary: external}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: ag1, target: m1,  capability: writeMemory}
  - {id: e3, source: m1,  target: ag2, capability: readMemory}
  - {id: e4, source: ag2, target: out1, capability: send}
"""


def test_fh009_fires_when_memory_kind_is_shared_between_agents():
    """FH-009 fires on the canonical memory_kind=shared_between_agents / scope=user example."""
    result = analyze_text(_FH009_SHARED_MEMORY)
    findings = findings_for(result.findings, "FH-009")
    assert findings
    # The reported attack path should reach the downstream external sink, not
    # stop at the agent that reads the poisoned memory.
    assert findings[0].path[-1] == "out1"
    assert "e4" in findings[0].edges


# Two untrusted write paths reach the same shared memory. The rule now iterates
# every write path (not just write_paths[0]), so each (write_path, reader) pair
# yields its own finding: two paths => two FH-009 findings.

_FH009_MULTIPLE_WRITE_PATHS = """
metadata: {name: FH009MultiWrite}
nodes:
  - {id: in1, type: input, name: UserMsg, properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: WriterA}
  - {id: ag2, type: agent, name: WriterB}
  - {id: m1,  type: memory, name: SharedPrefs,
     properties: {memory_kind: shared_between_agents, scope: user, write_validated: false}}
  - {id: ag3, type: agent, name: Reader}
  - {id: out1, type: output, name: Ext, properties: {boundary: external}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: in1, target: ag2, capability: receiveInstruction}
  - {id: e3, source: ag1, target: m1,  capability: writeMemory}
  - {id: e4, source: ag2, target: m1,  capability: writeMemory}
  - {id: e5, source: m1,  target: ag3, capability: readMemory}
  - {id: e6, source: ag3, target: out1, capability: send}
"""


def test_fh009_emits_one_finding_per_untrusted_write_path():
    """Two distinct untrusted write paths into the shared memory => two findings."""
    result = analyze_text(_FH009_MULTIPLE_WRITE_PATHS)
    assert len(findings_for(result.findings, "FH-009")) == 2


# --- FH-012: external publication from untrusted input via a deploy capability -
# Note on severity: FH-012 uses base_severity=critical (8.0) plus an always-
# external reach (2.0), which already saturates the score cap (10.0). So the
# reversibility signal never changes the *severity band* — it is observable via
# the finding's `side_effect_reversible` evidence field, which is what these
# tests pin. The reversibility rework changed two things here: the fail-safe
# default (missing evidence => irreversible) and reading reversibility only from
# a `tool` pre-target.

_FH012_AGENT_DEPLOY = """
metadata: {name: FH012AgentDeploy}
nodes:
  - {id: in1, type: input, name: UserMsg, properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: Deployer}
  - {id: out1, type: output, name: Prod, properties: {boundary: external}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: ag1, target: out1, capability: deployRelease}
"""


def test_fh012_non_tool_pretarget_is_treated_as_irreversible():
    """A non-tool node before the target never contributes reversibility: fail-safe False."""
    result = analyze_text(_FH012_AGENT_DEPLOY)
    findings = findings_for(result.findings, "FH-012")
    assert findings
    assert findings[0].evidence["side_effect_reversible"] is False


_FH012_TOOL_DEPLOY = """
metadata: {{name: FH012ToolDeploy}}
nodes:
  - {{id: in1, type: input, name: UserMsg, properties: {{trust_level: untrusted}}}}
  - {{id: ag1, type: agent, name: Operator}}
  - {{id: t1, type: tool, name: deploy.tool, properties: {{side_effect_reversible: {reversible}}}}}
  - {{id: out1, type: output, name: Prod, properties: {{boundary: external}}}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: t1,  capability: invokeTool}}
  - {{id: e3, source: t1,  target: out1, capability: deployRelease}}
"""


def test_fh012_reversible_tool_pretarget_is_recorded_as_reversible():
    """When the deploy is driven by a reversible tool, reversibility is honoured."""
    result = analyze_text(_FH012_TOOL_DEPLOY.format(reversible="true"))
    findings = findings_for(result.findings, "FH-012")
    assert findings
    assert findings[0].evidence["side_effect_reversible"] is True


def test_fh012_tool_pretarget_defaults_to_irreversible_when_unspecified():
    """Absent reversibility evidence on the tool defaults to False (fail-safe)."""
    result = analyze_text(_FH012_TOOL_DEPLOY.format(reversible="~"))
    findings = findings_for(result.findings, "FH-012")
    assert findings
    assert findings[0].evidence["side_effect_reversible"] is False


# --- FH-030: two side-effect tools on a path with no verifyResult after the last

_FH030 = """
metadata: {{name: FH030}}
nodes:
  - {{id: in1, type: input, name: Start}}
  - {{id: ag1, type: agent, name: Executor}}
  - {{id: t1, type: tool, name: step1, properties: {{side_effect: true}}}}
  - {{id: t2, type: tool, name: step2, properties: {{side_effect: true}}}}
  - {{id: out1, type: output, name: Done}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: t1, capability: invokeTool}}
  - {{id: e3, source: t1, target: t2, capability: invokeTool}}
  - {{id: e4, source: t2, target: out1, capability: {last_cap}}}
"""


def test_fh030_fires_when_no_verify_result_after_last_tool():
    result = analyze_text(_FH030.format(last_cap="send"))
    assert "FH-030" in rule_ids(result.findings)


def test_fh030_suppressed_when_verify_result_follows_last_tool():
    result = analyze_text(_FH030.format(last_cap="verifyResult"))
    assert "FH-030" not in rule_ids(result.findings)


# --- FH-007: >= 3-agent chain to an external output with no approval gate -----

_FH007 = """
metadata: {{name: FH007Chain}}
nodes:
  - {{id: in1, type: input, name: Form, properties: {{trust_level: untrusted}}}}
  - {{id: ag1, type: agent, name: A}}
  - {{id: ag2, type: agent, name: B, properties: {{approval_gate_present: {gate}}}}}
  - {{id: ag3, type: agent, name: C}}
  - {{id: out1, type: output, name: Ext, properties: {{boundary: external}}}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: ag2, capability: delegateTo}}
  - {{id: e3, source: ag2, target: ag3, capability: dataFlow}}
  - {{id: e4, source: ag3, target: out1, capability: send}}
"""


def test_fh007_fires_on_ungated_three_agent_chain():
    result = analyze_text(_FH007.format(gate="false"))
    assert "FH-007" in rule_ids(result.findings)


def test_fh007_suppressed_when_an_agent_has_an_approval_gate():
    result = analyze_text(_FH007.format(gate="true"))
    assert "FH-007" not in rule_ids(result.findings)


# --- FH-010: code execution reachable from untrusted input -------------------

_FH010 = """
metadata: {{name: CodeExec}}
nodes:
  - {{id: in1, type: input, name: Form, properties: {{trust_level: untrusted}}}}
  - {{id: ag1, type: agent, name: Agent}}
  - {{id: t1, type: tool, name: python.run, properties: {{sandbox_enabled: {sandbox}}}}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: t1, capability: executeCode}}
"""


def test_fh010_fires_on_unsandboxed_execution():
    result = analyze_text(_FH010.format(sandbox="false"))
    assert "FH-010" in rule_ids(result.findings)


def test_fh010_silent_when_sandbox_enabled():
    result = analyze_text(_FH010.format(sandbox="true"))
    assert "FH-010" not in rule_ids(result.findings)


def test_fh010_fires_when_sandbox_flag_is_a_quoted_false_string():
    # A quoted YAML boolean must not be read as truthy and silently suppress the
    # finding (fail-unsafe direction for a security scanner).
    result = analyze_text(_FH010.format(sandbox='"false"'))
    assert "FH-010" in rule_ids(result.findings)


def test_fh010_does_not_claim_missing_allowlist_when_present():
    # FH-010 still fires (sandbox off), but must not report allowlist_missing when
    # the tool declares an allowlist; the score drops by the allowlist weight.
    yaml_text = """
metadata: {name: ExecWithAllowlist}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: Agent}
  - {id: t1, type: tool, name: python.run, properties: {sandbox_enabled: false, allowlist_present: true}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: ag1, target: t1, capability: executeCode}
"""
    findings = analyze_text(yaml_text).findings
    fh010 = next((f for f in findings if f.rule_id == "FH-010"), None)
    assert fh010 is not None
    assert fh010.evidence["allowlist_present"] is True
    # base 6.0 + reversibility 1.0, with NO allowlist_missing (+0.7) = 7.0.
    assert fh010.score == 7.0


def test_fh010_requires_agent_before_executecode():
    # A direct input -> tool executeCode edge (no mediating agent) does not match
    # the spec pattern and must not fire.
    yaml_text = """
metadata: {name: NoAgentExec}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: t1, type: tool, name: python.run, properties: {sandbox_enabled: false}}
edges:
  - {id: e1, source: in1, target: t1, capability: executeCode}
"""
    assert "FH-010" not in rule_ids(analyze_text(yaml_text).findings)


# --- FH-011: destructive change over a >= medium resource --------------------

_FH011 = """
metadata: {{name: Destructive}}
nodes:
  - {{id: in1, type: input, name: Webhook, properties: {{trust_level: untrusted}}}}
  - {{id: ag1, type: agent, name: Agent}}
  - {{id: t1, type: tool, name: calendar.delete, properties: {{requires_approval: {approval}, side_effect_reversible: {reversible}}}}}
  - {{id: as1, type: data_asset, name: Calendar, properties: {{sensitivity: {sensitivity}}}}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: t1, capability: invokeTool}}
  - {{id: e3, source: t1, target: as1, capability: deleteResource}}
"""


def test_fh011_fires_on_irreversible_delete():
    result = analyze_text(
        _FH011.format(approval="false", reversible="false", sensitivity="high")
    )
    assert "FH-011" in rule_ids(result.findings)


def test_fh011_silent_when_approved_and_reversible():
    result = analyze_text(
        _FH011.format(approval="true", reversible="true", sensitivity="high")
    )
    assert "FH-011" not in rule_ids(result.findings)


def test_fh011_silent_on_low_sensitivity_resource():
    # A destructive change over a low-sensitivity resource is below the >= medium
    # threshold, so FH-011 must not fire even with an unsafe tool.
    result = analyze_text(
        _FH011.format(approval="false", reversible="false", sensitivity="low")
    )
    assert "FH-011" not in rule_ids(result.findings)


def test_fh011_normalizes_quoted_boolean_tool_flags():
    # Quoted "false" flags must be read as False (tool unsafe -> fire); quoted
    # "true" flags must be read as True (tool safe -> no fire).
    fired = analyze_text(
        _FH011.format(approval='"false"', reversible='"false"', sensitivity="high")
    )
    assert "FH-011" in rule_ids(fired.findings)
    safe = analyze_text(
        _FH011.format(approval='"true"', reversible='"true"', sensitivity="high")
    )
    assert "FH-011" not in rule_ids(safe.findings)


def test_fh011_requires_an_agent_to_invoke_the_destructive_tool():
    # A hand-authored input -> tool -> asset shortcut has no agent invoking the
    # tool, so it does not match the spec pattern and must not fire.
    yaml_text = """
metadata: {name: NoAgentBeforeTool}
nodes:
  - {id: in1, type: input, name: Webhook, properties: {trust_level: untrusted}}
  - {id: t1, type: tool, name: calendar.delete, properties: {requires_approval: false, side_effect_reversible: false}}
  - {id: as1, type: data_asset, name: Calendar, properties: {sensitivity: high}}
edges:
  - {id: e1, source: in1, target: t1, capability: invokeTool}
  - {id: e2, source: t1, target: as1, capability: deleteResource}
"""
    assert "FH-011" not in rule_ids(analyze_text(yaml_text).findings)


def test_fh011_matches_sensitivity_regardless_of_casing():
    # An enum typo'd as "High " must be canonicalised so the >= medium target
    # filter still selects the asset (fail-unsafe otherwise).
    result = analyze_text(
        _FH011.format(approval="false", reversible="false", sensitivity='"High "')
    )
    assert "FH-011" in rule_ids(result.findings)


def test_fh011_ignores_unsafe_tool_that_does_not_mediate_the_destructive_hop():
    # An earlier read tool is unsafe (no approval), but the destructive delete is
    # performed by a different, safe tool (approved and reversible). FH-011 keys
    # on the mediating tool only, so it must not fire.
    yaml_text = """
metadata: {name: MisattributedUnsafeTool}
nodes:
  - {id: in1, type: input, name: Webhook, properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: Reader}
  - {id: t_read, type: tool, name: ats.query, properties: {requires_approval: false}}
  - {id: ag2, type: agent, name: Mutator}
  - {id: t_del, type: tool, name: calendar.delete, properties: {requires_approval: true, side_effect_reversible: true}}
  - {id: as1, type: data_asset, name: Calendar, properties: {sensitivity: high}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: ag1, target: t_read, capability: invokeTool}
  - {id: e3, source: t_read, target: ag2, capability: dataFlow}
  - {id: e4, source: ag2, target: t_del, capability: invokeTool}
  - {id: e5, source: t_del, target: as1, capability: deleteResource}
"""
    assert "FH-011" not in rule_ids(analyze_text(yaml_text).findings)


# --- FH-013: internal sensitive data sent to a public channel unfiltered ------

_FH013 = """
metadata: {{name: FH013PublicLeak}}
nodes:
  - {{id: ag1, type: agent, name: Reporter}}
  - {{id: as1, type: data_asset, name: Salaries, properties: {{sensitivity: high, boundary: internal}}}}
  - {{id: out1, type: output, name: Slack,
     properties: {{recipient_type: public_channel, pii_redaction_present: {redaction}, content_filter_present: false}}}}
edges:
  - {{id: e1, source: ag1, target: as1, capability: read}}
  - {{id: e2, source: ag1, target: out1, capability: send}}
"""


def test_fh013_fires_on_unfiltered_public_broadcast_of_sensitive_read():
    result = analyze_text(_FH013.format(redaction="false"))
    assert "FH-013" in rule_ids(result.findings)


def test_fh013_suppressed_when_pii_redaction_present():
    result = analyze_text(_FH013.format(redaction="true"))
    assert "FH-013" not in rule_ids(result.findings)


# --- FH-015: high-autonomy agent driven by untrusted intent interpretation ----

_FH015 = """
metadata: {{name: FH015TrustLevel}}
nodes:
  - {{id: in1, type: input, name: Request, properties: {{trust_level: {trust_level}}}}}
  - {{id: ag1, type: agent, name: Planner, properties: {{autonomy_level: full_auto}}}}
  - {{id: t1, type: tool, name: parser}}
  - {{id: out1, type: output, name: Notify}}
edges:
  - {{id: e1, source: in1, target: ag1, capability: receiveInstruction}}
  - {{id: e2, source: ag1, target: t1, capability: interpretIntent}}
  - {{id: e3, source: ag1, target: out1, capability: send}}
"""


def test_fh015_silent_when_input_is_authenticated_human():
    result = analyze_text(_FH015.format(trust_level="authenticated_human"))
    assert "FH-015" not in rule_ids(result.findings)


def test_fh015_fires_when_input_is_untrusted():
    result = analyze_text(_FH015.format(trust_level="untrusted"))
    assert "FH-015" in rule_ids(result.findings)


_FH015_INBOUND_INTERPRET = """
metadata: {name: FH015InboundInterpret}
nodes:
  - {id: in1, type: input, name: Request,
     properties: {trust_level: untrusted}}
  - {id: ag1, type: agent, name: Planner,
     properties: {autonomy_level: full_auto}}
  - {id: out1, type: output, name: Action,
     properties: {reversible: false}}
edges:
  - {id: e1, source: in1, target: ag1, capability: receiveInstruction}
  - {id: e2, source: in1, target: ag1, capability: interpretIntent}
  - {id: e3, source: ag1, target: out1, capability: send}
"""


def test_fh015_fires_when_interpret_intent_is_inbound():
    """FH-015 must fire even when interpretIntent arrives *at* the agent (inbound edge)."""
    result = analyze_text(_FH015_INBOUND_INTERPRET)
    assert "FH-015" in rule_ids(result.findings)
