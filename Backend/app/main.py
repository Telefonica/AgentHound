"""FastAPI application factory for the AgentHound backend (Phase 1).

Wires the routers, registers the IR-validation exception handler so failures
return the spec's error envelope (section 13), and configures CORS (localhost by
default, overridable for deployment via AGENTHOUND_CORS_ORIGINS).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

# Any localhost/127.0.0.1 origin (any port) is allowed by default so a local
# frontend dev server works out of the box, without opening the service to
# arbitrary origins. Set AGENTHOUND_CORS_ORIGINS (comma-separated) to pin exact
# origins when deploying somewhere browser-reachable.
# Anchored (^...$) so only exact localhost origins match, not e.g.
# http://localhost.evil.com. Starlette uses fullmatch, but the anchors make the
# intent explicit and safe under any matching mode.
_LOCALHOST_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

from . import __version__
from .api.errors import ApiError, api_error_handler, ir_validation_handler, request_validation_handler
from .api.routes import analyze, capabilities, controls, findings, graphs
from .core.ir.models import IRValidationError


def create_app() -> FastAPI:
    app = FastAPI(
        title="AgentHound Backend",
        version=__version__,
        description=(
            "Analyze multiagent architecture YAML for capability-based attack paths. "
            "Generic parser, IR, graph, rules FH-001/002/003/006, findings (Phase 1) plus "
            "control recommendation and simulation (Phase 2)."
        ),
    )

    configured = os.environ.get("AGENTHOUND_CORS_ORIGINS", "").strip()
    if configured:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in configured.split(",") if o.strip()],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=_LOCALHOST_ORIGIN_REGEX,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.add_exception_handler(IRValidationError, ir_validation_handler)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_handler)

    app.include_router(analyze.router, tags=["analyses"])
    app.include_router(graphs.router, tags=["graph"])
    app.include_router(findings.router, tags=["findings"])
    app.include_router(controls.router)
    app.include_router(capabilities.router, tags=["catalogs"])

    @app.get("/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
