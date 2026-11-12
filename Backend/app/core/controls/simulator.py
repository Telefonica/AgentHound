"""Control simulation (spec sections 11 and 12.6).

Applying a control to a target node marks every edge incident to that node whose
capability the control breaks. The recompute rebuilds the capability graph with
the blocked edges cut and re-runs the unchanged Phase 1 rule engine. The stored
analysis is never mutated: the simulation works on a clone.

``effect: total`` marks an edge ``blocked`` and cuts it from the recomputed
graph, so any attack path through it disappears. ``effect: partial`` marks an
edge ``mitigated``: the hop is *not* cut, but every surviving finding whose path
crosses a mitigated edge has ``existing_controls_credit`` (spec section 10)
subtracted from its score, lowering the score and possibly its severity band.
This keeps a partial control genuinely weaker than a total one -- "baja de score
o desaparece" (spec section 16) -- rather than letting a single mitigation sever
the whole graph.
"""

from __future__ import annotations

from ...logging_util import SIMULATION_COMPLETED, SIMULATION_STARTED, log_event
from ..catalogs import control_catalog
from ..graph.builder import build_graph
from ..graph.serializer import serialize_graph
from ..graph.traversal import DEFAULT_MAX_DEPTH
from ..ir.models import (
    AnalysisIR,
    AnalysisResult,
    ControlApplication,
    Finding,
    IRValidationError,
    Node,
    NodeType,
    Severity,
)
from ..rules.engine import run_rules
from ..rules.grouping import grouped_total
from ..rules.scoring import severity_from_score

# Score credit subtracted per mitigated hop on a surviving finding's path (spec
# section 10 existing_controls_credit). A partial control weakens a path rather
# than cutting it, so a finding it touches drops in score and may drop a band.
MITIGATION_CREDIT = 1.5

# Smaller credit for detector controls: detection improves visibility but does
# NOT cut or mitigate the underlying path — only monitors it.
DETECTION_CREDIT = 0.3


class _AppliedControl:
    """Resolved control application plus the edges it affects."""

    def __init__(
        self,
        control_id: str,
        name: str,
        category: str,
        effect: str,
        target_node_id: str,
        status: str = "present",
    ) -> None:
        self.control_id = control_id
        self.name = name
        self.category = category
        self.effect = effect
        self.target_node_id = target_node_id
        self.status = status
        self.edge_ids: list[str] = []

    def to_dict(self) -> dict:
        return {
            "control_id": self.control_id,
            "name": self.name,
            "category": self.category,
            "effect": self.effect,
            "status": self.status,
            "target_node_id": self.target_node_id,
            "affected_edge_ids": list(self.edge_ids),
        }


def _resolve_applications(
    ir: AnalysisIR, applications: list[ControlApplication]
) -> tuple[list[_AppliedControl], set[str], set[str], set[str], dict[str, tuple[str, str]]]:
    """Validate control ids/targets and map each application to affected edges.

    Returns (resolved, blocked, mitigated, detected, blocked_attribution).

    * ``blocked``  — edges cut from the graph (effect: total, status: present).
    * ``mitigated`` — edges that survive but lose MITIGATION_CREDIT (effect: partial).
    * ``detected``  — edges monitored but NOT cut; findings crossing them lose
      DETECTION_CREDIT (effect: detector).

    Priority order on the same edge: blocked > mitigated > detected (the sets are
    kept mutually exclusive). A ``bypassed`` status means the control is visible in
    the graph but has no effect on edges.
    """
    catalog = control_catalog()
    node_ids = {node.id for node in ir.nodes}

    resolved: list[_AppliedControl] = []
    blocked: set[str] = set()
    mitigated: set[str] = set()
    detected: set[str] = set()
    blocked_attribution: dict[str, tuple[str, str]] = {}
    seen: set[tuple[str, str]] = set()

    for app in applications:
        key = (app.control_id, app.target_node_id)
        if key in seen:
            continue
        seen.add(key)

        control = catalog.get(app.control_id)
        if control is None:
            raise IRValidationError(
                "UNKNOWN_CONTROL",
                f"Control {app.control_id!r} is not defined in controls.yaml.",
                {"control_id": app.control_id, "valid": sorted(catalog)},
            )
        if app.target_node_id not in node_ids:
            raise IRValidationError(
                "UNKNOWN_TARGET_NODE",
                f"Target node {app.target_node_id!r} is not in this analysis.",
                {"target_node_id": app.target_node_id},
            )

        app_status = app.status
        breaks = set(control.get("breaks_capability_kinds", []))
        effect = control.get("effect", "total")
        applied = _AppliedControl(
            control_id=app.control_id,
            name=control.get("name", app.control_id),
            category=control.get("category", ""),
            effect=effect,
            target_node_id=app.target_node_id,
            status=app_status,
        )
        # A bypassed control is visible in the graph (for modelling) but does not
        # affect any edge — skip the edge-resolution loop entirely.
        if app_status != "bypassed":
            for edge in ir.edges:
                if edge.capability not in breaks:
                    continue
                if app.target_node_id not in (edge.source, edge.target):
                    continue
                applied.edge_ids.append(edge.id)
                if effect == "total":
                    blocked.add(edge.id)
                    mitigated.discard(edge.id)
                    detected.discard(edge.id)
                    blocked_attribution.setdefault(edge.id, (app.control_id, app.target_node_id))
                elif effect == "partial":
                    if edge.id not in blocked:
                        mitigated.add(edge.id)
                        detected.discard(edge.id)
                elif effect == "detector":
                    if edge.id not in blocked and edge.id not in mitigated:
                        detected.add(edge.id)
        resolved.append(applied)

    return resolved, blocked, mitigated, detected, blocked_attribution


def _control_node(applied: _AppliedControl) -> Node:
    return Node(
        id=f"control_{applied.control_id}_{applied.target_node_id}",
        type=NodeType.CONTROL,
        name=applied.name,
        properties={
            "control_kind": applied.control_id,
            "category": applied.category,
            "effect": applied.effect,
            "status": applied.status,
            "target_node_id": applied.target_node_id,
        },
    )


def _summary(findings: list[Finding]) -> dict:
    return {
        "finding_count": len(findings),
        "critical_count": sum(1 for f in findings if f.severity == Severity.CRITICAL),
        "max_score": round(max((f.score for f in findings), default=0.0), 1),
    }


def _reduction(before_total: float, after_total: float) -> dict:
    absolute = round(before_total - after_total, 1)
    percentage = round((absolute / before_total) * 100, 1) if before_total > 0 else 0.0
    return {"absolute": absolute, "percentage": percentage}


def _risk_reduction(before: list[Finding], after: list[Finding]) -> dict:
    # The top-level figure sums every finding, so a cause that repeats N times
    # counts N times. ``by_group`` counts each root-cause group once at its
    # highest score so repeated occurrences don't inflate the total.
    reduction = _reduction(sum(f.score for f in before), sum(f.score for f in after))
    reduction["by_group"] = _reduction(grouped_total(before), grouped_total(after))
    return reduction


def _broken_paths(
    before: list[Finding], after: list[Finding], blocked_attribution: dict[str, tuple[str, str]]
) -> list[dict]:
    # A path is "broken" when a before-finding's (rule_id, path) no longer appears
    # after the controls are applied. Match on that signature rather than on the
    # positional finding id, which the engine reassigns on every recompute. Only
    # a blocked (total) edge cuts a path, so attribution is restricted to those.
    after_keys = {(f.rule_id, tuple(f.path)) for f in after}
    broken: list[dict] = []
    for finding in before:
        if (finding.rule_id, tuple(finding.path)) in after_keys:
            continue
        broken_by: str | None = None
        target: str | None = None
        for edge_id in finding.edges:
            if edge_id in blocked_attribution:
                broken_by, target = blocked_attribution[edge_id]
                break
        broken.append(
            {
                "finding_id": finding.id,
                "rule_id": finding.rule_id,
                "broken_by": broken_by,
                "target_node_id": target,
            }
        )
    return broken


def recompute_findings(
    ir: AnalysisIR,
    blocked: set[str],
    mitigated: set[str],
    detected: set[str],
    max_depth: int,
) -> list[Finding]:
    """Re-run the rule engine with blocked edges cut, then apply credits.

    * Mitigated edges: subtract MITIGATION_CREDIT per crossing (path weakened).
    * Detected edges: subtract DETECTION_CREDIT per crossing (monitoring present,
      path still live but observable — smaller credit than partial mitigation).
    """
    graph = build_graph(ir, excluded_edge_ids=blocked)
    findings = run_rules(graph, max_depth=max_depth)
    for finding in findings:
        credit = sum(
            MITIGATION_CREDIT
            for edge_id in finding.edges
            if edge_id in mitigated
        ) + sum(
            DETECTION_CREDIT
            for edge_id in finding.edges
            if edge_id in detected
        )
        if credit:
            finding.score = round(max(0.0, finding.score - credit), 1)
            finding.severity = severity_from_score(finding.score)
    if mitigated or detected:
        findings.sort(key=lambda f: -f.score)
    return findings


def evaluate(
    result: AnalysisResult,
    applications: list[ControlApplication],
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> dict:
    """Compute before/after/broken for an application set without serializing a
    graph or emitting simulation logs. Used by the recommender, which evaluates
    many single-control what-ifs and would otherwise flood the log."""
    _resolved, blocked, mitigated, detected, blocked_attribution = _resolve_applications(
        result.ir, applications
    )
    before = result.findings
    after = recompute_findings(result.ir, blocked, mitigated, detected, max_depth)
    return {
        "before": before,
        "after": after,
        "risk_reduction": _risk_reduction(before, after),
        "broken_paths": _broken_paths(before, after, blocked_attribution),
    }


def simulate(
    result: AnalysisResult,
    applications: list[ControlApplication],
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> dict:
    """Simulate applying controls and return the spec section 11.1 payload."""
    analysis_id = result.ir.analysis_id
    log_event(SIMULATION_STARTED, analysis_id, controls=len(applications))

    resolved, blocked, mitigated, detected, blocked_attribution = _resolve_applications(
        result.ir, applications
    )

    # Clone the IR so the stored analysis is untouched, then add the applied
    # controls as first-class nodes (spec section 11).
    simulated_ir = result.ir.model_copy(deep=True)
    simulated_ir.nodes = list(simulated_ir.nodes) + [_control_node(a) for a in resolved]

    before = result.findings
    after = recompute_findings(result.ir, blocked, mitigated, detected, max_depth)

    graph = serialize_graph(
        simulated_ir,
        after,
        blocked_edge_ids=blocked,
        mitigated_edge_ids=mitigated,
        detected_edge_ids=detected,
    )

    payload = {
        "analysis_id": analysis_id,
        "applied_controls": [a.to_dict() for a in resolved],
        "before": _summary(before),
        "after": _summary(after),
        "risk_reduction": _risk_reduction(before, after),
        "broken_paths": _broken_paths(before, after, blocked_attribution),
        "graph": graph,
    }
    log_event(
        SIMULATION_COMPLETED,
        analysis_id,
        blocked_edges=len(blocked),
        mitigated_edges=len(mitigated),
        broken_paths=len(payload["broken_paths"]),
    )
    return payload
