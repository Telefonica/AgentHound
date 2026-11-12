"""Root-cause grouping of findings (``app/core/rules/grouping.py``)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.catalogs import rule_catalog
from app.core.controls import simulator
from app.core.ir.models import ControlApplication
from app.core.pipeline import analyze_text
from app.core.rules.grouping import GROUP_BY_RULE, group_by_for, group_findings, grouped_total
from app.main import app

from .conftest import findings_for, fixture_text

client = TestClient(app)

# Three full-auto agents fed by one untrusted input: FH-028/FH-035 fire once per
# agent, and FH-003 fires once per route from the same input to each of two
# external outputs ("one story, several endings").
_FANOUT = """
metadata: {name: Fan-out}
nodes:
  - {id: in1, type: input, name: Form, properties: {trust_level: untrusted}}
  - {id: a1, type: agent, name: Intake}
  - {id: a2, type: agent, name: Mailer}
  - {id: a3, type: agent, name: Notifier}
  - {id: out_mail, type: output, name: Email, properties: {boundary: external}}
  - {id: out_slack, type: output, name: Slack, properties: {boundary: external}}
edges:
  - {id: e1, source: in1, target: a1, capability: receiveInstruction}
  - {id: e2, source: a1, target: a2, capability: dataFlow}
  - {id: e3, source: a1, target: a3, capability: dataFlow}
  - {id: e4, source: a2, target: out_mail, capability: send}
  - {id: e5, source: a3, target: out_slack, capability: send}
"""


def _groups(findings):
    return {g["group_id"]: g for g in group_findings(findings)}


def test_policy_absence_rules_collapse_to_one_group():
    findings = analyze_text(_FANOUT).findings
    groups = _groups(findings)
    for rule_id in ("FH-028", "FH-035"):
        per_agent = findings_for(findings, rule_id)
        assert len(per_agent) == 3
        assert len({f.group_id for f in per_agent}) == 1
        group = groups[per_agent[0].group_id]
        assert group["group_by"] == GROUP_BY_RULE
        assert group["anchor_node_id"] is None
        assert group["count"] == 3
        assert group["finding_ids"] == [f.id for f in per_agent]


def test_path_rule_endings_from_one_entry_share_a_group():
    findings = analyze_text(_FANOUT).findings
    routes = findings_for(findings, "FH-003")
    assert {f.path[-1] for f in routes} == {"out_mail", "out_slack"}
    assert len({f.group_id for f in routes}) == 1
    assert _groups(findings)[routes[0].group_id]["anchor_node_id"] == "in1"


def test_single_node_findings_stay_one_per_group():
    # FH-005 is anchored on its tool and grouped by source, so two dangerous
    # tools stay two separate groups.
    text = """
metadata: {name: Two tools}
nodes:
  - {id: a1, type: agent, name: Ops}
  - {id: t1, type: tool, name: Drop table, properties: {side_effect: true, side_effect_reversible: false}}
  - {id: t2, type: tool, name: Wipe disk, properties: {side_effect: true, side_effect_reversible: false}}
edges:
  - {id: e1, source: a1, target: t1, capability: invokeTool}
  - {id: e2, source: a1, target: t2, capability: invokeTool}
"""
    fh005 = findings_for(analyze_text(text).findings, "FH-005")
    assert group_by_for("FH-005") != GROUP_BY_RULE
    assert {f.path[0] for f in fh005} == {"t1", "t2"}
    assert len({f.group_id for f in fh005}) == 2


def test_every_finding_is_in_exactly_one_group_and_ordering_is_kept():
    findings = analyze_text(_FANOUT).findings
    groups = group_findings(findings)
    assert sorted(fid for g in groups for fid in g["finding_ids"]) == sorted(f.id for f in findings)
    assert all(f.group_id for f in findings)
    # Groups are ordered by their best finding, which is also their representative.
    by_id = {f.id: f for f in findings}
    maxima = [g["max_score"] for g in groups]
    assert maxima == sorted(maxima, reverse=True)
    for group in groups:
        rep = by_id[group["representative_finding_id"]]
        assert rep.score == group["max_score"] == max(by_id[i].score for i in group["finding_ids"])
        assert rep.severity.value == group["severity"]


def test_grouping_is_idempotent():
    findings = analyze_text(_FANOUT).findings
    assert group_findings(findings) == group_findings(findings)


def test_grouping_does_not_change_scores_or_count():
    findings = analyze_text(_FANOUT).findings
    snapshot = [(f.id, f.rule_id, f.score, f.severity) for f in findings]
    group_findings(findings)
    assert [(f.id, f.rule_id, f.score, f.severity) for f in findings] == snapshot


def test_group_by_catalog_values_are_valid():
    for rule_id, rule in rule_catalog().items():
        assert rule.get("group_by", "source") in {"rule", "source"}, rule_id


def test_grouped_total_counts_each_cause_once():
    findings = analyze_text(_FANOUT).findings
    best: dict[str, float] = {}
    for f in findings:
        best[f.group_id] = max(best.get(f.group_id, 0.0), f.score)
    assert grouped_total(findings) == sum(best.values())
    assert grouped_total(findings) < sum(f.score for f in findings)


def test_simulation_reports_reduction_by_group():
    stored = analyze_text(fixture_text("hiresmart_generic.yaml"))
    out = simulator.evaluate(
        stored, [ControlApplication(control_id="humanInTheLoop", target_node_id="output_email_candidate")]
    )
    reduction = out["risk_reduction"]
    assert {"absolute", "percentage", "by_group"} <= reduction.keys()
    by_group = reduction["by_group"]
    assert by_group["absolute"] == round(grouped_total(out["before"]) - grouped_total(out["after"]), 1)
    assert 0 < by_group["percentage"] <= 100


# --- API -------------------------------------------------------------------


def _create_analyzed(text: str) -> tuple[str, dict]:
    resp = client.post("/analyses", files={"file": ("a.yaml", text, "application/x-yaml")})
    assert resp.status_code == 200, resp.text
    analysis_id = resp.json()["analysis_id"]
    analyzed = client.post(f"/analyses/{analysis_id}/analyze", json=None)
    assert analyzed.status_code == 200, analyzed.text
    return analysis_id, analyzed.json()


def test_analyze_and_findings_endpoints_return_matching_groups():
    analysis_id, analyzed = _create_analyzed(_FANOUT)
    listed = client.get(f"/analyses/{analysis_id}/findings").json()
    assert analyzed["groups"] == listed["groups"]
    assert len(listed["groups"]) < len(listed["findings"])
    group_ids = {g["group_id"] for g in listed["groups"]}
    assert all(f["group_id"] in group_ids for f in listed["findings"])

    detail = client.get(f"/analyses/{analysis_id}/findings/{listed['findings'][0]['id']}").json()
    assert detail["finding"]["group_id"] == listed["findings"][0]["group_id"]


def test_simulate_endpoint_includes_by_group():
    analysis_id, _ = _create_analyzed(fixture_text("hiresmart_generic.yaml"))
    resp = client.post(
        f"/analyses/{analysis_id}/simulate-controls",
        json={"controls_to_apply": [{"control_id": "humanInTheLoop", "target_node_id": "output_email_candidate"}]},
    )
    assert resp.status_code == 200, resp.text
    assert {"absolute", "percentage"} <= resp.json()["risk_reduction"]["by_group"].keys()
