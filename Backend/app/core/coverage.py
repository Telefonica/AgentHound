"""Warnings returned with a framework upload.

A framework adapter can't produce every shape the rules look for, so a clean
result on a CrewAI/Dify/LangGraph file doesn't mean the same as a clean result
on a generic one. ``coverage_warnings`` returns the gaps declared for the
analysis' framework in ``catalogs/adapter_coverage.yaml``.

The coverage warnings depend on the framework and the findings, so they're
computed on read rather than stored: analyses saved before this existed get
them too. The parse warnings (``ignored_property``) depend on the file, so the
adapter stores them on the IR and ``analysis_warnings`` appends them.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .catalogs import adapter_coverage_catalog
from .ir.models import AnalysisIR, Finding, SourceFramework


def coverage_warnings(framework: SourceFramework) -> list[dict[str, Any]]:
    """``{kind, rules, message, properties}`` per gap that applies to ``framework``.

    A ``needs_declaration`` entry also carries ``declare``: alternative options,
    each a list of ``{node_type, property, values}`` requirements, so a client
    can render its own (translated) text instead of ``message``. ``properties``
    is the property names in ``declare``, in order; it's empty for
    ``not_expressible``.
    """
    warnings = []
    for gap in adapter_coverage_catalog():
        if framework.value not in gap.get("frameworks", []):
            continue
        declare = [[{**req, "values": list(req["values"])} for req in option] for option in gap.get("declare") or []]
        warning: dict[str, Any] = {
            "kind": gap["kind"],
            "rules": list(gap["rules"]),
            "message": " ".join(str(gap["message"]).split()),
            "properties": list(dict.fromkeys(req["property"] for option in declare for req in option)),
        }
        if gap["kind"] == "needs_declaration":
            warning["declare"] = declare
        warnings.append(warning)
    return warnings


def analysis_warnings(ir: AnalysisIR, findings: Iterable[Finding] = ()) -> list[dict[str, Any]]:
    """Coverage warnings for the framework, then the file's own parse warnings.

    A ``needs_declaration`` entry is left out once any of its rules has fired:
    in a framework file those rules only fire when the file has the
    declaration, so there's nothing left to declare. Before the analysis runs
    there are no findings and every entry is returned.

    The fired rules are the signal, not the IR's properties: the IR doesn't
    record which values the file declared, and adapters set some of them
    themselves (fetched web content is an external data asset).
    """
    fired = {f.rule_id for f in findings}
    coverage = [
        w
        for w in coverage_warnings(ir.source_framework)
        if not (w["kind"] == "needs_declaration" and fired.intersection(w["rules"]))
    ]
    return coverage + [dict(w) for w in ir.parse_warnings]
