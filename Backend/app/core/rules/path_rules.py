"""Path-pattern rules: FH-001, FH-003, FH-006, FH-007, FH-009..013, FH-015, FH-030."""

from __future__ import annotations

from ..graph.traversal import CapabilityGraph
from ..ir.models import Finding
from .common import (
    SENSITIVITY_ORDER as _SENSITIVITY_ORDER,
    agents_on_path as _agents_on_path,
    as_bool as _as_bool,
    has_content_validation as _has_content_validation,
    has_control_targeting as _has_control,
    has_interpret_intent as _has_interpret_intent,
    is_shared_memory as _is_shared_memory,
    max_sensitivity as _max_sensitivity,
    node_props as _props,
    node_type as _node_type,
    sensitive_assets_on_path as _sensitive_assets_on_path,
)
from .registry import make_finding
from .scoring import ScoreInputs, compute_score, severity_from_score

# Rules fire on resources of at least this sensitivity.
_MEDIUM_PLUS = set(_SENSITIVITY_ORDER[_SENSITIVITY_ORDER.index("medium"):])

# Capabilities that indicate lateral propagation between agents.
_LATERAL_CAPS = {"delegateTo", "dataFlow"}

# Capabilities that publish to an external destination.
_DEPLOY_CAPS = {"deployRelease", "moveResource"}


# Capabilities used to notify or respond to a user/channel.
_NOTIFY_CAPS = {"send", "respondUser", "notify"}

# Output recipient types that indicate a public channel.
_PUBLIC_RECIPIENTS = {"public_channel", "broadcast"}


def fh_001(cg: CapabilityGraph) -> list[Finding]:
    """Full exfiltration: untrusted input -> agent -> sensitive read -> external send (no approval)."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    for path in cg.find_paths_to_external_output():
        output_id = path[-1]
        if _as_bool(_props(cg, output_id).get("approval_gate_present", False)):
            continue
        sensitive = _sensitive_assets_on_path(cg, path)
        agents = _agents_on_path(cg, path)
        if not sensitive or not agents:
            continue
        # Spec section 8: require a read edge INTO a high/critical asset and a
        # send edge INTO the external output on the final hop -- not merely the
        # presence of those capabilities somewhere on the path.
        sensitive_set = set(sensitive)
        has_sensitive_read = any(
            v in sensitive_set and "read" in cg.hop_capabilities(u, v)
            for u, v in zip(path, path[1:])
        )
        has_send_to_output = len(path) >= 2 and "send" in cg.hop_capabilities(path[-2], path[-1])
        if not has_sensitive_read or not has_send_to_output:
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        score = compute_score(
            ScoreInputs(
                base_severity="critical",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external",
                controls_absent=["approval_missing"],
                reversible=True,
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-001",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "input_trust_level": "untrusted",
                    "data_sensitivity": _max_sensitivity(cg, path),
                    "sensitive_assets": sensitive,
                    "output_boundary": "external",
                    "approval_gate_present": False,
                    "agent_count": len(agents),
                },
            )
        )
    return findings


def fh_003(cg: CapabilityGraph) -> list[Finding]:
    """Actionable external output from untrusted input, with NO sensitive asset on the path."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    for path in cg.find_paths_to_external_output():
        output_id = path[-1]
        if _as_bool(_props(cg, output_id).get("approval_gate_present", False)):
            continue
        if _sensitive_assets_on_path(cg, path):
            continue  # that is FH-001 territory
        # Spec section 8: the send must reach the external output on the final
        # hop, not merely occur somewhere earlier on the path.
        if len(path) < 2 or "send" not in cg.hop_capabilities(path[-2], path[-1]):
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        agents = _agents_on_path(cg, path)
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external",
                controls_absent=["approval_missing"],
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-003",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "input_trust_level": "untrusted",
                    "output_boundary": "external",
                    "approval_gate_present": False,
                    "agent_count": len(agents),
                },
            )
        )
    return findings


def fh_006(cg: CapabilityGraph) -> list[Finding]:
    """Indirect injection via fetchWeb over external content, propagated to an external output."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    for path in cg.find_paths_to_external_output():
        output_id = path[-1]
        if _as_bool(_props(cg, output_id).get("approval_gate_present", False)):
            continue
        caps = cg.capabilities_on_path(path)
        if "fetchWeb" not in caps:
            continue
        # fetchWeb must target external content. An external boundary is the
        # signal for untrusted web content; data_asset sensitivity is enumerated
        # public..critical (never "untrusted"), so it is not checked here.
        fetch_external = False
        for u, v in zip(path, path[1:]):
            if "fetchWeb" in cg.hop_capabilities(u, v):
                if _props(cg, v).get("boundary") == "external":
                    fetch_external = True
                    break
        if not fetch_external:
            continue
        if _has_content_validation(cg, path):
            continue
        agents = _agents_on_path(cg, path)
        if len(agents) < 2:  # propagation to another agent
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external",
                controls_absent=["validation_missing", "approval_missing"],
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-006",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "input_trust_level": "untrusted",
                    "fetch_web_external": True,
                    "content_validation_present": False,
                    "agent_count": len(agents),
                    "output_boundary": "external",
                    "approval_gate_present": False,
                },
            )
        )
    return findings


def fh_010(cg: CapabilityGraph) -> list[Finding]:
    """Code execution reachable from an untrusted input into a non-sandboxed tool.

    Spec section 8: untrusted input -> agent -> executeCode -> tool with
    ``sandbox_enabled = false``. The executeCode verb must land on the tool on
    the final hop, not merely appear earlier on the path.
    """
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    tools = cg.nodes_of_type("tool")
    for start in cg.untrusted_inputs():
        for tool in tools:
            if _as_bool(_props(cg, tool).get("sandbox_enabled", False)):
                continue
            for path in cg.simple_paths(start, tool):
                # Spec section 8: the executeCode hop is agent -> tool, so the
                # penultimate node must be an agent (not, e.g., a direct
                # input -> tool edge in a hand-authored generic graph).
                if len(path) < 2 or _node_type(cg, path[-2]) != "agent":
                    continue
                if "executeCode" not in cg.hop_capabilities(path[-2], path[-1]):
                    continue
                key = tuple(path)
                if key in seen:
                    continue
                seen.add(key)

                agents = _agents_on_path(cg, path)
                allowlist_present = _as_bool(_props(cg, tool).get("allowlist_present", False))
                score = compute_score(
                    ScoreInputs(
                        base_severity="high",
                        data_sensitivity=_max_sensitivity(cg, path),
                        external_reach="internal",
                        # Only claim a missing allowlist when the tool does not declare one.
                        controls_absent=[] if allowlist_present else ["allowlist_missing"],
                        reversible=False,  # arbitrary code execution is not safely reversible
                        agent_count=len(agents),
                    )
                )
                findings.append(
                    make_finding(
                        rule_id="FH-010",
                        finding_id="pending",
                        severity=severity_from_score(score),
                        score=score,
                        path=path,
                        edges=cg.edge_ids_on_path(path),
                        evidence={
                            "input_trust_level": "untrusted",
                            "sandbox_enabled": False,
                            "allowlist_present": allowlist_present,
                            "agent_count": len(agents),
                        },
                    )
                )
    return findings


def fh_007(cg: CapabilityGraph) -> list[Finding]:
    """Multi-agent chain (>= 3 agents) linked by delegateTo/dataFlow with no approval gates."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()

    for path in cg.find_paths_to_external_output():
        agents = _agents_on_path(cg, path)
        if len(agents) < 3:
            continue

        # Require at least one direct agent-to-agent hop using a lateral capability.
        lateral_found = any(
            _node_type(cg, path[i]) == "agent"
            and _node_type(cg, path[i + 1]) == "agent"
            and bool(set(cg.hop_capabilities(path[i], path[i + 1])) & _LATERAL_CAPS)
            for i in range(len(path) - 1)
        )
        if not lateral_found:
            continue

        # None of the agents on the chain should have an approval gate.
        if any(_as_bool(_props(cg, a).get("approval_gate_present", False)) for a in agents):
            continue

        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external",
                controls_absent=[],
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-007",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "input_trust_level": "untrusted",
                    "agent_count": len(agents),
                    "output_boundary": "external",
                    "lateral_propagation": True,
                },
            )
        )
    return findings


def fh_009(cg: CapabilityGraph) -> list[Finding]:
    """Memory poisoning propagation: untrusted write to shared memory, then a second agent acts."""
    findings: list[Finding] = []
    seen: set[tuple[tuple[str, ...], str]] = set()

    for memory in cg.nodes_of_type("memory"):
        mem_props = _props(cg, memory)
        if not _is_shared_memory(mem_props):
            continue
        if _as_bool(mem_props.get("write_validated", False)):
            continue

        # Gather paths from untrusted inputs that end with a writeMemory edge into this memory.
        write_paths: list[list[str]] = []
        for start in cg.untrusted_inputs():
            for path in cg.simple_paths(start, memory):
                if len(path) >= 2 and "writeMemory" in cg.hop_capabilities(path[-2], path[-1]):
                    write_paths.append(path)

        if not write_paths:
            continue

        # Find agents that read from this memory and can reach a sensitive target.
        for reader in cg.graph.successors(memory):
            if _node_type(cg, reader) != "agent":
                continue
            if "readMemory" not in cg.hop_capabilities(memory, reader):
                continue

            reachable = cg.get_reachable_nodes(reader)
            target = next(
                (
                    n
                    for n in reachable
                    if (
                        _node_type(cg, n) == "data_asset"
                        and _props(cg, n).get("sensitivity") in _MEDIUM_PLUS
                    )
                    or (
                        _node_type(cg, n) == "output"
                        and _props(cg, n).get("boundary") == "external"
                    )
                ),
                None,
            )
            if target is None:
                continue

            for write_path in write_paths:
                key = (tuple(write_path), reader)
                if key in seen:
                    continue
                seen.add(key)

                # Extend the finding through the concrete downstream target.
                # Previously the representative path stopped at the reading agent,
                # even though the finding evidence identified a reachable target.
                # That made the UI path incomplete and obscured the actual sink.
                downstream_paths = cg.simple_paths(reader, target)
                if not downstream_paths:
                    continue
                downstream_path = min(downstream_paths, key=lambda p: (len(p), tuple(p)))
                full_path = write_path + downstream_path
                agents = _agents_on_path(cg, full_path)
                external_reach = (
                    "external"
                    if _node_type(cg, target) == "output"
                    and _props(cg, target).get("boundary") == "external"
                    else "internal"
                )
                score = compute_score(
                    ScoreInputs(
                        base_severity="high",
                        data_sensitivity=_max_sensitivity(cg, full_path),
                        external_reach=external_reach,
                        controls_absent=["validation_missing"],
                        agent_count=max(len(agents), 2),
                    )
                )
                findings.append(
                    make_finding(
                        rule_id="FH-009",
                        finding_id="pending",
                        severity=severity_from_score(score),
                        score=score,
                        path=full_path,
                        edges=cg.edge_ids_on_path(write_path) + cg.hop_edge_ids(memory, reader),
                        evidence={
                            "input_trust_level": "untrusted",
                            "memory_id": memory,
                            "memory_scope": mem_props.get("scope"),
                            "write_validated": False,
                            "reading_agent": reader,
                            "downstream_target": target,
                        },
                    )
                )
    return findings


def fh_012(cg: CapabilityGraph) -> list[Finding]:
    """External publication from untrusted input via deployRelease or moveResource."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()

    # External deployment targets: outputs and data_assets with boundary = external.
    external_targets = [
        n
        for n in cg.graph.nodes()
        if _props(cg, n).get("boundary") == "external"
        and _node_type(cg, n) in {"output", "data_asset"}
    ]

    for start in cg.untrusted_inputs():
        for target in external_targets:
            for path in cg.simple_paths(start, target):
                if len(path) < 2:
                    continue
                final_caps = set(cg.hop_capabilities(path[-2], path[-1]))
                if not final_caps & _DEPLOY_CAPS:
                    continue

                # Probe the node immediately before the target for reversibility.
                pre_target = path[-2]
                pre_target_props = _props(cg, pre_target)
                if _node_type(cg, pre_target) == "tool":
                    reversible = _as_bool(pre_target_props.get("side_effect_reversible", False))
                    dry_run = _as_bool(pre_target_props.get("dry_run_available", False))
                else:
                    reversible = False
                    dry_run = False

                key = tuple(path)
                if key in seen:
                    continue
                seen.add(key)

                agents = _agents_on_path(cg, path)
                score = compute_score(
                    ScoreInputs(
                        base_severity="critical",
                        data_sensitivity=_max_sensitivity(cg, path),
                        external_reach="external",
                        controls_absent=[] if (reversible or dry_run) else ["approval_missing"],
                        reversible=reversible,
                        agent_count=len(agents),
                    )
                )
                findings.append(
                    make_finding(
                        rule_id="FH-012",
                        finding_id="pending",
                        severity=severity_from_score(score),
                        score=score,
                        path=path,
                        edges=cg.edge_ids_on_path(path),
                        evidence={
                            "input_trust_level": "untrusted",
                            "deploy_capability": sorted(final_caps & _DEPLOY_CAPS),
                            "destination_boundary": "external",
                            "side_effect_reversible": reversible,
                            "agent_count": len(agents),
                        },
                    )
                )
    return findings


def fh_013(cg: CapabilityGraph) -> list[Finding]:
    """Internal sensitive data sent to a public channel without PII redaction or content filtering."""
    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    for agent in cg.nodes_of_type("agent"):
        # Identify data assets that this agent reads with medium+ sensitivity from an internal boundary.
        sensitive_reads = [
            v
            for v in cg.graph.successors(agent)
            if _node_type(cg, v) == "data_asset"
            and _props(cg, v).get("sensitivity") in _MEDIUM_PLUS
            and _props(cg, v).get("boundary") == "internal"
            and "read" in cg.hop_capabilities(agent, v)
        ]
        if not sensitive_reads:
            continue

        # Identify public/broadcast outputs this agent notifies without filters.
        for output in cg.graph.successors(agent):
            if _node_type(cg, output) != "output":
                continue
            out_props = _props(cg, output)
            if out_props.get("recipient_type") not in _PUBLIC_RECIPIENTS:
                continue
            if _as_bool(out_props.get("pii_redaction_present", False)):
                continue
            if _as_bool(out_props.get("content_filter_present", False)):
                continue
            if not (set(cg.hop_capabilities(agent, output)) & _NOTIFY_CAPS):
                continue

            asset = sensitive_reads[0]
            key = (agent, asset, output)
            if key in seen:
                continue
            seen.add(key)

            sensitivity = _props(cg, asset).get("sensitivity", "medium")
            score = compute_score(
                ScoreInputs(
                    base_severity="high",
                    data_sensitivity=sensitivity,
                    external_reach="external",
                    controls_absent=["validation_missing"],
                    agent_count=1,
                )
            )
            findings.append(
                make_finding(
                    rule_id="FH-013",
                    finding_id="pending",
                    severity=severity_from_score(score),
                    score=score,
                    # Path: asset → agent → output (display order; edges go agent→asset, agent→output).
                    path=[asset, agent, output],
                    edges=cg.hop_edge_ids(agent, asset) + cg.hop_edge_ids(agent, output),
                    evidence={
                        "agent_id": agent,
                        "source_asset": asset,
                        "source_sensitivity": sensitivity,
                        "source_boundary": "internal",
                        "output_id": output,
                        "recipient_type": out_props.get("recipient_type"),
                        "pii_redaction_present": False,
                        "content_filter_present": False,
                    },
                )
            )
    return findings


# Capabilities that indicate an irreversible action.
_IRREVERSIBLE_CAPS = {"deleteResource", "deployRelease", "send"}


def _unsafe_tool_on_path(cg: CapabilityGraph, path: list[str]) -> str | None:
    """Return the first tool on the path lacking approval or reversibility."""
    for node_id in path:
        if _node_type(cg, node_id) == "tool":
            props = _props(cg, node_id)
            if not _as_bool(props.get("requires_approval", False)) or not _as_bool(
                props.get("side_effect_reversible", True)
            ):
                return node_id
    return None


def fh_011(cg: CapabilityGraph) -> list[Finding]:
    """Destructive change from an untrusted input over a >= medium resource.

    Spec section 8: untrusted input -> agent -> modifyResource/deleteResource
    into a data asset of sensitivity >= medium, mediated by a tool whose
    ``requires_approval`` is false or ``side_effect_reversible`` is false.
    """
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()
    targets = [n for n in cg.nodes_of_type("data_asset") if _props(cg, n).get("sensitivity") in _MEDIUM_PLUS]
    for start in cg.untrusted_inputs():
        for asset in targets:
            for path in cg.simple_paths(start, asset):
                # Spec section 8: agent -> (invokeTool) -> tool -> (modify/delete)
                # -> asset. Require the mediating tool to be invoked by an agent
                # immediately before it, so a hand-authored input -> tool -> asset
                # shortcut (no agent/invocation hop) does not fire.
                if len(path) < 3:
                    continue
                final_caps = set(cg.hop_capabilities(path[-2], path[-1]))
                if not final_caps & {"modifyResource", "deleteResource"}:
                    continue
                if _node_type(cg, path[-3]) != "agent" or "invokeTool" not in cg.hop_capabilities(
                    path[-3], path[-2]
                ):
                    continue
                # Only the tool mediating the destructive hop matters -- an
                # unrelated unsafe tool earlier on the path must not make a
                # safe (approved, reversible) destructive action fire.
                unsafe_tool = _unsafe_tool_on_path(cg, path[-2:])
                if unsafe_tool is None:
                    continue
                key = tuple(path)
                if key in seen:
                    continue
                seen.add(key)

                tool_props = _props(cg, unsafe_tool)
                reversible = _as_bool(tool_props.get("side_effect_reversible", True))
                requires_approval = _as_bool(tool_props.get("requires_approval", False))
                agents = _agents_on_path(cg, path)
                score = compute_score(
                    ScoreInputs(
                        base_severity="high",
                        data_sensitivity=_max_sensitivity(cg, path),
                        external_reach="internal",
                        # Only claim a missing approval gate when one is actually absent.
                        controls_absent=[] if requires_approval else ["approval_missing"],
                        reversible=reversible,
                        agent_count=len(agents),
                    )
                )
                findings.append(
                    make_finding(
                        rule_id="FH-011",
                        finding_id="pending",
                        severity=severity_from_score(score),
                        score=score,
                        path=path,
                        edges=cg.edge_ids_on_path(path),
                        evidence={
                            "input_trust_level": "untrusted",
                            "data_sensitivity": _max_sensitivity(cg, path),
                            "destructive_capability": sorted(final_caps & {"modifyResource", "deleteResource"}),
                            "requires_approval": requires_approval,
                            "side_effect_reversible": reversible,
                            "agent_count": len(agents),
                        },
                    )
                )
    return findings


# ---------------------------------------------------------------------------
# Phase E path rules
# ---------------------------------------------------------------------------


def fh_015(cg: CapabilityGraph) -> list[Finding]:
    """Full-auto agent interprets ambiguous intent then performs an irreversible action without confirmation."""
    findings: list[Finding] = []
    seen: set[str] = set()

    for agent in cg.nodes_of_type("agent"):
        if _props(cg, agent).get("autonomy_level") != "full_auto":
            continue
        # Agent must perform interpretIntent on at least one adjacent edge (either direction).
        if not _has_interpret_intent(cg, agent):
            continue
        # Agent must receive from a non-human input (trust_level != authenticated_human).
        non_trusted_inputs = [
            pred
            for pred in cg.graph.predecessors(agent)
            if _node_type(cg, pred) == "input"
            and _props(cg, pred).get("trust_level") != "authenticated_human"
        ]
        if not non_trusted_inputs:
            continue
        # Agent must also perform an irreversible action on a successor.
        irreversible_target: str | None = None
        for succ in cg.graph.successors(agent):
            if not (set(cg.hop_capabilities(agent, succ)) & _IRREVERSIBLE_CAPS):
                continue
            succ_props = _props(cg, succ)
            if _node_type(cg, succ) == "output":
                if _as_bool(succ_props.get("reversible", False)):
                    continue
            elif _node_type(cg, succ) == "tool":
                if _as_bool(succ_props.get("side_effect_reversible", True)):
                    continue
            else:
                continue
            irreversible_target = succ
            break
        if irreversible_target is None:
            continue
        if _has_control(cg, agent, "askForConfirmation"):
            continue
        if agent in seen:
            continue
        seen.add(agent)

        input_node = non_trusted_inputs[0]
        path = [input_node, agent, irreversible_target]
        reach = _props(cg, irreversible_target).get("boundary", "internal")
        score = compute_score(
            ScoreInputs(
                base_severity="high",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external" if reach == "external" else "internal",
                controls_absent=["approval_missing"],
                reversible=False,
                agent_count=1,
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-015",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "agent_id": agent,
                    "autonomy_level": "full_auto",
                    "irreversible_target": irreversible_target,
                    "ask_for_confirmation": False,
                },
            )
        )
    return findings


def fh_030(cg: CapabilityGraph) -> list[Finding]:
    """Two or more side-effect tools on a path with no verifyResult edge after the last one."""
    findings: list[Finding] = []
    seen: set[tuple[str, ...]] = set()

    for path in cg.find_paths("input", "output"):
        side_effect_tools = [
            n
            for n in path
            if _node_type(cg, n) == "tool"
            and _as_bool(_props(cg, n).get("side_effect", False))
        ]
        if len(side_effect_tools) < 2:
            continue
        last_tool = side_effect_tools[-1]
        last_idx = path.index(last_tool)
        # Check for verifyResult AFTER the last side-effect tool on this path.
        post_caps: set[str] = set()
        for i in range(last_idx, len(path) - 1):
            post_caps.update(cg.hop_capabilities(path[i], path[i + 1]))
        if "verifyResult" in post_caps:
            continue
        if any(_has_control(cg, t, "postConditionCheck") for t in side_effect_tools):
            continue
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)

        agents = _agents_on_path(cg, path)
        reach = _props(cg, path[-1]).get("boundary", "internal")
        score = compute_score(
            ScoreInputs(
                base_severity="medium",
                data_sensitivity=_max_sensitivity(cg, path),
                external_reach="external" if reach == "external" else "internal",
                controls_absent=["validation_missing"],
                agent_count=len(agents),
            )
        )
        findings.append(
            make_finding(
                rule_id="FH-030",
                finding_id="pending",
                severity=severity_from_score(score),
                score=score,
                path=path,
                edges=cg.edge_ids_on_path(path),
                evidence={
                    "side_effect_tool_count": len(side_effect_tools),
                    "side_effect_tools": side_effect_tools,
                    "verify_result_present": False,
                    "agent_count": len(agents),
                },
            )
        )
    return findings
