"""Pydantic v2 models for the AgentHound internal representation (spec section 4).

The IR uses a single ``nodes`` list (each node carries a ``type`` and a free-form
``properties`` map) and a single ``edges`` list (each edge carries a neutral
``capability`` verb). This is the contract consumed by the frontend, and it is
intentionally different from the earlier prototype's separate per-type
collections.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, computed_field


class NodeType(str, Enum):
    """The seven node types AgentHound works with (spec section 3)."""

    AGENT = "agent"
    INPUT = "input"
    TOOL = "tool"
    DATA_ASSET = "data_asset"
    OUTPUT = "output"
    MEMORY = "memory"
    CONTROL = "control"


class Severity(str, Enum):
    """Finding severity, lowest to highest (spec section 10)."""

    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SourceFramework(str, Enum):
    CREWAI = "crewai"
    DIFY = "dify"
    LANGGRAPH = "langgraph"
    GENERIC = "generic"
    UNKNOWN = "unknown"


class Node(BaseModel):
    """A graph node (spec section 4.2)."""

    id: str = Field(..., description="Unique node identifier.")
    type: NodeType = Field(..., description="Node type.")
    name: str = Field(..., description="Human-readable label.")
    properties: dict[str, Any] = Field(
        default_factory=dict, description="Risk-relevant properties for this node type."
    )


class Edge(BaseModel):
    """A directed, typed capability edge (spec section 4.3)."""

    id: str = Field(..., description="Unique edge identifier.")
    source: str = Field(..., description="Source node id.")
    target: str = Field(..., description="Target node id.")
    capability: str = Field(..., description="Neutral capability verb from the catalog.")
    properties: dict[str, Any] = Field(
        default_factory=dict, description="Edge properties (e.g. influence, confidence)."
    )


# Longest analysis name the API accepts, on create and on rename. The name is
# stored with the analysis and returned in every listing row.
MAX_NAME_LENGTH = 200


class Metadata(BaseModel):
    name: str = Field(default="Unnamed architecture")
    uploaded_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Ingestion timestamp (UTC).",
    )


class AnalysisIR(BaseModel):
    """Normalized internal representation for one analysis (spec section 4.1)."""

    analysis_id: str
    source_framework: SourceFramework = SourceFramework.GENERIC
    metadata: Metadata = Field(default_factory=Metadata)
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    controls: list[dict[str, Any]] = Field(
        default_factory=list, description="Declared controls (Phase 2 uses these as first-class nodes)."
    )
    parse_warnings: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Problems the adapter found in the source file (e.g. ignored property keys).",
    )

    # --- convenience accessors used across the pipeline ---
    def node_map(self) -> dict[str, Node]:
        return {node.id: node for node in self.nodes}

    def nodes_of_type(self, node_type: NodeType) -> list[Node]:
        return [node for node in self.nodes if node.type == node_type]

    def edge_map(self) -> dict[str, Edge]:
        return {edge.id: edge for edge in self.edges}


class Finding(BaseModel):
    """A risk finding emitted by a rule (spec section 7.1)."""

    id: str = Field(..., description="Unique finding id, e.g. finding_001.")
    rule_id: str = Field(..., description="Rule that produced this finding, e.g. FH-001.")
    title: str
    severity: Severity
    score: float = Field(..., ge=0.0, le=10.0)
    category: str
    path: list[str] = Field(default_factory=list, description="Ordered node ids on the risk path.")
    edges: list[str] = Field(
        default_factory=list,
        description="Edge ids for the risk path hops (includes parallel MultiDiGraph edges).",
    )
    derivation: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)
    recommended_controls: list[str] = Field(default_factory=list)
    owasp_agentic: list[str] = Field(default_factory=list)
    owasp_llm: list[str] = Field(default_factory=list)
    mitre_atlas: list[str] = Field(default_factory=list)
    group_id: str = Field(
        default="",
        description="Root-cause group this finding belongs to (see rules/grouping.py).",
    )

    @computed_field
    @property
    def finding_class(self) -> Literal["attack", "hygiene"]:
        from ..rules.common import HYGIENE_RULE_IDS  # lazy to avoid load-order cycle
        return "hygiene" if self.rule_id in HYGIENE_RULE_IDS else "attack"


class AnalysisSummary(BaseModel):
    nodes: int
    edges: int
    findings: int
    critical: int
    high: int
    medium: int
    max_score: float


class AnalysisResult(BaseModel):
    """Everything persisted for one analysis: the IR plus its findings."""

    ir: AnalysisIR
    findings: list[Finding] = Field(default_factory=list)

    def summary(self) -> AnalysisSummary:
        by_sev = {s: 0 for s in Severity}
        for finding in self.findings:
            by_sev[finding.severity] += 1
        max_score = max((f.score for f in self.findings), default=0.0)
        return AnalysisSummary(
            nodes=len(self.ir.nodes),
            edges=len(self.ir.edges),
            findings=len(self.findings),
            critical=by_sev[Severity.CRITICAL],
            high=by_sev[Severity.HIGH],
            medium=by_sev[Severity.MEDIUM],
            max_score=round(max_score, 1),
        )


# --- control simulation request (spec section 11.1) ---


class ControlApplication(BaseModel):
    """One control to apply to one target node (spec section 11.1)."""

    control_id: str = Field(..., description="Control id from controls.yaml, e.g. humanInTheLoop.")
    target_node_id: str = Field(..., description="Node the control is installed on.")
    status: Literal["absent", "partial", "present", "bypassed"] = Field(
        default="present",
        description="Control status (spec 02 enum): absent | partial | present | bypassed.",
    )


class SimulateControlsRequest(BaseModel):
    """Body of POST /analyses/{id}/simulate-controls (spec section 11.1)."""

    controls_to_apply: list[ControlApplication] = Field(default_factory=list)


# --- analyze request (re-score an edited node/edge set) ---


class AnalyzeNode(BaseModel):
    """A node in an edited graph submitted to the analyze stage.

    ``type`` is validated against ``NodeType`` so an unknown node kind is
    rejected as bad input before it reaches the pipeline.
    """

    id: str
    type: NodeType
    name: str
    properties: dict[str, Any] = Field(default_factory=dict)


class AnalyzeEdge(BaseModel):
    """An edge in an edited graph submitted to the analyze stage."""

    id: str
    source: str
    target: str
    capability: str
    properties: dict[str, Any] = Field(default_factory=dict)


class AnalyzeRequest(BaseModel):
    """Body of POST /analyses/{id}/analyze: the full edited node/edge set.

    The frontend sends the complete graph as it stands after the user's edits
    (not a diff); the pipeline reconciles it against the stored IR by id.
    """

    nodes: list[AnalyzeNode] = Field(default_factory=list)
    edges: list[AnalyzeEdge] = Field(default_factory=list)


class RenameRequest(BaseModel):
    """Body of PATCH /analyses/{id}: the analysis' new name."""

    name: str = Field(
        ...,
        max_length=MAX_NAME_LENGTH,
        description="New analysis name; surrounding whitespace is trimmed.",
    )


# --- error envelope (spec section 13) ---


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class IRValidationError(Exception):
    """Raised when the IR fails validation (spec section 13)."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_envelope(self) -> ErrorEnvelope:
        return ErrorEnvelope(error=ErrorDetail(code=self.code, message=self.message, details=self.details))
