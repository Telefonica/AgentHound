"""Root-cause grouping of findings.

A large architecture repeats the same cause many times: a policy-absence rule
fires once per agent (FH-028/FH-035 22 times each in a 25-agent hospital), and a
path rule fires once per route from the same entry point to every reachable
sink. Grouping collapses those occurrences so a report can present causes, while
every individual finding stays available for detail.

The grouping key is declared per rule in ``rules.yaml`` as ``group_by``:

* ``rule`` -- one group per rule. Used for policy-absence rules, whose root cause
  is a missing organisation-wide control rather than any one node.
* ``source`` (default) -- one group per rule and first node on the finding's
  path, i.e. the entry point for path rules, the input for reachability rules,
  and the node itself for single-node findings (which therefore stay one per
  group).

Grouping is presentation and aggregation only: scores, severities and the
findings list are unchanged.
"""

from __future__ import annotations

from typing import Any

from ..catalogs import rule_catalog
from ..ir.models import Finding

GROUP_BY_RULE = "rule"
GROUP_BY_SOURCE = "source"
_GROUP_BY_VALUES = {GROUP_BY_RULE, GROUP_BY_SOURCE}


def group_by_for(rule_id: str) -> str:
    """The catalog ``group_by`` for a rule, defaulting to ``source``."""
    value = rule_catalog().get(rule_id, {}).get("group_by", GROUP_BY_SOURCE)
    return value if value in _GROUP_BY_VALUES else GROUP_BY_SOURCE


def group_key(finding: Finding) -> tuple[str, str | None]:
    """``(rule_id, anchor node)``; the anchor is ``None`` for rule-wide groups.

    The key is position-independent, so it matches the same group across two
    rule runs (e.g. before/after a control simulation), unlike ``group_id``.
    """
    if group_by_for(finding.rule_id) == GROUP_BY_RULE or not finding.path:
        return (finding.rule_id, None)
    return (finding.rule_id, finding.path[0])


def group_findings(findings: list[Finding]) -> list[dict[str, Any]]:
    """Assign ``group_id`` to every finding and return the group summaries.

    Groups are numbered in order of first appearance. Findings arrive sorted by
    score (descending), so groups come out ordered by their highest score and
    each group's first finding is its representative. Deterministic for a given
    findings order, so re-running it on stored findings is idempotent.
    """
    catalog = rule_catalog()
    groups: dict[tuple[str, str | None], dict[str, Any]] = {}
    for finding in findings:
        key = group_key(finding)
        group = groups.get(key)
        if group is None:
            rule_id, anchor = key
            group = {
                "group_id": f"group_{len(groups) + 1:03d}",
                "rule_id": rule_id,
                "title": catalog.get(rule_id, {}).get("title", finding.title),
                "group_by": group_by_for(rule_id),
                "anchor_node_id": anchor,
                "finding_class": finding.finding_class,
                "count": 0,
                "max_score": finding.score,
                "severity": finding.severity.value,
                "representative_finding_id": finding.id,
                "finding_ids": [],
            }
            groups[key] = group
        finding.group_id = group["group_id"]
        group["count"] += 1
        group["finding_ids"].append(finding.id)
    return list(groups.values())


def grouped_total(findings: list[Finding]) -> float:
    """Sum of each group's highest score: every root cause counted once."""
    best: dict[tuple[str, str | None], float] = {}
    for finding in findings:
        key = group_key(finding)
        best[key] = max(best.get(key, 0.0), finding.score)
    return sum(best.values())
