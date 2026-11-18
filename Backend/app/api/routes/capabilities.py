"""GET /capabilities: the capability catalog (``catalogs/capabilities.yaml``)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ...core.catalogs import capability_catalog

router = APIRouter()


# Mirror CapabilityDescriptor / CapabilitiesResponse in Frontend/src/lib/api/types.ts.
class CapabilityDescriptor(BaseModel):
    verb: str
    description: str
    typical_source: str | None
    typical_target: str | None
    evaluated_by: list[str]


class CapabilitiesResponse(BaseModel):
    capabilities: list[CapabilityDescriptor]


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    summary="List the capability verbs and the rules that evaluate each",
)
def list_capabilities() -> CapabilitiesResponse:
    # Catalog order (the agent cognitive cycle) is kept so clients can group by
    # phase. An empty evaluated_by means the verb is vocabulary only: accepted on
    # edges and drawn in the graph, but no rule checks it.
    return CapabilitiesResponse(
        capabilities=[
            CapabilityDescriptor(
                verb=verb,
                description=descriptor.get("description", ""),
                typical_source=descriptor.get("typical_source"),
                typical_target=descriptor.get("typical_target"),
                evaluated_by=list(descriptor.get("evaluated_by") or []),
            )
            for verb, descriptor in capability_catalog().items()
        ]
    )
