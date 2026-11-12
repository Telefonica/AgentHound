# Decisions and deferred scope

## Decisions

- **Fresh build, prototype as reference.** The new service follows the spec's
  module layout (§2) with FastAPI + Pydantic v2 + NetworkX. An earlier
  CLI/Streamlit proof of concept diverged from the spec
  (edge `relation` instead of capability verbs, no numeric scoring, no `memory`
  node type, plain dataclasses); its adapter heuristics and rule patterns
  informed this build.

- **Single `nodes`/`edges` IR.** Following spec §4, the IR uses one `nodes` list
  (each node carries `type` + `properties`) and one `edges` list (each edge
  carries a neutral `capability`), rather than the prototype's separate per-type
  collections. This is the frontend contract.

- **English finding text.** Finding `title`/`derivation`/`recommended_controls`
  are authored in English; stable machine fields (`id`, `rule_id`, `category`,
  `severity`, enums) are language-neutral. The prototype used Spanish text.

- **In-memory + JSON storage.** No database in Phase 1 (spec §2). Analyses live in
  a process dict and are mirrored to `AGENTHOUND_DATA_DIR` as JSON so results
  survive restarts and are inspectable.

- **Package under `app/`.** The spec's top-level `backend/` maps to the repo's
  `Backend/`; the spec modules are nested under an importable `app/` package for
  clean absolute imports (`app.core.rules...`).

- **Generic input format.** The spec does not fully pin the generic YAML shape,
  so it is defined as a thin declarative layer over the IR: top-level `metadata`
  plus `nodes` (with `type` + `properties`) and `edges` (with `capability`).

- **Final severity from score.** A rule's catalog `base_severity` seeds the
  score; the *reported* severity is derived from the clamped numeric score (§10),
  so a high-base rule over highly sensitive, externally-reaching data can surface
  as critical.

## Phase 2 — controls and simulation

- **Controls are catalog-driven.** `catalogs/controls.yaml` declares each control
  with the capability verbs it `breaks_capability_kinds` and an `effect`
  (`total`/`partial`), plus presentation hints (`cost`, `demo_priority`). The
  control codes already referenced by the rules' `recommended_controls` all have
  entries; the FH-010/011/014 controls are catalogued now for completeness even
  though those rules land in Phase 3.

- **Simulation = mutate graph + re-run rules (spec §11.1).** Applying a control
  to a target node marks every edge *incident to that node* (either direction)
  whose capability the control breaks. The recompute rebuilds the capability
  graph with the `blocked` edges cut and re-runs the unchanged Phase 1 rule
  engine. The stored analysis is never mutated — the simulation works on a clone.

- **`total` cuts, `partial` credits.** A `total`-effect control marks an edge
  `blocked` and removes it from the recomputed graph, so paths through it
  disappear. A `partial`-effect control marks an edge `mitigated`, which is *not*
  removed; instead every surviving finding whose path crosses a mitigated edge
  has a fixed `existing_controls_credit` (spec §10, `MITIGATION_CREDIT = 1.5` per
  hop) subtracted, lowering its score and possibly its severity band. This keeps
  a partial control genuinely weaker than a total one and prevents a single
  mitigation on the first hop from severing the whole graph. When a total and a
  partial control both hit the same edge, the block dominates: the edge is
  `blocked` and not also `mitigated`, so the two sets stay disjoint and the graph
  carries no contradictory flags.

- **Recommendations are measured, not guessed (spec §12.5).** The recommender
  derives `(control, target)` candidates from each finding's
  `recommended_controls` — the target being the node the broken capability flows
  into — then evaluates each candidate with a single-control what-if simulation
  to report the real `breaks_findings` and `estimated_risk_reduction`.

- **Applied controls as annotated nodes.** The simulated graph adds each applied
  control as an isolated `type: control` node carrying `control_kind`, `effect`,
  `status: present` and `target_node_id`. No synthetic control→target edge is
  added, to avoid polluting the edge list with a non-catalog capability; the
  frontend links a control to its edges via the `blocked`/`mitigated` flags and
  the node's `target_node_id`. Repeated `(control_id, target_node_id)`
  applications are de-duplicated, so the response never carries duplicate
  `applied_controls` entries or duplicate control node ids.

## Phase 3 — real adapters, tool inference and rules FH-010/011/014

- **Adapters emit the current capability-verb IR, not the prototype's shape.**
  The earlier prototype produced separate per-type collections
  with `relation` edges; the CrewAI/Dify heuristics are ported into
  `core/parser/adapters/{crewai,dify,langgraph}_adapter.py` but re-expressed as
  typed nodes + `capability` edges. Shared name-based inference (input trust,
  asset sensitivity, output boundary, control kind) and the spec §6 tool
  inference live in `adapters/_common.py`, so the three adapters stay thin and
  behave consistently. `IRBuilder`/`IdFactory` there keep node/edge ids unique
  and contiguous.

- **A tool's effect is synthesised downstream so rules can traverse it.** The
  agent always `invokeTool`s a tool; then the tool's primary capability verb is
  materialised: a send tool gains an external output (`send`), a read/fetch tool
  a data asset (`read`/`fetchWeb`), a mutating tool the `data_asset` it changes
  (`modifyResource`/`deleteResource` — FH-011 keys on that asset's sensitivity),
  and an executor tool is itself the sink of an `executeCode` hop. This makes the
  risk visible even when the source graph routes a tool into an internal node.

- **CrewAI ingests a single file with `agents` + `tasks`.** This is exactly what
  `detect_framework` keys on and it sidesteps the old two-file upload problem:
  the caller concatenates the two CrewAI files under those keys. Delegation is
  opt-in via a `delegates_to` list; a human-approval control on a send tool marks
  both the tool and its downstream output approval-gated, which is how the safe
  fixture stays clean.

- **Framework detection: the `workflow` wrapper is the Dify signal.** The spec's
  sketch checked a top-level `nodes` key, but a real Dify DSL nests nodes under
  `workflow.graph`. Detection now treats the `workflow` wrapper (never used by
  the generic/LangGraph shapes) as Dify, checked before the bare `graph` key that
  LangGraph shares. LangGraph's ingest shape (`state_graph`/`graph` with nodes +
  edges, `START`/`END` sentinels, an inferred untrusted input for an unfed entry
  agent) is defined fresh here as there was no prototype for it.

- **Rules FH-010/011/014 (spec §8) are registered in the engine.** FH-010 (code
  execution into a non-sandboxed tool) and FH-011 (irreversible/ unapproved
  destructive change over a ≥medium resource) are path rules; FH-014 (unscoped
  delegation from a low-trust/full-auto agent to a trusted-core agent or
  elevated-scope tool) is an edge-local rule scanning `delegateTo` hops directly.
  Their `recommended_controls` already existed in `controls.yaml` (catalogued
  ahead of time in Phase 2).

- **Analysis is split into a parse stage and an analyze stage.** `POST /analyses`
  (`parse_text`) parses the YAML into a stored graph with no findings
  (`status: "parsed"`); `POST /analyses/{id}/analyze` runs the rule engine and
  overwrites the analysis. This matches the wizard flow — the user reviews and
  corrects the inferred capabilities in the Inference step before the rules run —
  so the source files stay the single authoritative input while in-app
  corrections still feed the analysis. The analyze body is optional: no body
  analyses the stored graph as-is (first run, no edits); a `{nodes, edges}` body
  is the user's edited graph, reconciled by id against the stored IR (existing
  ids keep their authoritative properties; new nodes take the normalizer's
  conservative defaults, so an added capability is scored as risky by default).
  `analyze_text` (parse + rules in one) is kept for the rule/adapter test-suites.
  `serialize_graph` now also emits `edge.properties` for a lossless round-trip.

## PR review follow-ups (v0.2 catalog rules)

A colleague review of the v0.2 catalog work produced four decisions, all
implemented on the `new-catalog-rules` branch.

- **Attack vs hygiene channels (`finding_class`).** Hygiene/compliance rules fire
  on almost any graph with default properties, which risks burying the critical
  attack paths. Rather than change scoring or de-duplicate, findings now carry a
  derived `finding_class` (`"attack"` / `"hygiene"`) computed from a single
  source of truth, `HYGIENE_RULE_IDS` in `core/rules/common.py`. The API exposes
  it and the frontend renders two channels. This is a presentation-only split
  with no engine change; a richer model (per-finding `confidence`, root-cause
  de-duplication) is recorded as an optional future enhancement, not a pending
  obligation.

- **FH-028 keys on `full_auto` only.** The catalog pattern also named an
  `A performs decide` clause, but `decide` is an internal, edgeless capability and
  the agent property `capability_kinds_declared` is not populated, so the clause
  had nothing to read. Spec §8 (catalog 04) was amended to drop it; `full_auto`
  is taken to imply decision authority, consistent with FH-015/019/033/035.

- **Shared-memory detection redefined.** FH-009/FH-020 previously compared
  `shared_between_agents` against `scope`, but that literal is a `memory_kind`
  value, so the rules only fired for `organization`/`global` scopes. A shared
  `is_shared_memory()` helper now treats memory as shared when any of
  `shared: true`, `memory_kind == shared_between_agents`, a non-empty
  `shared_with_agents`, or `scope in {organization, global}` holds. Catalog 04
  patterns were updated to match. (`shared` was added later: the LangGraph
  adapter writes it and it is a catalogued memory property, but the helper did
  not read it, so LangGraph shared memory never fired FH-009/FH-020.)

## Adapter/rule alignment

- **LangGraph memory -> agent is `readMemory`.** It was labelled `dataFlow`,
  but FH-009 requires `readMemory` on that hop, so memory poisoning was
  unreachable from LangGraph even with shared memory recognised.

- **CrewAI and Dify map their native memory.** Neither adapter created memory
  nodes, so FH-009, FH-020 and FH-029 could never fire from those formats.
  - CrewAI: a crew-level `memory: true` becomes one `Crew memory` node. Every
    agent `writeMemory`s into it and `readMemory`s from it, since CrewAI keeps
    one memory per crew; an agent with `memory: false` stays out. `memory` may
    instead be a mapping of memory properties (`name`, `sensitivity`,
    `retention_ttl_days`, `write_validated`...).
  - Dify: each entry of `workflow.conversation_variables` becomes a memory
    node, with properties declared on the entry. An `assigner` node writes it:
    the writer is the node whose output is assigned (`sys.*` values come from
    the start node; behind an unmapped node such as `code`, the nearest mapped
    nodes upstream). A constant assignment has no writer. Agents, tools and
    answer/end nodes whose `data` block references the variable
    (`{{#conversation.name#}}` or a `[conversation, name]` selector) read it.
    A variable that no node writes or reads gets no memory node, so an unused
    declaration doesn't trip FH-029.
  - Defaults follow `node_properties.yaml`: `sensitivity: medium`, no
    retention TTL. The memory counts as `shared` once two agents use it,
    unless the file declares `shared`. A single-agent memory is not a
    cross-agent channel, so it shouldn't trip FH-009/FH-020.

- **Routes through memory collapse per entry and sink.** A crew memory that
  every agent writes and reads links every agent to every other one, so
  FH-002/003/007/011 reported each route through it as its own finding: one
  root cause, many times (114 to about 2,000 findings on a large crew). After
  the rules run, findings whose path crosses a memory node keep one per rule,
  entry and sink (the highest-scoring), and drop when a route without memory
  already reports that entry and sink. Paths themselves still cross memory, so
  a route that exists only through memory, shared or not, is still reported.
  (Skipping memory edges in traversal was tried first, but it lost those
  routes whenever FH-009 didn't cover them: unshared memory, or a sink FH-009
  doesn't look for, such as code execution.) FH-009 is exempt, since flow
  through memory is what it reports.

- **Rules match tool-mediated effects.** The adapters never put an effect verb on
  the agent -> tool hop; they emit `agent -invokeTool-> tool -<verb>-> target`.
  FH-008 (fetchWeb on the agent -> tool hop) and FH-025 (agent -> asset `read`)
  were written for the generic shape only and could not fire from tools in a
  framework file. Both now also match the adapter shape via
  `tool_mediated_hops()`, and include the tool's own hop in `edges`. The
  generic shape still matches as before.

- **Adapters copy every catalogued property.** Each adapter used to copy a fixed
  list of keys per node type (four for a CrewAI asset, none at all for Dify),
  silently dropping properties the rules read: `contains_regulated_data`
  (FH-026), `recipient_type` (FH-013), `authentication_scope` and
  `exposure_boundary` (FH-017), `idempotent` (FH-031). `apply_declared_properties()`
  now copies any property catalogued for the node type in
  `node_properties.yaml`, plus a few descriptive extras. Declared values win
  over inferred ones. Dify reads them from each node's `data` block, and an
  `http-request` node's external-send defaults apply only to the keys it
  doesn't declare. Memory also accepts `memory_kind` and `shared_with_agents`,
  the two `is_shared_memory()` signals with no catalog default.

- **Ignored declarations are reported.** Unknown keys are still dropped, so a
  structural key can't clobber a derived property, but a dropped key that looks
  like a declaration now comes back as an `ignored_property` warning: a near-miss
  of an accepted property (difflib ratio >= 0.85, so `contains_regulated_dta`
  suggests `contains_regulated_data`) or a property of another node type. Other
  unknown keys are the framework's own (`backstory`, `title`...) and stay
  silent; on the bundled examples none are reported. The
  warnings depend on the file, so they're stored on the IR (`parse_warnings`).

- **Declared `deployRelease`/`moveResource` are routed.** A tool declared with
  either verb in `capability_kinds` used to get only an `invokeTool` edge, so
  FH-012 could not fire from a framework file. The tool now gains an external
  destination output reached by that verb. No tool name infers these verbs; they
  have to be declared. Declaring either one also sets `side_effect: true` and
  `side_effect_reversible: false` unless the file states them, so FH-032 sees a
  deployment tool as irreversible. The destination is marked
  `output_kind: deployment_target`, which FH-022 skips: it carries no message
  content to filter or redact.

- **Graph nodes carry `finding_ids` and `risk_level`.** Node-scoped findings
  have no edges, so they coloured nothing on the graph. Nodes now carry the same
  per-finding index as edges.

- **`interpretIntent` direction tolerance.** The backend catalog orients
  `interpretIntent` as agent→input while the frontend groups it as input→agent,
  and no adapter emitted it, so FH-015/FH-033 could silently never fire. Both
  rules now detect the verb on an edge in either direction via
  `has_interpret_intent()`, with fixtures covering the inbound case.

## Engine follow-ups

- **Scoring left as published.** On large architectures many critical findings
  tie at the 10.0 ceiling. The score, weights and clamp stay exactly as in the
  paper (§VI) and the ties are accepted. Known
  side effect: the simulator subtracts mitigation credit from the clamped score,
  so on a saturated finding it overstates the percentage reduction.

- **Root-cause grouping.** The "root-cause de-duplication" noted above as
  optional is now implemented as a grouping layer, not de-duplication: no
  finding, score or severity changes. Each finding gets a `group_id`, and the
  API returns `groups[]`. The key is declared per rule (`group_by` in
  `rules.yaml`): `rule` for the seven policy-absence rules that fire once per
  agent/tool/input, `source` (rule + first path node) for everything else. On
  three 64-node test architectures this takes 110–238 findings down to 45–88
  groups. Simulation adds `risk_reduction.by_group`, which counts each group
  once at its highest score; the per-finding figure the paper reports is
  unchanged. A partial fix therefore doesn't move `by_group` until a group's
  worst finding is gone (see `api.md`).
