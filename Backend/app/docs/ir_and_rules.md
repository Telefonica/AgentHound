# IR, capabilities, rules and scoring

Traceability to the backend specification is noted per section.

## Internal representation (spec §4)

One analysis is a single IR object:

```json
{
  "analysis_id": "uuid",
  "source_framework": "generic",
  "metadata": { "name": "...", "uploaded_at": "..." },
  "nodes": [],
  "edges": [],
  "controls": []
}
```

- **Node** (`{id, type, name, properties}`) — `type` is one of the seven types
  `agent | input | tool | data_asset | output | memory | control`. `properties`
  is a free-form map of risk-relevant attributes; missing values are filled with
  safe defaults by the normalizer.
- **Edge** (`{id, source, target, capability, properties}`) — `capability` is a
  neutral verb from the catalog. Sensitivity/externality are **never** encoded in
  the capability name; they come from the target node's properties.

Models live in [`core/ir/models.py`](../core/ir/models.py).

## Capability catalog (spec §3)

Defined in [`catalogs/capabilities.yaml`](../catalogs/capabilities.yaml): 53
verbs in nine phases of the agent cycle. Each verb's `evaluated_by` lists the
rules that check for it. Only 18 verbs have a non-empty list; the
rest are vocabulary only: accepted on edges and drawn in the graph, but no rule
fires because of them. `tests/test_capability_catalog.py` re-derives the lists
from the rule modules and fails when they drift.

## Adapter coverage

Only the generic format can express every rule. Each framework adapter has
gaps, listed in [`catalogs/adapter_coverage.yaml`](../catalogs/adapter_coverage.yaml)
and returned as `warnings[]` with every framework analysis (see `api.md`):
`not_expressible` rules can't fire whatever the file says, and
`needs_declaration` rules fire once the file declares the named property.
`tests/test_adapter_coverage.py` pins the catalog with one fixture per framework
that reaches exactly the expressible rules.

## Safe defaults (spec §4.2)

Defined in [`catalogs/node_properties.yaml`](../catalogs/node_properties.yaml)
and applied by [`core/ir/normalizer.py`](../core/ir/normalizer.py). Defaults are
deliberately cautious, e.g. `input.trust_level=untrusted`,
`output.boundary=external`, `output.approval_gate_present=false`,
`agent.autonomy_level=full_auto`.

## Tool → capability mapping (spec §6)

`TOOL_CAPABILITY_MAP` in the normalizer provides a best-effort mapping from
concrete tool names to generic verbs, e.g. `gmail.send → [send, invokeTool]`,
`browser.visit → [fetchWeb]`, `ats.query → [read, search]`. The generic YAML
format still declares each edge's `capability` explicitly, but the **framework
adapters (Phase 3)** apply this mapping automatically: `adapters/_common.py`
extends it with keyword heuristics and synthesises the downstream node + verb
edge for each tool (see [decisions.md](decisions.md)).

## Rules (spec §8)

Descriptors in [`catalogs/rules.yaml`](../catalogs/rules.yaml); detection in
[`core/rules/path_rules.py`](../core/rules/path_rules.py) and
[`core/rules/node_rules.py`](../core/rules/node_rules.py).

| Rule | Pattern | Base severity |
|------|---------|---------------|
| FH-001 | untrusted input → agent → `read` on high/critical asset → `send` to external output, no approval gate | critical |
| FH-002 | untrusted input can reach a `read` over a high/critical asset | high |
| FH-003 | untrusted input → external output (`send`, no approval), no sensitive asset on path | high |
| FH-006 | untrusted input → agent `fetchWeb` on external content → no contentValidation → second agent → external output, no approval | high |
| FH-010 | untrusted input → agent → `executeCode` into a tool with `sandbox_enabled = false` | high |
| FH-011 | untrusted input → `modifyResource`/`deleteResource` on a ≥ medium data asset via a tool that is not approval-gated or not reversible | high |
| FH-014 | low-trust or full-auto agent → `delegateTo` a `trusted_core` agent (or elevated-scope tool) with `has_scoped_delegation = false` | high |

Each arrow in a rule is a capability on a **specific hop**, not merely a
capability present somewhere on the path (spec §8). Concretely: FH-001 requires a
`read` edge *into* a high/critical asset and a `send` edge *into* the external
output; FH-002 requires the sensitive asset to be reached by a `read` on the
final hop; FH-003 requires the `send` to reach the external output on the final
hop. This avoids false positives where the right capability exists on an
unrelated hop.

Graph queries used by the rules are in
[`core/graph/traversal.py`](../core/graph/traversal.py); all paths are bounded by
`max_depth=8` (spec §9).

Every finding also carries a derived `finding_class` (`"attack"` or `"hygiene"`),
computed from `HYGIENE_RULE_IDS` in
[`core/rules/common.py`](../core/rules/common.py) — the single source of truth for
which rules are hygiene/compliance signals. It has no effect on scoring; it lets
the client separate exploitable attack paths from hygiene findings.

## Scoring (spec §10)

[`core/rules/scoring.py`](../core/rules/scoring.py) implements:

```
score = base_severity_value
      + data_sensitivity_weight
      + external_reach_weight
      + control_absence_weight
      + reversibility_penalty
      + agent_count_weight
      - existing_controls_credit
```

clamped to `[0, 10]`. Final severity band: `>=9 critical`, `>=7 high`,
`>=4 medium`, `>=2 low`, else `info`. Because the additive weights are large, a
full exfiltration path over high-sensitivity PII saturates at 10.0 (critical).

## Controls and simulation (spec §11, Phase 2)

Controls are catalogued in [`catalogs/controls.yaml`](../catalogs/controls.yaml).
Each declares the capability verbs it `breaks_capability_kinds` and an `effect`:

- `effect: total` → an affected edge is marked `blocked` and cut from the
  recomputed graph, so attack paths through it disappear.
- `effect: partial` → an affected edge is marked `mitigated`; it stays in the
  graph, but any surviving finding whose path crosses it loses
  `MITIGATION_CREDIT` (1.5) per mitigated hop from its score (spec §10
  `existing_controls_credit`), lowering the score and possibly the severity band.

Applying a control to a target node affects every edge *incident* to that node
(either direction) whose capability the control breaks.
[`core/controls/simulator.py`](../core/controls/simulator.py) clones the IR, adds
the applied controls as `type: control` nodes, recomputes findings, and returns
before/after risk plus `broken_paths` (spec §11.1). The stored analysis is never
mutated. [`core/controls/recommender.py`](../core/controls/recommender.py) maps
each finding's `recommended_controls` to concrete target nodes and measures each
with a single-control what-if simulation (spec §12.5).

## Validation (spec §13)

[`core/ir/validators.py`](../core/ir/validators.py) enforces unique node ids,
edges referencing existing nodes, capabilities in the catalog, valid node types,
and non-empty input. For findings it requires a non-empty `rule_id` and a
non-empty `path` (severity and score are guaranteed by the model). All failures
raise `IRValidationError`, rendered as the error envelope.

## Logging (spec §14)

[`logging_util.py`](../logging_util.py) emits one JSON line per event
(`analysis_started`, `parser_selected`, `rules_executed`, `findings_generated`,
`analysis_completed`, and for control simulation `simulation_started` /
`simulation_completed`) with `analysis_id`, `timestamp`, `event`, `metadata`. No
prompts or sensitive data are logged.
