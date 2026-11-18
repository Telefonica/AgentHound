"""Rule engine orchestration (spec sections 7-8).

Runs the registered rule set against the capability graph, sorts findings by
score (descending) and assigns stable sequential ids (``finding_001`` ...).
"""

from __future__ import annotations

import networkx as nx

from ..graph.traversal import CapabilityGraph
from ..ir.models import Finding
from . import edge_rules, node_rules, path_rules
from .grouping import group_findings

# Registered rule callables.
# Phase A-C: FH-001/002/003/006/010/011/014.
# Phase D:   FH-004/005/007/008/009/012/013/016.
# Phase E:   FH-015/017..035 (path, node, and edge rules).
_RULES = [
    # --- path rules ---
    path_rules.fh_001,
    path_rules.fh_003,
    path_rules.fh_006,
    path_rules.fh_007,
    path_rules.fh_009,
    path_rules.fh_010,
    path_rules.fh_011,
    path_rules.fh_012,
    path_rules.fh_013,
    path_rules.fh_015,
    path_rules.fh_030,
    # --- node rules ---
    node_rules.fh_002,
    node_rules.fh_004,
    node_rules.fh_005,
    node_rules.fh_008,
    node_rules.fh_014,
    node_rules.fh_016,
    node_rules.fh_017,
    node_rules.fh_018,
    node_rules.fh_019,
    node_rules.fh_020,
    node_rules.fh_021,
    node_rules.fh_022,
    node_rules.fh_026,
    node_rules.fh_027,
    node_rules.fh_028,
    node_rules.fh_029,
    node_rules.fh_032,
    node_rules.fh_033,
    node_rules.fh_034,
    node_rules.fh_035,
    # --- edge rules ---
    edge_rules.fh_023,
    edge_rules.fh_024,
    edge_rules.fh_025,
    edge_rules.fh_031,
]

# Number of registered rules, exported so telemetry stays correct if _RULES
# changes (rather than a hardcoded count at the call site).
RULE_COUNT = len(_RULES)

_SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

# FH-009 is about flow through memory itself, so its routes stay one per path.
_MEMORY_FLOW_RULES = {"FH-009"}


def _crosses_memory(cg: CapabilityGraph, path: list[str]) -> bool:
    return any(cg.graph.nodes[n].get("type") == "memory" for n in path[1:-1])


def _collapse_memory_routes(cg: CapabilityGraph, findings: list[Finding]) -> list[Finding]:
    """Keep one finding per rule, entry and sink among routes that cross memory.

    A memory several agents write and read (CrewAI crew memory) links every
    agent to every other one, so a path rule finds the same entry-to-sink route
    once per way through it. Those routes collapse to their highest-scoring
    finding, and drop when a route without memory already reports the same
    entry and sink. A route that exists only through memory is still reported.
    """
    direct = {
        (f.rule_id, f.path[0], f.path[-1]) for f in findings if f.path and not _crosses_memory(cg, f.path)
    }
    kept: list[Finding] = []
    via_memory: dict[tuple[str, str, str], Finding] = {}
    for finding in findings:
        if finding.rule_id in _MEMORY_FLOW_RULES or not _crosses_memory(cg, finding.path):
            kept.append(finding)
            continue
        key = (finding.rule_id, finding.path[0], finding.path[-1])
        if key in direct:
            continue
        if key not in via_memory or finding.score > via_memory[key].score:
            via_memory[key] = finding
    return kept + list(via_memory.values())


def run_rules(graph: nx.MultiDiGraph, max_depth: int = 8) -> list[Finding]:
    cg = CapabilityGraph(graph, max_depth=max_depth)

    findings: list[Finding] = []
    for rule in _RULES:
        findings.extend(rule(cg))
    findings = _collapse_memory_routes(cg, findings)

    # Order by score desc, then severity desc, then rule id ascending. The
    # numeric keys are negated (rather than reverse=True) so rule_id stays
    # ascending as a stable tie-breaker (FH-001 before FH-002 on a tie).
    findings.sort(
        key=lambda f: (-f.score, -_SEVERITY_RANK[f.severity.value], f.rule_id),
    )

    for index, finding in enumerate(findings, start=1):
        finding.id = f"finding_{index:03d}"

    # Root-cause groups are numbered after the final ordering so a
    # group's first member is its highest-scoring finding.
    group_findings(findings)

    return findings
