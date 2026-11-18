"""Node/reachability rules: FH-002, FH-004, FH-005, FH-008, FH-014, FH-016,
FH-017..022, FH-026..029, FH-032..035."""

from __future__ import annotations

from ..graph.traversal import CapabilityGraph
from ..ir.models import Finding
from .common import agents_on_path, as_bool, has_control_targeting, has_interpret_intent, is_shared_memory, max_sensitivity, node_props, node_type, tool_mediated_hops
from .registry import make_finding
from .scoring import ScoreInputs, compute_score, severity_from_score

_SENSITIVE_HIGH = {"high", "critical"}
_MEDIUM_PLUS = {"medium", "high", "critical"}
_DEPLOY_DELETE_CAPS = {"deployRelease", "deleteResource"}
_VALID_SENSITIVITIES = {"public", "low", "medium", "high", "critical"}


def _safe_sensitivity(value: str) -> str:
    return value if value in _VALID_SENSITIVITIES else "medium"


def fh_004(cg: CapabilityGraph) -> list[Finding]:
    """Over-permissioned agent: same agent reads high/critical data AND sends to external output."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for agent in cg.nodes_of_type("agent"):
        # Outgoing read edges to high/critical data assets
        sensitive_read_assets = [
            v
            for v in cg.graph.successors(agent)
            if node_type(cg, v) == "data_asset"
            and node_props(cg, v).get("sensitivity") in _SENSITIVE_HIGH
            and "read" in cg.hop_capabilities(agent, v)
        ]
        if not sensitive_read_assets:
            continue

        # Outgoing send edges to external outputs
        external_send_outputs = [
            v
            for v in cg.graph.successors(agent)
            if node_type(cg, v) == "output"
            and node_props(cg, v).get("boundary") == "external"
            and "send" in cg.hop_capabilities(agent, v)
        ]
        if not external_send_outputs:
            continue

        if agent in seen:
            continue
        seen.add(agent)

        asset = sensitive_read_assets[0]
        output = external_send_outputs[0]
        sensitivity = node_props(cg, asset).get("sensitivity", "medium")
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=sensitivity,
                external_reach="external",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-004",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[agent, asset],
                edges=cg.hop_edge_ids(agent, asset) + cg.hop_edge_ids(agent, output),
                evidence={
                    "agent_id": agent,
                    "sensitive_read_asset": asset,
                    "data_sensitivity": sensitivity,
                    "external_send_output": output,
                },
            )
        )
    return findings


def fh_005(cg: CapabilityGraph) -> list[Finding]:
    """Tool with side effect that requires no approval and is not reversible."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for tool in cg.nodes_of_type("tool"):
        props = node_props(cg, tool)
        if not as_bool(props.get("side_effect", False)):
            continue
        if as_bool(props.get("requires_approval", False)):
            continue
        if as_bool(props.get("side_effect_reversible", True)):
            continue

        if tool in seen:
            continue
        seen.add(tool)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=["approval_missing"],
                reversible=False,
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-005",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[tool],
                edges=[],
                evidence={
                    "tool_id": tool,
                    "side_effect": True,
                    "requires_approval": False,
                    "side_effect_reversible": False,
                },
            )
        )
    return findings


def fh_008(cg: CapabilityGraph) -> list[Finding]:
    """fetchWeb tool without a URL allowlist — leaves the agent open to indirect injection."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for agent in cg.nodes_of_type("agent"):
        # Generic files put fetchWeb on the agent -> tool hop; the framework
        # adapters put it on the tool's own outgoing hop. Match both.
        # tool -> (fetched targets, the tool's own fetchWeb edge ids); both empty
        # for the direct shape. The targets go on the path so every listed
        # edge has both ends on it.
        fetch_tools: dict[str, tuple[list[str], list[str]]] = {
            v: ([], [])
            for v in cg.graph.successors(agent)
            if node_type(cg, v) == "tool" and "fetchWeb" in cg.hop_capabilities(agent, v)
        }
        for tool, target in tool_mediated_hops(cg, agent, "fetchWeb"):
            targets, fetch_edges = fetch_tools.setdefault(tool, ([], []))
            targets.append(target)
            fetch_edges.extend(cg.hop_edge_ids_for(tool, target, "fetchWeb"))
        for v, (targets, fetch_edges) in sorted(fetch_tools.items()):
            if as_bool(node_props(cg, v).get("allowlist_present", False)):
                continue
            if "contentValidation" in node_props(cg, agent).get("guardrails", []):
                continue

            if v in seen:
                continue
            seen.add(v)

            score = compute_score(
                ScoreInputs(
                    base_severity="medium",
                    data_sensitivity="medium",
                    external_reach="external",
                    controls_absent=["allowlist_missing"],
                    agent_count=1,
                )
            )
            findings.append(
                make_finding(
                    rule_id="FH-008",
                    finding_id="pending",
                    severity=severity_from_score(score),
                    score=score,
                    path=[agent, v, *targets],
                    edges=cg.hop_edge_ids(agent, v) + fetch_edges,
                    evidence={
                        "tool_id": v,
                        "agent_id": agent,
                        "allowlist_present": False,
                    },
                )
            )
    return findings


def fh_016(cg: CapabilityGraph) -> list[Finding]:
    """executeCode tool without sandbox isolation — critical even without an untrusted-input path."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for tool in cg.nodes_of_type("tool"):
        if as_bool(node_props(cg, tool).get("sandbox_enabled", False)):
            continue

        # Require at least one agent invoking this tool via executeCode.
        has_execute_code = any(
            "executeCode" in cg.hop_capabilities(pred, tool)
            for pred in cg.graph.predecessors(tool)
        )
        if not has_execute_code:
            continue

        if tool in seen:
            continue
        seen.add(tool)

        score = compute_score(
            ScoreInputs(
                base_severity="critical",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                reversible=False,
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-016",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[tool],
                edges=[],
                evidence={
                    "tool_id": tool,
                    "sandbox_enabled": False,
                },
            )
        )
    return findings


def fh_002(cg: CapabilityGraph) -> list[Finding]:
    """Sensitive read reachable from an untrusted input."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    for path in cg.find_paths_to_sensitive_data():
        # Spec section 8: the sensitive asset must be reached by a read edge on
        # the final hop, not merely have a read somewhere on the path.
        if len(path) < 2 or "read" not in cg.hop_capabilities(path[-2], path[-1]):
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        agents = agents_on_path(cg, path)
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=max_sensitivity(cg, path),
                external_reach="internal",
                controls_absent=["allowlist_missing"],
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-002",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "input_trust_level": "untrusted",
                    "data_sensitivity": max_sensitivity(cg, path),
                    "agent_count": len(agents),
                },
            )
        )
    return findings


def _is_scoped_delegation(edge_data: dict, source_props: dict) -> bool:
    """A delegation is scoped if either the edge or the delegating agent says so."""
    edge_scoped = as_bool(edge_data.get("properties", {}).get("has_scoped_delegation", False))
    agent_scoped = as_bool(source_props.get("has_scoped_delegation", False))
    return edge_scoped or agent_scoped


def fh_014(cg: CapabilityGraph) -> list[Finding]:
    """Privilege escalation via unscoped delegation.

    Spec section 8: a low-trust or full-auto agent ``delegateTo`` a
    ``trusted_core`` agent (or a tool with elevated auth scope) without scoped
    delegation. This is an edge-local pattern, so it scans delegateTo hops
    directly rather than input-rooted paths.
    """
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()
    for source, target, key, data in cg.graph.edges(keys=True, data=True):
        if data.get("capability") != "delegateTo":
            continue
        source_props = node_props(cg, source)
        if not (
            source_props.get("autonomy_level") == "full_auto"
            or source_props.get("trust_level") == "untrusted"
        ):
            continue
        target_props = node_props(cg, target)
        target_kind = node_type(cg, target)
        privileged = (
            target_kind == "agent" and target_props.get("trust_level") == "trusted_core"
        ) or (target_kind == "tool" and target_props.get("authentication_scope") == "elevated")
        if not privileged:
            continue
        if _is_scoped_delegation(data, source_props):
            continue
        dedup = (source, target, key)
        if dedup in seen:
            continue
        seen.add(dedup)

        # This rule is about missing delegation scoping, not approval gating, so
        # no control-absence code applies. Delegation to another agent involves
        # two agents; delegation to an elevated-scope tool involves one, so the
        # count must not be hard-coded (that would over-score the tool case).
        agent_count = 2 if target_kind == "agent" else 1
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=agent_count,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-014",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[source, target],
                edges=[key],
                evidence={
                    "source_autonomy_level": source_props.get("autonomy_level"),
                    "source_trust_level": source_props.get("trust_level"),
                    "target_trust_level": target_props.get("trust_level"),
                    "target_kind": target_kind,
                    "has_scoped_delegation": False,
                },
            )
        )
    return findings


# ---------------------------------------------------------------------------
# Phase E node rules
# ---------------------------------------------------------------------------


def fh_017(cg: CapabilityGraph) -> list[Finding]:
    """Tool with elevated auth scope reachable from an externally-exposed agent."""
    findings: list[Finding] = []
    seen: set[str] = set()

    external_agents = [
        a
        for a in cg.nodes_of_type("agent")
        if node_props(cg, a).get("exposure_boundary") == "external"
    ]
    if not external_agents:
        return findings

    for tool in cg.nodes_of_type("tool"):
        if node_props(cg, tool).get("authentication_scope") != "elevated":
            continue
        reaching_agent = next(
            (a for a in external_agents if tool in cg.get_reachable_nodes(a)),
            None,
        )
        if reaching_agent is None:
            continue
        if tool in seen:
            continue
        seen.add(tool)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity="medium",
                external_reach="external",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-017",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[tool],
                edges=[],
                evidence={
                    "tool_id": tool,
                    "authentication_scope": "elevated",
                    "reaching_agent": reaching_agent,
                    "agent_exposure": "external",
                },
            )
        )
    return findings


def fh_018(cg: CapabilityGraph) -> list[Finding]:
    """Data asset whose sensitivity is at the default (medium), suggesting no explicit classification."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for asset in cg.nodes_of_type("data_asset"):
        if node_props(cg, asset).get("sensitivity") != "medium":
            continue
        if node_props(cg, asset).get("sensitivity_source", "inferred_by_adapter") != "inferred_by_adapter":
            continue
        if asset in seen:
            continue
        seen.add(asset)

        score = compute_score(
            ScoreInputs(
                base_severity="low",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-018",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[asset],
                edges=[],
                evidence={
                    "asset_id": asset,
                    "sensitivity": "medium",
                    "reason": "default_sensitivity",
                },
            )
        )
    return findings


def fh_019(cg: CapabilityGraph) -> list[Finding]:
    """Full-auto agent using a destructive tool that requires no approval and is irreversible."""
    findings: list[Finding] = []
    seen: set[tuple[str, str]] = set()

    for agent in cg.nodes_of_type("agent"):
        if node_props(cg, agent).get("autonomy_level") != "full_auto":
            continue
        for tool in cg.graph.successors(agent):
            if node_type(cg, tool) != "tool":
                continue
            props = node_props(cg, tool)
            if not as_bool(props.get("side_effect", False)):
                continue
            if as_bool(props.get("side_effect_reversible", True)):
                continue
            if as_bool(props.get("requires_approval", False)):
                continue
            key = (agent, tool)
            if key in seen:
                continue
            seen.add(key)

            score = compute_score(
                ScoreInputs(
                    base_severity="high",
                    data_sensitivity="medium",
                    external_reach="internal",
                    controls_absent=["approval_missing"],
                    reversible=False,
                    agent_count=1,
                )
            )
            findings.append(
                make_finding(
                    rule_id="FH-019",
                    finding_id="pending",
                    severity=severity_from_score(score),
                    score=score,
                    path=[agent, tool],
                    edges=cg.hop_edge_ids(agent, tool),
                    evidence={
                        "agent_id": agent,
                        "tool_id": tool,
                        "autonomy_level": "full_auto",
                        "side_effect_reversible": False,
                        "requires_approval": False,
                    },
                )
            )
    return findings


def fh_020(cg: CapabilityGraph) -> list[Finding]:
    """Shared-scope memory node with write validation disabled."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for mem in cg.nodes_of_type("memory"):
        props = node_props(cg, mem)
        if not is_shared_memory(props):
            continue
        if as_bool(props.get("write_validated", False)):
            continue
        if mem in seen:
            continue
        seen.add(mem)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity=_safe_sensitivity(props.get("sensitivity", "medium")),
                external_reach="internal",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-020",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[mem],
                edges=[],
                evidence={
                    "memory_id": mem,
                    "scope": props.get("scope"),
                    # Whichever is_shared_memory() signal fired; scope alone can
                    # read "session" for memory shared via one of the others.
                    "shared": as_bool(props.get("shared", False)),
                    "memory_kind": props.get("memory_kind"),
                    "shared_with_agents": list(props.get("shared_with_agents") or []),
                    "write_validated": False,
                },
            )
        )
    return findings


def fh_021(cg: CapabilityGraph) -> list[Finding]:
    """Untrusted input node with neither sanitization nor an injection detector."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for input_node in cg.nodes_of_type("input"):
        props = node_props(cg, input_node)
        if props.get("trust_level") != "untrusted":
            continue
        if as_bool(props.get("sanitized_before_agent", False)):
            continue
        if as_bool(props.get("injection_detector_present", False)):
            continue
        if input_node in seen:
            continue
        seen.add(input_node)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="external",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-021",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[input_node],
                edges=[],
                evidence={
                    "input_id": input_node,
                    "trust_level": "untrusted",
                    "sanitized_before_agent": False,
                    "injection_detector_present": False,
                },
            )
        )
    return findings


def fh_022(cg: CapabilityGraph) -> list[Finding]:
    """External output with neither a content filter nor PII redaction."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for output_node in cg.nodes_of_type("output"):
        props = node_props(cg, output_node)
        if props.get("boundary") != "external":
            continue
        # A release/move destination carries no message content to filter.
        if props.get("output_kind") == "deployment_target":
            continue
        if as_bool(props.get("content_filter_present", False)):
            continue
        if as_bool(props.get("pii_redaction_present", False)):
            continue
        if output_node in seen:
            continue
        seen.add(output_node)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="external",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-022",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[output_node],
                edges=[],
                evidence={
                    "output_id": output_node,
                    "boundary": "external",
                    "content_filter_present": False,
                    "pii_redaction_present": False,
                },
            )
        )
    return findings


def fh_026(cg: CapabilityGraph) -> list[Finding]:
    """GDPR-regulated data asset with no consent-enforcement control applied."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for asset in cg.nodes_of_type("data_asset"):
        props = node_props(cg, asset)
        regulated = props.get("contains_regulated_data", [])
        if isinstance(regulated, str):
            regulated = [regulated]
        if "gdpr" not in [r.lower() for r in regulated]:
            continue
        if has_control_targeting(cg, asset, "consentEnforcement"):
            continue
        if asset in seen:
            continue
        seen.add(asset)

        sensitivity = _safe_sensitivity(props.get("sensitivity", "medium"))
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=sensitivity,
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-026",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[asset],
                edges=[],
                evidence={
                    "asset_id": asset,
                    "contains_regulated_data": list(regulated),
                    "consent_enforcement": False,
                },
            )
        )
    return findings


def fh_027(cg: CapabilityGraph) -> list[Finding]:
    """Tool with a side effect that has audit logging disabled."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for tool in cg.nodes_of_type("tool"):
        props = node_props(cg, tool)
        if not as_bool(props.get("side_effect", False)):
            continue
        if as_bool(props.get("audit_logging_enabled", False)):
            continue
        if tool in seen:
            continue
        seen.add(tool)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-027",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[tool],
                edges=[],
                evidence={
                    "tool_id": tool,
                    "side_effect": True,
                    "audit_logging_enabled": False,
                },
            )
        )
    return findings


def fh_028(cg: CapabilityGraph) -> list[Finding]:
    """Full-auto agent without a decision-audit-trail control applied."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for agent in cg.nodes_of_type("agent"):
        if node_props(cg, agent).get("autonomy_level") != "full_auto":
            continue
        if has_control_targeting(cg, agent, "decisionAuditTrail"):
            continue
        if agent in seen:
            continue
        seen.add(agent)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-028",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[agent],
                edges=[],
                evidence={
                    "agent_id": agent,
                    "autonomy_level": "full_auto",
                    "decision_audit_trail": False,
                },
            )
        )
    return findings


def fh_029(cg: CapabilityGraph) -> list[Finding]:
    """Memory with medium-or-higher sensitivity and no retention TTL configured."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for mem in cg.nodes_of_type("memory"):
        props = node_props(cg, mem)
        if props.get("sensitivity") not in _MEDIUM_PLUS:
            continue
        if props.get("retention_ttl_days") is not None:
            continue
        if mem in seen:
            continue
        seen.add(mem)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity=_safe_sensitivity(props.get("sensitivity", "medium")),
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-029",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[mem],
                edges=[],
                evidence={
                    "memory_id": mem,
                    "sensitivity": props.get("sensitivity"),
                    "retention_ttl_days": None,
                },
            )
        )
    return findings


def fh_032(cg: CapabilityGraph) -> list[Finding]:
    """Tool used for deployment or deletion that is irreversible and has no rollback control."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for tool in cg.nodes_of_type("tool"):
        props = node_props(cg, tool)
        if as_bool(props.get("side_effect_reversible", True)):
            continue
        deploy_caps: set[str] = set()
        for succ in cg.graph.successors(tool):
            deploy_caps.update(set(cg.hop_capabilities(tool, succ)) & _DEPLOY_DELETE_CAPS)
        for pred in cg.graph.predecessors(tool):
            deploy_caps.update(set(cg.hop_capabilities(pred, tool)) & _DEPLOY_DELETE_CAPS)
        if not deploy_caps:
            continue
        if has_control_targeting(cg, tool, "rollbackReady"):
            continue
        if tool in seen:
            continue
        seen.add(tool)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=["approval_missing"],
                reversible=False,
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-032",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[tool],
                edges=[],
                evidence={
                    "tool_id": tool,
                    "deploy_delete_caps": sorted(deploy_caps),
                    "side_effect_reversible": False,
                    "rollback_ready": False,
                },
            )
        )
    return findings


def fh_033(cg: CapabilityGraph) -> list[Finding]:
    """Untrusted input without injection detection connected to a decision-making agent."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for input_node in cg.nodes_of_type("input"):
        props = node_props(cg, input_node)
        if props.get("trust_level") != "untrusted":
            continue
        if as_bool(props.get("injection_detector_present", False)):
            continue
        decision_agent: str | None = None
        for succ in cg.graph.successors(input_node):
            if node_type(cg, succ) != "agent":
                continue
            agent_props = node_props(cg, succ)
            # full_auto agents implicitly make decisions
            if agent_props.get("autonomy_level") == "full_auto":
                decision_agent = succ
                break
            # Or the agent uses interpretIntent on any adjacent edge (either direction)
            if has_interpret_intent(cg, succ):
                decision_agent = succ
                break
        if decision_agent is None:
            continue
        if input_node in seen:
            continue
        seen.add(input_node)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="external",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-033",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[input_node, decision_agent],
                edges=cg.hop_edge_ids(input_node, decision_agent),
                evidence={
                    "input_id": input_node,
                    "trust_level": "untrusted",
                    "injection_detector_present": False,
                    "decision_agent": decision_agent,
                },
            )
        )
    return findings


def fh_034(cg: CapabilityGraph) -> list[Finding]:
    """External output carrying sensitive data without a DLP scanner control."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for output_node in cg.nodes_of_type("output"):
        props = node_props(cg, output_node)
        if props.get("boundary") != "external":
            continue
        if has_control_targeting(cg, output_node, "dlpScanner"):
            continue
        # Require an upstream agent that reads from a medium+ sensitivity data asset.
        has_sensitive_upstream = False
        for pred in cg.graph.predecessors(output_node):
            if node_type(cg, pred) != "agent":
                continue
            for asset in cg.graph.successors(pred):
                if (
                    node_type(cg, asset) == "data_asset"
                    and node_props(cg, asset).get("sensitivity") in _MEDIUM_PLUS
                    and "read" in cg.hop_capabilities(pred, asset)
                ):
                    has_sensitive_upstream = True
                    break
            if has_sensitive_upstream:
                break
        if not has_sensitive_upstream:
            continue
        if output_node in seen:
            continue
        seen.add(output_node)

        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity="medium",
                external_reach="external",
                controls_absent=["validation_missing"],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-034",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[output_node],
                edges=[],
                evidence={
                    "output_id": output_node,
                    "boundary": "external",
                    "dlp_scanner": False,
                },
            )
        )
    return findings


def fh_035(cg: CapabilityGraph) -> list[Finding]:
    """Full-auto agent with no anomaly-detection control applied."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for agent in cg.nodes_of_type("agent"):
        if node_props(cg, agent).get("autonomy_level") != "full_auto":
            continue
        if has_control_targeting(cg, agent, "anomalyDetection"):
            continue
        if agent in seen:
            continue
        seen.add(agent)

        score = compute_score(
            ScoreInputs(
                base_severity="low",
                data_sensitivity="medium",
                external_reach="internal",
                controls_absent=[],
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-035",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=[agent],
                edges=[],
                evidence={
                    "agent_id": agent,
                    "autonomy_level": "full_auto",
                    "anomaly_detection": False,
                },
            )
        )
    return findings
