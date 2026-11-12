"""Analysis pipeline (spec section 18).

The pipeline is split into two stages so the frontend can parse first (to show
the inferred agents/capabilities for editing) and run the rule engine only once
the user continues to Results:

* ``parse_text`` -- YAML -> IR -> graph structure, persisted with no findings.
* ``analyze_stored`` / ``analyze_graph`` -- run the rule engine over the stored
  IR (optionally after applying the user's capability edits) and persist the
  findings.

``analyze_text`` runs both stages in one call; it is retained as a convenience
for the rule/adapter test-suites. All stages emit the spec section 14 log
events and persist through the repository.
"""

from __future__ import annotations

import uuid

from ..logging_util import (
    ANALYSIS_COMPLETED,
    ANALYSIS_STARTED,
    FINDINGS_GENERATED,
    PARSER_SELECTED,
    RULES_EXECUTED,
    log_event,
)
from .graph.builder import build_graph
from .graph.traversal import DEFAULT_MAX_DEPTH
from .ir.models import (
    AnalysisIR,
    AnalysisResult,
    AnalyzeEdge,
    AnalyzeNode,
    Edge,
    IRValidationError,
    Node,
    SourceFramework,
)
from .ir.normalizer import normalize
from .ir.validators import validate_findings, validate_ir
from .parser.adapters import run_adapter
from .parser.yaml_loader import detect_framework, load_yaml_text
from .rules.engine import RULE_COUNT, run_rules
from .storage.repository import repository


def _resolve_framework(hint: str | None, data: dict) -> SourceFramework:
    if hint:
        try:
            return SourceFramework(hint.lower())
        except ValueError as exc:
            raise IRValidationError(
                "UNKNOWN_FRAMEWORK",
                f"Unknown framework {hint!r}.",
                {"valid": [f.value for f in SourceFramework]},
            ) from exc
    return detect_framework(data)


def _build_ir(text: str, framework_hint: str | None, name: str | None, analysis_id: str) -> AnalysisIR:
    """Parse YAML into a normalized, validated IR (no rules run)."""
    data = load_yaml_text(text)
    framework = _resolve_framework(framework_hint, data)
    log_event(PARSER_SELECTED, analysis_id, framework=framework.value)

    ir = run_adapter(framework, data, analysis_id)
    normalize(ir)
    validate_ir(ir)

    # A caller-supplied name is authoritative over the YAML's metadata.name.
    if name and name.strip():
        ir.metadata.name = name.strip()
    return ir


def _finalize_analysis(ir: AnalysisIR, max_depth: int) -> AnalysisResult:
    """Run the rule engine over a normalized/validated IR, persist and return it."""
    analysis_id = ir.analysis_id
    graph = build_graph(ir)
    findings = run_rules(graph, max_depth=max_depth)
    validate_findings(findings)
    log_event(RULES_EXECUTED, analysis_id, rule_count=RULE_COUNT)
    log_event(FINDINGS_GENERATED, analysis_id, findings=len(findings))

    result = AnalysisResult(ir=ir, findings=findings)
    repository.save(result)
    log_event(
        ANALYSIS_COMPLETED,
        analysis_id,
        nodes=len(ir.nodes),
        edges=len(ir.edges),
        findings=len(findings),
    )
    return result


def parse_text(
    text: str,
    framework_hint: str | None = None,
    *,
    name: str | None = None,
) -> AnalysisResult:
    """Parse a YAML architecture into a stored IR, WITHOUT running the rules.

    This is the first stage of the wizard: the frontend shows the inferred
    agents/capabilities from this graph so the user can correct them, then calls
    the analysis stage. The stored result carries an empty findings list until
    then.
    """
    analysis_id = str(uuid.uuid4())
    log_event(ANALYSIS_STARTED, analysis_id)
    ir = _build_ir(text, framework_hint, name, analysis_id)
    result = AnalysisResult(ir=ir, findings=[])
    repository.save(result)
    log_event(ANALYSIS_COMPLETED, analysis_id, nodes=len(ir.nodes), edges=len(ir.edges), findings=0)
    return result


def analyze_text(
    text: str,
    framework_hint: str | None = None,
    *,
    name: str | None = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> AnalysisResult:
    """Parse AND analyze in one call. Convenience for the rule/adapter tests."""
    analysis_id = str(uuid.uuid4())
    log_event(ANALYSIS_STARTED, analysis_id)
    ir = _build_ir(text, framework_hint, name, analysis_id)
    return _finalize_analysis(ir, max_depth)


def analyze_stored(stored: AnalysisResult, *, max_depth: int = DEFAULT_MAX_DEPTH) -> AnalysisResult:
    """Run the rule engine over an already-parsed, unedited analysis.

    Used for the first analysis when the user made no capability edits: the
    stored IR is analysed as-is and the findings overwrite the parsed baseline.
    """
    log_event(ANALYSIS_STARTED, stored.ir.analysis_id)
    return _finalize_analysis(stored.ir, max_depth)


def analyze_graph(
    stored: AnalysisResult,
    nodes: list[AnalyzeNode],
    edges: list[AnalyzeEdge],
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> AnalysisResult:
    """Run the rule engine over an edited node/edge set and overwrite the stored analysis.

    The user corrects the inferred capabilities in the wizard's Inference step
    (add/remove a capability, rename an agent); those edits must feed the
    analysed graph so the findings, scores and counts follow them. Also used for
    the first analysis when the frontend submits the (unedited) parsed graph.

    Reconciliation is by id against the stored IR:

    * A node/edge that already exists keeps its original ``properties`` -- the
      frontend graph shape does not round-trip every risk-relevant property, so
      the stored (already normalized) values are authoritative. Only the edited
      surface is taken from the request: a node's ``name`` and an edge's
      ``capability``. An existing edge's endpoints (source/target) are preserved
      from the stored IR, so resubmitting a known edge id cannot silently rewire
      it.
    * A newly added node/edge is created fresh. New nodes arrive with empty
      properties and pick up the normalizer's safe defaults, which are cautious
      on the trust/exposure boundary (input -> untrusted, output -> external,
      data_asset -> medium sensitivity), so an added capability is assessed as
      risky unless later refined.

    The result is persisted under the same ``analysis_id``, replacing the stored
    analysis (the frontend then recomputes the control recommendations against
    it).
    """
    analysis_id = stored.ir.analysis_id
    log_event(ANALYSIS_STARTED, analysis_id)

    stored_nodes = stored.ir.node_map()
    stored_edges = stored.ir.edge_map()

    reconciled_nodes: list[Node] = []
    for node in nodes:
        existing = stored_nodes.get(node.id)
        if existing is not None:
            # Preserve the analysed type and properties; apply only an edited name.
            reconciled_nodes.append(
                Node(id=existing.id, type=existing.type, name=node.name, properties=dict(existing.properties))
            )
        else:
            reconciled_nodes.append(
                Node(id=node.id, type=node.type, name=node.name, properties=dict(node.properties))
            )

    reconciled_edges: list[Edge] = []
    for edge in edges:
        existing = stored_edges.get(edge.id)
        if existing is not None:
            # Preserve the stored endpoints and properties; only the capability
            # is editable. Taking source/target from the stored IR (not the
            # request) means resubmitting a known edge id cannot silently rewire
            # it to different endpoints.
            reconciled_edges.append(
                Edge(
                    id=existing.id,
                    source=existing.source,
                    target=existing.target,
                    capability=edge.capability,
                    properties=dict(existing.properties),
                )
            )
        else:
            reconciled_edges.append(
                Edge(
                    id=edge.id,
                    source=edge.source,
                    target=edge.target,
                    capability=edge.capability,
                    properties=dict(edge.properties),
                )
            )

    ir = AnalysisIR(
        analysis_id=analysis_id,
        source_framework=stored.ir.source_framework,
        metadata=stored.ir.metadata,
        nodes=reconciled_nodes,
        edges=reconciled_edges,
        controls=stored.ir.controls,
        parse_warnings=stored.ir.parse_warnings,
    )
    normalize(ir)
    validate_ir(ir)
    return _finalize_analysis(ir, max_depth)
