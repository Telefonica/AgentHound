"""Analysis endpoints (spec section 12.1).

`POST /analyses` parses the uploaded YAML into a stored graph WITHOUT running the
rules; `POST /analyses/{id}/analyze` runs the rule engine, optionally after
applying the user's capability edits, and overwrites the stored analysis.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, File, Form, UploadFile

from ...core.coverage import analysis_warnings
from ...core.graph.serializer import serialize_graph
from ...core.ir.models import AnalyzeRequest
from ...core.pipeline import analyze_graph, analyze_stored, parse_text
from ...core.rules.grouping import group_findings
from ...core.storage.repository import repository
from ..errors import as_http_error

router = APIRouter()

# Cap the upload so an oversized file cannot exhaust memory/CPU. Architecture
# YAMLs are small; the default is generous. Overridable via env; a missing or
# malformed value falls back to the default rather than crashing startup.
_DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024


def _max_upload_bytes() -> int:
    try:
        value = int(os.environ.get("AGENTHOUND_MAX_UPLOAD_BYTES", _DEFAULT_MAX_UPLOAD_BYTES))
    except (TypeError, ValueError):
        return _DEFAULT_MAX_UPLOAD_BYTES
    return value if value > 0 else _DEFAULT_MAX_UPLOAD_BYTES


MAX_UPLOAD_BYTES = _max_upload_bytes()


# Declared as plain def (not async): the parse pipeline (YAML parse, graph
# build, disk write) is synchronous and CPU/IO-bound, so FastAPI runs the whole
# handler in its threadpool instead of stalling the event loop. The upload is
# read synchronously via file.file.read() for the same reason.
@router.post("/analyses", summary="Parse an architecture YAML into a graph (no rules run yet)")
def create_analysis(
    file: UploadFile = File(..., description="Architecture description (YAML)."),
    framework: str | None = Form(default=None, description="Optional adapter override."),
    name: str | None = Form(
        default=None,
        description="Optional analysis name; overrides the YAML's metadata.name when provided.",
    ),
) -> dict:
    try:
        # Read at most one byte past the limit so we can detect an oversized
        # upload without pulling an unbounded amount of data into memory.
        raw = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise as_http_error(
                "UPLOAD_TOO_LARGE",
                f"Uploaded file exceeds the {MAX_UPLOAD_BYTES}-byte limit.",
                status_code=413,
            )
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise as_http_error("INVALID_ENCODING", "Uploaded file is not valid UTF-8.", status_code=400) from exc

        # Parse only: the frontend shows the inferred capabilities for editing,
        # then calls /analyze. Findings are empty until then.
        result = parse_text(text, framework_hint=framework, name=name)
        return {
            "analysis_id": result.ir.analysis_id,
            "status": "parsed",
            "name": result.ir.metadata.name,
            "source_framework": result.ir.source_framework.value,
            "summary": result.summary().model_dump(),
            "warnings": analysis_warnings(result.ir, result.findings),
        }
    finally:
        # Release the underlying spooled temp file/descriptor on every path,
        # including the oversized and decode-error branches.
        file.file.close()


def _list_item(result) -> dict:
    """The stored-analysis descriptor shared by the list and the detail endpoint,
    so a single row and `GET /analyses/{id}` can never drift apart."""
    return {
        "analysis_id": result.ir.analysis_id,
        "name": result.ir.metadata.name,
        "source_framework": result.ir.source_framework.value,
        "uploaded_at": result.ir.metadata.uploaded_at.isoformat(),
        "summary": result.summary().model_dump(),
        "warnings": analysis_warnings(result.ir, result.findings),
    }


# Plain def (not async): the listing does synchronous repository reads (cache +
# disk scan), so FastAPI runs it in its threadpool rather than blocking the loop.
@router.get("/analyses", summary="List stored analyses, most recently uploaded first")
def list_analyses() -> dict:
    return {"analyses": [_list_item(result) for result in repository.list_all()]}


# Plain def (not async): the read is a synchronous cache hit or disk read, so
# FastAPI runs it in its threadpool rather than blocking the loop.
@router.get("/analyses/{analysis_id}", summary="Get one stored analysis' name and summary")
def get_analysis(analysis_id: str) -> dict:
    stored = repository.get(analysis_id)
    if stored is None:
        raise as_http_error("ANALYSIS_NOT_FOUND", f"No analysis {analysis_id}.", status_code=404)
    return _list_item(stored)


# Plain def (not async): the delete does a synchronous cache pop + disk unlink,
# so FastAPI runs it in its threadpool rather than blocking the loop.
@router.delete("/analyses/{analysis_id}", summary="Delete a stored analysis")
def delete_analysis(analysis_id: str) -> dict:
    if not repository.delete(analysis_id):
        raise as_http_error("ANALYSIS_NOT_FOUND", f"No analysis {analysis_id}.", status_code=404)
    return {"analysis_id": analysis_id, "status": "deleted"}


# Plain def (not async): the reconcile + graph build + rule execution + disk
# write is synchronous and CPU/IO-bound, so FastAPI runs it in its threadpool.
@router.post(
    "/analyses/{analysis_id}/analyze",
    summary="Run the rule engine, optionally over an edited node/edge set, overwriting the analysis",
)
def analyze_analysis(analysis_id: str, request: AnalyzeRequest | None = None) -> dict:
    stored = repository.get(analysis_id)
    if stored is None:
        raise as_http_error("ANALYSIS_NOT_FOUND", f"No analysis {analysis_id}.", status_code=404)
    # An empty body (or none) analyses the stored parsed graph as-is -- the
    # first run when the user made no edits. An all-empty edits payload is
    # deliberately treated the same: the UI never produces it (agent nodes are
    # not removable, so a real edited graph always has nodes), so this only
    # guards against an accidental empty body rather than meaning "analyse an
    # empty graph". A body with nodes/edges is the user's edited graph; a
    # malformed one (dangling edge, unknown capability) raises IRValidationError,
    # mapped to HTTP 400 by the handler.
    if request is None or (not request.nodes and not request.edges):
        result = analyze_stored(stored)
    else:
        result = analyze_graph(stored, request.nodes, request.edges)
    groups = group_findings(result.findings)
    return {
        "analysis_id": result.ir.analysis_id,
        "status": "completed",
        "name": result.ir.metadata.name,
        "source_framework": result.ir.source_framework.value,
        "summary": result.summary().model_dump(),
        "graph": serialize_graph(result.ir, result.findings),
        "findings": [f.model_dump() for f in result.findings],
        "groups": groups,
        "warnings": analysis_warnings(result.ir, result.findings),
    }
