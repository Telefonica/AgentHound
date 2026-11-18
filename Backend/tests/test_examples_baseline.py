"""Regression baseline over the shipped ``examples/`` architectures.

Pins, per example file, the finding count, critical count, max score and the
set of rules that fire. An adapter, rule or scoring change that moves any of
these shows up here as an explicit diff, so it has to be reviewed and the
snapshot updated on purpose rather than drifting silently.

Regenerate the expected values with ``python scripts/coverage_matrix.py
../examples --rules`` (from ``Backend/``) after an intended change.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.pipeline import analyze_text

from .conftest import rule_ids

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"

# file -> (findings, critical, max_score, rule ids that fire)
BASELINE: dict[str, tuple[int, int, float, str]] = {
    "01_support_email/crewai.yaml": (8, 1, 9.0, "FH-002 FH-003 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"),
    "01_support_email/dify.yaml": (8, 1, 9.0, "FH-002 FH-003 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"),
    "01_support_email/langgraph.yaml": (8, 1, 9.0, "FH-002 FH-003 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"),
    "02_data_codeexec/crewai.yaml": (
        13, 1, 9.8, "FH-002 FH-005 FH-010 FH-016 FH-019 FH-021 FH-023 FH-027 FH-028 FH-033 FH-035"
    ),
    "02_data_codeexec/dify.yaml": (
        10, 1, 9.8, "FH-002 FH-005 FH-010 FH-016 FH-019 FH-021 FH-027 FH-028 FH-033 FH-035"
    ),
    "02_data_codeexec/langgraph.yaml": (
        13, 1, 9.8, "FH-002 FH-005 FH-010 FH-016 FH-019 FH-021 FH-023 FH-027 FH-028 FH-033 FH-035"
    ),
    "03_ops_destructive/crewai.yaml": (
        15, 1, 10.0, "FH-002 FH-005 FH-011 FH-019 FH-021 FH-023 FH-027 FH-028 FH-033 FH-035"
    ),
    "03_ops_destructive/dify.yaml": (
        13, 2, 9.8, "FH-005 FH-011 FH-019 FH-021 FH-027 FH-028 FH-032 FH-033 FH-035"
    ),
    "03_ops_destructive/langgraph.yaml": (
        17, 2, 10.0, "FH-002 FH-005 FH-011 FH-019 FH-021 FH-023 FH-027 FH-028 FH-032 FH-033 FH-035"
    ),
    "04_hiresmart_pipeline/crewai.yaml": (
        16, 1, 9.8, "FH-002 FH-003 FH-007 FH-014 FH-021 FH-022 FH-023 FH-027 FH-028 FH-033 FH-035"
    ),
    "04_hiresmart_pipeline/dify.yaml": (
        16, 1, 9.8, "FH-002 FH-003 FH-007 FH-018 FH-021 FH-022 FH-024 FH-027 FH-028 FH-033 FH-035"
    ),
    "04_hiresmart_pipeline/generic_fullchain.yaml": (
        27,
        6,
        10.0,
        "FH-001 FH-002 FH-003 FH-005 FH-006 FH-007 FH-011 FH-018 FH-019 FH-021 FH-022 FH-023 "
        "FH-027 FH-028 FH-033 FH-035",
    ),
    "04_hiresmart_pipeline/langgraph.yaml": (
        16, 1, 9.8, "FH-002 FH-003 FH-007 FH-014 FH-018 FH-021 FH-022 FH-023 FH-027 FH-028 FH-033 FH-035"
    ),
    "05_prototype_support_pair/crewai_risky.yaml": (
        8, 1, 9.0, "FH-002 FH-003 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"
    ),
    "05_prototype_support_pair/crewai_safe.yaml": (7, 0, 7.6, "FH-018 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"),
    "05_prototype_support_pair/dify_risky.yaml": (8, 1, 9.0, "FH-003 FH-018 FH-021 FH-022 FH-027 FH-028 FH-033 FH-035"),
    "05_prototype_support_pair/dify_safe.yaml": (5, 0, 7.6, "FH-018 FH-021 FH-028 FH-033 FH-035"),
}


def _analyze(relative: str):
    return analyze_text((EXAMPLES / relative).read_text(encoding="utf-8"))


def test_baseline_covers_every_example():
    # A new example file must be added to the snapshot, and a removed one
    # dropped from it, so the baseline never silently stops covering a file.
    shipped = {p.relative_to(EXAMPLES).as_posix() for p in EXAMPLES.rglob("*.yaml")}
    assert shipped == set(BASELINE)


@pytest.mark.parametrize("relative", sorted(BASELINE))
def test_example_matches_baseline(relative: str):
    findings, critical, max_score, rules = BASELINE[relative]
    result = _analyze(relative)
    summary = result.summary()
    assert (summary.findings, summary.critical, summary.max_score) == (findings, critical, max_score)
    assert rule_ids(result.findings) == set(rules.split())


def test_paper_case_study_hiresmart_crewai():
    # Paper section IX: HireSmart through the CrewAI adapter has one critical
    # finding with a max score of 9.8, led by FH-003 at 9.8 (FH-002/FH-007 at
    # 8.8, FH-014 at 7.1, FH-023 at 5.1). The paper reports seventeen findings
    # from an earlier snapshot; the current engine yields sixteen.
    result = _analyze("04_hiresmart_pipeline/crewai.yaml")
    summary = result.summary()
    assert (summary.findings, summary.critical, summary.max_score) == (16, 1, 9.8)

    top_by_rule: dict[str, float] = {}
    for finding in result.findings:
        top_by_rule[finding.rule_id] = max(top_by_rule.get(finding.rule_id, 0.0), finding.score)
    assert result.findings[0].rule_id == "FH-003"
    assert {rule: top_by_rule[rule] for rule in ("FH-003", "FH-002", "FH-007", "FH-014", "FH-023")} == {
        "FH-003": 9.8,
        "FH-002": 8.8,
        "FH-007": 8.8,
        "FH-014": 7.1,
        "FH-023": 5.1,
    }
