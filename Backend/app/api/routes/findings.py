"""GET findings endpoints (spec sections 12.3 and 12.4)."""

from __future__ import annotations

from fastapi import APIRouter

from ...core.graph.serializer import serialize_graph
from ...core.rules.grouping import group_findings
from ...core.storage.repository import repository
from ..errors import as_http_error

router = APIRouter()


# Declared as plain def (not async): these handlers do only synchronous work
# (a repository read plus serialization), so FastAPI runs them in its threadpool
# instead of blocking the event loop.
@router.get("/analyses/{analysis_id}/findings", summary="List findings, ordered by score desc")
def list_findings(analysis_id: str) -> dict:
    result = repository.get(analysis_id)
    if result is None:
        raise as_http_error("ANALYSIS_NOT_FOUND", f"No analysis {analysis_id}.", status_code=404)
    # Findings are already stored in the engine's stable order (score desc, then
    # severity, then rule id); return them as-is to preserve that tie-break.
    # Groups are recomputed from that order (idempotent), which also fills
    # group_id on analyses stored before grouping existed.
    groups = group_findings(result.findings)
    return {"findings": [f.model_dump() for f in result.findings], "groups": groups}


@router.get(
    "/analyses/{analysis_id}/findings/{finding_id}",
    summary="Get one finding plus its path subgraph",
)
def get_finding(analysis_id: str, finding_id: str) -> dict:
    result = repository.get(analysis_id)
    if result is None:
        raise as_http_error("ANALYSIS_NOT_FOUND", f"No analysis {analysis_id}.", status_code=404)

    group_findings(result.findings)  # fills group_id on pre-grouping analyses
    finding = next((f for f in result.findings if f.id == finding_id), None)
    if finding is None:
        raise as_http_error("FINDING_NOT_FOUND", f"No finding {finding_id}.", status_code=404)

    # Build a subgraph limited to the nodes/edges on this finding's path.
    path_nodes = set(finding.path)
    path_edge_ids = set(finding.edges)
    # Shallow copy: we replace the nodes/edges lists below and never mutate the
    # shared Node/Edge objects, so a deep copy of the whole graph is not needed.
    sub_ir = result.ir.model_copy(deep=False)
    sub_ir.nodes = [n for n in sub_ir.nodes if n.id in path_nodes]
    sub_ir.edges = [e for e in sub_ir.edges if e.id in path_edge_ids]
    path_graph = serialize_graph(sub_ir, [finding])

    return {"finding": finding.model_dump(), "path_graph": path_graph}
