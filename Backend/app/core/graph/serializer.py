"""Serialize the IR + findings into the frontend graph shape (spec section 12.2).

Nodes gain a ``risk_score`` and human-readable ``badges``; edges gain a
``risk_level``, ``blocked``/``mitigated`` flags and the ids of the findings that
traverse them. In Phase 1 no edge is blocked or mitigated; the control simulator
(spec section 11) passes the affected edge ids so the mitigated graph shows which
routes are interrupted.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..ir.models import AnalysisIR, Finding, NodeType, Severity

_SEVERITY_RANK = {
    Severity.INFO: 0,
    Severity.LOW: 1,
    Severity.MEDIUM: 2,
    Severity.HIGH: 3,
    Severity.CRITICAL: 4,
}


def _node_badges(node_type: NodeType, props: dict) -> list[str]:
    badges: list[str] = []
    if node_type == NodeType.AGENT:
        if props.get("autonomy_level") == "full_auto":
            badges.append("full_auto")
        if props.get("guardrails") in (None, []):
            badges.append("no_guardrails")
    elif node_type == NodeType.INPUT:
        if props.get("trust_level") == "untrusted":
            badges.append("untrusted")
    elif node_type == NodeType.DATA_ASSET:
        sensitivity = props.get("sensitivity")
        if sensitivity in ("high", "critical"):
            badges.append(f"{sensitivity}_sensitivity")
        if props.get("contains_pii"):
            badges.append("pii")
    elif node_type == NodeType.OUTPUT:
        if props.get("boundary") == "external":
            badges.append("external")
        if not props.get("approval_gate_present", False):
            badges.append("no_approval_gate")
    elif node_type == NodeType.TOOL:
        if props.get("side_effect"):
            badges.append("side_effect")
        if not props.get("requires_approval", False):
            badges.append("no_approval")
    elif node_type == NodeType.CONTROL:
        # Applied controls (spec section 11) carry their effect as a badge so the
        # frontend can tell a hard block from a partial mitigation or detection.
        effect = props.get("effect")
        if effect == "total":
            badges.append("blocks")
        elif effect == "partial":
            badges.append("mitigates")
        elif effect == "detector":
            badges.append("detects")
        if props.get("status") == "bypassed":
            badges.append("bypassed")
    return badges


def serialize_graph(
    ir: AnalysisIR,
    findings: list[Finding],
    blocked_edge_ids: Iterable[str] | None = None,
    mitigated_edge_ids: Iterable[str] | None = None,
    detected_edge_ids: Iterable[str] | None = None,
) -> dict:
    blocked = set(blocked_edge_ids or ())
    mitigated = set(mitigated_edge_ids or ())
    detected = set(detected_edge_ids or ())

    # Pre-index findings by node id and edge id. Nodes get the same
    # finding_ids/risk_level as edges so node-scoped findings (which carry no
    # edges) are still visible on the graph.
    node_scores: dict[str, float] = {}
    node_findings: dict[str, list[str]] = {}
    node_severity: dict[str, Severity] = {}
    edge_findings: dict[str, list[str]] = {}
    edge_severity: dict[str, Severity] = {}

    def _raise(severities: dict[str, Severity], key: str, severity: Severity) -> None:
        current = severities.get(key)
        if current is None or _SEVERITY_RANK[severity] > _SEVERITY_RANK[current]:
            severities[key] = severity

    for finding in findings:
        for node_id in dict.fromkeys(finding.path):
            node_scores[node_id] = max(node_scores.get(node_id, 0.0), finding.score)
            node_findings.setdefault(node_id, []).append(finding.id)
            _raise(node_severity, node_id, finding.severity)
        for edge_id in finding.edges:
            edge_findings.setdefault(edge_id, []).append(finding.id)
            _raise(edge_severity, edge_id, finding.severity)

    nodes = [
        {
            "id": node.id,
            "label": node.name,
            "type": node.type.value,
            "risk_score": round(node_scores.get(node.id, 0.0), 1),
            "risk_level": (node_severity.get(node.id) or Severity.INFO).value,
            "finding_ids": node_findings.get(node.id, []),
            "properties": node.properties,
            "badges": _node_badges(node.type, node.properties),
        }
        for node in ir.nodes
    ]

    edges = [
        {
            "id": edge.id,
            "source": edge.source,
            "target": edge.target,
            "label": edge.capability,
            "capability": edge.capability,
            "properties": edge.properties,
            "risk_level": (edge_severity.get(edge.id) or Severity.INFO).value,
            "blocked": edge.id in blocked,
            "mitigated": edge.id in mitigated,
            "detected": edge.id in detected,
            "finding_ids": edge_findings.get(edge.id, []),
        }
        for edge in ir.edges
    ]

    return {"nodes": nodes, "edges": edges}
