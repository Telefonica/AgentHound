"""``catalogs/adapter_coverage.yaml`` matches what each adapter can reach.

Each ``coverage_<framework>.yaml`` fixture is written to reach every rule its
adapter can express, using the declarations the catalog names. So for each
framework the rules that fire must be exactly the catalog minus its
``not_expressible`` gaps. A rule that becomes reachable (or stops being) fails
here until the catalog and the fixture are updated together.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.catalogs import (
    adapter_coverage_catalog,
    capabilities,
    default_properties,
    node_property_catalog,
    rule_catalog,
)
from app.core.coverage import analysis_warnings, coverage_warnings
from app.core.ir.models import NodeType, SourceFramework
from app.core.parser.adapters._common import declarable_properties
from app.core.pipeline import analyze_text
from app.main import app

from .conftest import fixture_text, rule_ids

client = TestClient(app)

FRAMEWORKS = [SourceFramework.CREWAI, SourceFramework.DIFY, SourceFramework.LANGGRAPH]


def _gap_rules(framework: SourceFramework, kind: str) -> set[str]:
    return {
        rule
        for gap in adapter_coverage_catalog()
        if gap["kind"] == kind and framework.value in gap["frameworks"]
        for rule in gap["rules"]
    }


def _strip_declarations(text: str) -> str:
    """Drop the property declarations the needs_declaration gaps ask for."""
    for declared in (
        "capability_kinds: [deployRelease]",
        "recipient_type: public_channel",
        "trust_level: trusted_core",
        "exposure_boundary: external",
        "authentication_scope: elevated",
        "contains_regulated_data: [gdpr]",
        "shared: true",
    ):
        text = text.replace(f", {declared}", "").replace(f"{declared}, ", "").replace(declared, "")
    # Data assets: the external boundary is the FH-025 declaration; outputs
    # keep theirs, which the frameworks infer anyway (and Dify needs, see below).
    text = text.replace("Partner feed, boundary: external", "Partner feed")
    text = text.replace("Partner feed, type: data_asset, boundary: external", "Partner feed, type: data_asset")
    return text


def test_catalog_entries_are_well_formed():
    rules = set(rule_catalog())
    valid = {f.value for f in FRAMEWORKS}
    for gap in adapter_coverage_catalog():
        assert gap["kind"] in {"not_expressible", "needs_declaration"}, gap
        assert gap["rules"] and set(gap["rules"]) <= rules, gap
        assert gap["frameworks"] and set(gap["frameworks"]) <= valid, gap
        assert str(gap["message"]).strip(), gap
        # coverage_warnings derives properties from declare.
        assert "properties" not in gap, gap
        if gap["kind"] == "needs_declaration":
            assert gap["declare"], gap
            # The frontend joins requirements with "and" and options with "or",
            # so "A and B or C" can't say whether it means (A and B) or C.
            if len(gap["declare"]) > 1:
                assert all(len(option) == 1 for option in gap["declare"]), gap
            for option in gap["declare"]:
                assert option, gap
                for requirement in option:
                    _assert_declarable(gap, requirement)
        else:
            assert "declare" not in gap, gap


# The roles the catalog header documents, and the node type each one narrows.
ROLES = {
    "delegate": "agent",
    "reachable": "tool",
    "read": "data_asset",
    "sent_to": "output",
    "shared": "memory",
}


def _assert_declarable(gap: dict, requirement: dict) -> None:
    """The requirement names a property its node type accepts, with values the
    property can take, so the catalog can't drift from the adapters."""
    assert set(requirement) - {"role"} == {"node_type", "property", "values"}, (gap, requirement)
    if "role" in requirement:
        assert ROLES.get(requirement["role"]) == requirement["node_type"], (gap, requirement)
    node_type = NodeType(requirement["node_type"])
    prop, values = requirement["property"], requirement["values"]
    assert prop in declarable_properties(node_type), (gap, requirement)
    assert values, (gap, requirement)
    # The message is the English rendering of the same declaration.
    assert f"`{prop}" in gap["message"], (gap, prop)
    enum = node_property_catalog()["enums"].get(prop)
    if enum:
        assert set(values) <= set(enum), (gap, requirement)
    if prop == "capability_kinds":
        assert set(values) <= capabilities(), (gap, requirement)
    if isinstance(default_properties(node_type.value).get(prop), bool):
        assert all(isinstance(v, bool) for v in values), (gap, requirement)


def test_a_rule_is_not_both_expressible_and_not_for_one_framework():
    for framework in FRAMEWORKS:
        overlap = _gap_rules(framework, "not_expressible") & _gap_rules(framework, "needs_declaration")
        assert not overlap, (framework, overlap)


@pytest.mark.parametrize("framework", FRAMEWORKS, ids=lambda f: f.value)
def test_fixture_reaches_exactly_the_expressible_rules(framework):
    findings = analyze_text(fixture_text(f"coverage_{framework.value}.yaml")).findings
    expected = set(rule_catalog()) - _gap_rules(framework, "not_expressible")
    fired = rule_ids(findings)
    assert fired == expected, {"missing": sorted(expected - fired), "unexpected": sorted(fired - expected)}


@pytest.mark.parametrize("framework", FRAMEWORKS, ids=lambda f: f.value)
def test_needs_declaration_rules_depend_on_the_declaration(framework):
    # Without the declared properties, the needs_declaration rules go quiet.
    text = _strip_declarations(fixture_text(f"coverage_{framework.value}.yaml"))
    fired = rule_ids(analyze_text(text).findings)
    still_firing = fired & _gap_rules(framework, "needs_declaration")
    if framework == SourceFramework.DIFY:
        # The stripped Dify fixture keeps `boundary: external` on its answer
        # node, so FH-004/FH-034 still fire; that's the declaration they need.
        still_firing -= {"FH-004", "FH-034"}
    assert not still_firing, sorted(still_firing)


@pytest.mark.parametrize("framework", FRAMEWORKS, ids=lambda f: f.value)
def test_a_declaration_in_effect_is_not_asked_for(framework):
    # Once a needs_declaration rule fires, the file has the declaration: the
    # entry goes. Without the declarations, the entries stay.
    def asked(text: str) -> set[str]:
        result = analyze_text(text)
        warnings = analysis_warnings(result.ir, result.findings)
        return {r for w in warnings if w["kind"] == "needs_declaration" for r in w["rules"]}

    declared = fixture_text(f"coverage_{framework.value}.yaml")
    assert asked(declared) == set()
    expected = _gap_rules(framework, "needs_declaration")
    if framework == SourceFramework.DIFY:
        # The stripped fixture keeps the answer node's `boundary: external`.
        expected -= {"FH-004", "FH-034"}
    assert asked(_strip_declarations(declared)) == expected


def test_generic_has_no_warnings():
    assert coverage_warnings(SourceFramework.GENERIC) == []


def test_warnings_carry_kind_rules_properties_and_one_line_message():
    warnings = coverage_warnings(SourceFramework.CREWAI)
    assert warnings
    for warning in warnings:
        expected = {"kind", "rules", "message", "properties"}
        if warning["kind"] == "needs_declaration":
            expected.add("declare")
        assert set(warning) == expected
        assert "\n" not in warning["message"]
    declared = {r for w in warnings if w["kind"] == "needs_declaration" for r in w["rules"]}
    assert {"FH-012", "FH-017", "FH-025", "FH-026"} <= declared


def test_declare_carries_node_type_values_and_grouping():
    # FH-017 needs both properties, on different node types, the tool one
    # reachable from the agent; FH-013 takes either value. properties is
    # derived from declare.
    by_rule = {w["rules"][0]: w for w in coverage_warnings(SourceFramework.CREWAI)}
    fh_017, fh_013 = by_rule["FH-017"], by_rule["FH-013"]
    assert fh_017["properties"] == ["exposure_boundary", "authentication_scope"]
    assert fh_017["declare"] == [
        [
            {"node_type": "agent", "property": "exposure_boundary", "values": ["external"]},
            {"node_type": "tool", "role": "reachable", "property": "authentication_scope", "values": ["elevated"]},
        ]
    ]
    assert fh_013["properties"] == ["recipient_type"]
    assert fh_013["declare"] == [
        [{"node_type": "output", "role": "sent_to", "property": "recipient_type", "values": ["public_channel", "broadcast"]}],
    ]
    assert by_rule["FH-006"]["properties"] == [] and "declare" not in by_rule["FH-006"]


def test_api_returns_warnings_on_parse_detail_and_analyze():
    created = client.post(
        "/analyses",
        files={"file": ("coverage_dify.yaml", fixture_text("coverage_dify.yaml"), "application/x-yaml")},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    expected = coverage_warnings(SourceFramework.DIFY)
    assert body["warnings"] == expected
    assert body["source_framework"] == "dify"

    analysis_id = body["analysis_id"]
    assert client.get(f"/analyses/{analysis_id}").json()["warnings"] == expected
    analyzed = client.post(f"/analyses/{analysis_id}/analyze")
    assert analyzed.status_code == 200, analyzed.text
    # The fixture declares everything, so once analysed only the gaps remain.
    not_expressible = [w for w in expected if w["kind"] == "not_expressible"]
    assert analyzed.json()["warnings"] == not_expressible
    assert analyzed.json()["source_framework"] == "dify"
    assert client.get(f"/analyses/{analysis_id}").json()["warnings"] == not_expressible


def test_api_appends_ignored_property_warnings_after_coverage():
    text = "agents:\n  clerk:\n    role: Clerk\n    data_assets: [{name: Patients, sensitivty: high}]\ntasks: {}\n"
    created = client.post("/analyses", files={"file": ("crew.yaml", text, "application/x-yaml")})
    assert created.status_code == 200, created.text
    warnings = created.json()["warnings"]
    coverage = coverage_warnings(SourceFramework.CREWAI)
    assert warnings[: len(coverage)] == coverage
    [ignored] = warnings[len(coverage) :]
    assert ignored["kind"] == "ignored_property"
    assert ignored["suggestion"] == "sensitivity"

    # Stored with the analysis, so the detail and analyze responses repeat it.
    analysis_id = created.json()["analysis_id"]
    assert client.get(f"/analyses/{analysis_id}").json()["warnings"] == warnings
    assert client.post(f"/analyses/{analysis_id}/analyze").json()["warnings"] == warnings


def test_api_generic_upload_has_empty_warnings():
    created = client.post(
        "/analyses",
        files={"file": ("hiresmart_generic.yaml", fixture_text("hiresmart_generic.yaml"), "application/x-yaml")},
    )
    assert created.json()["warnings"] == []
