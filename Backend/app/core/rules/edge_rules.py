"""Edge rules: FH-023, FH-024, FH-025, FH-031."""

from __future__ import annotations

from ..graph.traversal import CapabilityGraph
from ..ir.models import Finding
from .common import as_bool, has_control_targeting, node_props, node_type, tool_mediated_hops
from .registry import make_finding
from .scoring import ScoreInputs, compute_score, severity_from_score

_VALIDATION_GUARDRAILS = {"contentvalidation", "memoryvalidation", "extractionvalidation"}

__all__ = ["fh_023", "fh_024", "fh_025", "fh_031"]


def fh_023(cg: CapabilityGraph) -> list[Finding]:
    """Unscoped delegateTo edge between agents whose capability sets differ."""
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    for source, target, key, data in cg.graph.edges(keys=True, data=True):
        if data.get("capability") != "delegateTo":
            continue
        if node_type(cg, source) != "agent" or node_type(cg, target) != "agent":
            continue
        source_props = node_props(cg, source)
        if as_bool(source_props.get("has_scoped_delegation", False)):
            continue
        if as_bool(data.get("properties", {}).get("has_scoped_delegation", False)):
            continue
        # Collect the outgoing capability sets for each agent.
        source_caps = {
            cap
            for succ in cg.graph.successors(source)
            for cap in cg.hop_capabilities(source, succ)
        }
        target_caps = {
            cap
            for succ in cg.graph.successors(target)
            for cap in cg.hop_capabilities(target, succ)
        }
        # Only flag when the target introduces capabilities the source doesn't have;
        # equal sets mean no new privilege is granted.
        if not (target_caps - source_caps):
            continue
        dedup = (source, target, key)
        if dedup in seen:
            continue
        seen.add(dedup)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=2,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-023",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[source, target],
                edges=[key],
                evidence={
                    "source_agent": source,
                    "target_agent": target,
                    "has_scoped_delegation": False,
                },
            )
        )
    return findings


def fh_024(cg: CapabilityGraph) -> list[Finding]:
    """dataFlow edge between agents where neither side declares a validation guardrail."""
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    for source, target, key, data in cg.graph.edges(keys=True, data=True):
        if data.get("capability") != "dataFlow":
            continue
        if node_type(cg, source) != "agent" or node_type(cg, target) != "agent":
            continue
        src_guardrails = {g.lower() for g in node_props(cg, source).get("guardrails", [])}
        tgt_guardrails = {g.lower() for g in node_props(cg, target).get("guardrails", [])}
        if src_guardrails & _VALIDATION_GUARDRAILS or tgt_guardrails & _VALIDATION_GUARDRAILS:
            continue
        if has_control_targeting(cg, source, "contentValidation") or has_control_targeting(
            cg, target, "contentValidation"
        ):
            continue
        dedup = (source, target, key)
        if dedup in seen:
            continue
        seen.add(dedup)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=["validation_missing"],
                agent_count=2,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-024",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[source, target],
                edges=[key],
                evidence={
                    "source_agent": source,
                    "target_agent": target,
                    "validation_guardrail": False,
                },
            )
        )
    return findings


def fh_025(cg: CapabilityGraph) -> list[Finding]:
    """read edge from an agent toward an external or untrusted data asset without content validation."""
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    # (agent, asset, read edge id, path, path edge ids) for both shapes: a direct
    # agent -> asset read (generic files, declared assets) and a read performed
    # by a tool the agent invokes (framework adapters route tool reads this way).
    reads: list[tuple[str, str, str, list[str], list[str]]] = []
    for source, target, key, data in cg.graph.edges(keys=True, data=True):
        if data.get("capability") == "read" and node_type(cg, source) == "agent":
            reads.append((source, target, key, [source, target], [key]))
    for agent in cg.nodes_of_type("agent"):
        for tool, target in tool_mediated_hops(cg, agent, "read"):
            invoke_ids = cg.hop_edge_ids_for(agent, tool, "invokeTool")
            for key in cg.hop_edge_ids_for(tool, target, "read"):
                reads.append((agent, target, key, [agent, tool, target], invoke_ids + [key]))

    for source, target, key, path, path_edges in reads:
        if node_type(cg, target) != "data_asset":
            continue
        tgt_props = node_props(cg, target)
        if not (
            tgt_props.get("trust_level") == "untrusted"
            or tgt_props.get("boundary") == "external"
        ):
            continue
        src_guardrails = {g.lower() for g in node_props(cg, source).get("guardrails", [])}
        if "contentvalidation" in src_guardrails:
            continue
        if has_control_targeting(cg, source, "contentValidation"):
            continue
        dedup = (source, target, key)
        if dedup in seen:
            continue
        seen.add(dedup)

        raw_sens = tgt_props.get("sensitivity", "medium")
        sens = raw_sens if raw_sens in ("public", "low", "medium", "high", "critical") else "medium"
        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity=sens,
                external_reach="external",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-025",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=path_edges,
                evidence={
                    "agent_id": source,
                    "asset_id": target,
                    "asset_boundary": tgt_props.get("boundary"),
                    "asset_sensitivity": tgt_props.get("sensitivity"),
                    "content_validation": False,
                },
            )
        )
    return findings


def fh_031(cg: CapabilityGraph) -> list[Finding]:
    """retry capability invoked on a non-idempotent tool without an idempotency-key control."""
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    for source, target, key, data in cg.graph.edges(keys=True, data=True):
        if data.get("capability") != "retry":
            continue
        if node_type(cg, target) != "tool":
            continue
        if as_bool(node_props(cg, target).get("idempotent", False)):
            continue
        if has_control_targeting(cg, target, "idempotencyKey"):
            continue
        dedup = (source, target, key)
        if dedup in seen:
            continue
        seen.add(dedup)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=["approval_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-031",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[source, target],
                edges=[key],
                evidence={
                    "agent_id": source,
                    "tool_id": target,
                    "idempotent": False,
                    "idempotency_key": False,
                },
            )
        )
    return findings
