# API reference (Phase 1 + Phase 2)

Base URL defaults to `http://127.0.0.1:8000`. The interactive OpenAPI UI at
`/docs` is generated automatically by FastAPI from the route signatures and
Pydantic models; it lists the endpoints and parameters, but several routes
return plain objects without a declared `response_model`, so their response
schemas show as generic. This file summarizes the intended contract and payload
shapes.

All error responses use the spec §13 envelope:

```json
{ "error": { "code": "ANALYSIS_NOT_FOUND", "message": "...", "details": {} } }
```

A request that fails FastAPI's own validation (a missing field, a wrong type,
a value over its length limit) is a 422 with code `INVALID_REQUEST`, and
`details.errors` lists each problem as `{ loc, msg, type }`.

## POST /analyses  (spec §12.1)

**Parse** an architecture YAML into a stored graph. This is the first of two
stages: it builds and persists the IR/graph but does **not** run the rule engine
yet, so no findings are produced here (the wizard shows the inferred
capabilities for editing, then calls `POST .../analyze`). The finding counts in
`summary` are therefore all zero and `status` is `"parsed"`.

- Content-Type: `multipart/form-data`
- Fields:
  - `file` (required) — the architecture YAML.
  - `framework` (optional) — adapter override (`generic`, `crewai`, `dify`,
    `langgraph`); omitted, the framework is auto-detected.
  - `name` (optional) — analysis name, at most 200 characters; overrides the
    YAML's `metadata.name` when provided. Echoed back as `name` in the response.

Response:

```json
{
  "analysis_id": "uuid",
  "status": "parsed",
  "name": "HireSmart Copilot",
  "source_framework": "crewai",
  "summary": { "nodes": 7, "edges": 6, "findings": 0,
               "critical": 0, "high": 0, "medium": 0, "max_score": 0.0 },
  "warnings": [
    { "kind": "needs_declaration", "rules": ["FH-026"],
      "properties": ["contains_regulated_data"],
      "declare": [[ { "node_type": "data_asset",
                      "property": "contains_regulated_data",
                      "values": ["gdpr"] } ]],
      "message": "Declare `contains_regulated_data: [gdpr]` on the data asset." },
    { "kind": "ignored_property", "rules": [],
      "properties": ["contains_regulated_dta"],
      "node": "Patients", "node_type": "data_asset",
      "suggestion": "contains_regulated_data",
      "message": "`contains_regulated_dta` on data_asset 'Patients' is not a known property and was ignored; did you mean `contains_regulated_data`?" }
  ]
}
```

`warnings` first lists the rules the file's framework can't reach, from
[`catalogs/adapter_coverage.yaml`](../catalogs/adapter_coverage.yaml).
`kind` is `not_expressible` (the adapter can't produce the shape the rule needs)
or `needs_declaration` (the rule fires once the file declares what `declare`
lists). `declare` holds alternative options, any one of which unlocks the rule;
each option is a list of requirements that must all hold, and each requirement
names the `node_type` the property goes on, the `property` and the `values`
that trigger the rule (any one of them; for a list property, the list must
contain it). An optional `role` narrows which node of that type: `delegate`
(the agent another agent delegates to), `reachable` (a tool the option's agent
can reach), `read` (the data asset the agent reads), `sent_to` (the output the
agent sends to) or `shared` (memory more than one agent uses). `properties` is the property names in `declare`, in order. Once
the analysis has run, a `needs_declaration` entry is left out if any of its
rules fired: the file already has the declaration. These are always absent for
the generic format, which covers the full rule catalog. They're computed from
the framework and the findings on every read, so they're also returned for
analyses saved before the field existed.

`source_framework` is the detected input format (`generic`, `crewai`, `dify` or
`langgraph`); `POST .../analyze` and `GET /analyses/{analysis_id}` return it
too. In a Dify file, declarations go in the node's `data` block.

Then come the file's own `ignored_property` entries: a key on a framework node
that looks like a property declaration but was dropped, either a near-miss of a
property the node accepts (`suggestion` names it) or a property that belongs to
another node type (`suggestion` is `null`). Other unknown keys are taken to be
the framework's own (`backstory`, `title`...) and aren't reported. The generic
format validates its properties in the normalizer instead, so it never returns
these.

Every entry has `kind`, `rules`, `properties` and `message`. `message` is
English; a client that translates should build its text from `kind`, `rules`
and `properties` (plus `declare` on `needs_declaration`, and `node`,
`node_type` and `suggestion` on `ignored_property`). `GET /analyses/{analysis_id}` and `POST .../analyze` return
the same array.

Common errors: `EMPTY_INPUT`, `INVALID_YAML`, `INVALID_NODE_TYPE`,
`UNKNOWN_CAPABILITY`, `INVALID_IR` (400).

## POST /analyses/{analysis_id}/analyze

**Analyze** stage: run the rule engine over the stored graph and overwrite the
analysis with the findings. Call this after `POST /analyses`, optionally with the
user's edited capabilities.

- Content-Type: `application/json` (optional body).
- Body:
  - **omitted / empty** — analyze the stored parsed graph as-is (the first run,
    when the user made no edits).
  - `{ "nodes": [...], "edges": [...] }` — the user's edited graph (the full
    graph, not a diff). Node shape: `{ id, type, name, properties }` (`type` is a
    backend `NodeType`, e.g. `data_asset`). Edge shape:
    `{ id, source, target, capability, properties }`. The pipeline reconciles by
    id against the stored IR: an existing id keeps its stored (authoritative)
    `properties` and only takes the edited `name`/`capability`; a newly added
    node/edge is created fresh and picks up the normalizer's conservative
    defaults (input→untrusted, output→external, data_asset→medium sensitivity).

Response (same shape as `/analyze` produces for the results view):

```json
{
  "analysis_id": "uuid",
  "status": "completed",
  "name": "HireSmart Copilot",
  "source_framework": "crewai",
  "summary": { "nodes": 7, "edges": 6, "findings": 3,
               "critical": 1, "high": 2, "medium": 0, "max_score": 10.0 },
  "graph": { "nodes": [], "edges": [] },
  "findings": [ { "id", "rule_id", "group_id", ... } ],
  "groups": [ { "group_id", "rule_id", "count", ... } ],
  "warnings": [ { "kind", "rules", "properties", "message" } ]
}
```

`groups` is described under `GET .../findings`; `warnings` under `POST /analyses`.

The stored analysis is overwritten under the same id, so subsequent
`GET .../graph`, `GET .../findings` and the control endpoints reflect the
analyzed (and, if edited, corrected) graph. Errors: `ANALYSIS_NOT_FOUND` (404);
`INVALID_IR`, `UNKNOWN_CAPABILITY`, `INVALID_NODE_TYPE` (400) for a malformed
edited graph.

## PATCH /analyses/{analysis_id}

**Rename** a stored analysis. Works at either stage (parsed or analyzed), and a
later `POST .../analyze` keeps the new name.

- Content-Type: `application/json`
- Body: `{ "name": "New name" }`. Surrounding whitespace is trimmed. At most
  200 characters, the same limit as the `name` field of `POST /analyses`.

Returns the same object as `GET /analyses/{analysis_id}` (and a row of
`GET /analyses`), with the new `name`. Errors: `INVALID_NAME` (400) for an
empty or blank name; `INVALID_REQUEST` (422) for a missing, non-string or
over-long name; `ANALYSIS_NOT_FOUND` (404).

A rename, `POST .../analyze` and `DELETE` on the same analysis run one at a
time, so a rename sent while the analysis runs waits for it and is not lost.

## GET /analyses/{analysis_id}/graph  (spec §12.2)

Returns the normalized graph in the frontend shape:

```json
{
  "nodes": [{ "id", "label", "type", "risk_score", "risk_level",
              "finding_ids": [], "properties", "badges": [] }],
  "edges": [{ "id", "source", "target", "label", "capability", "properties",
              "risk_level", "blocked": false, "mitigated": false,
              "finding_ids": [] }]
}
```

`404 ANALYSIS_NOT_FOUND` if the id is unknown. `blocked`/`mitigated` are always
false here; they are set by the control simulator (§12.6).

A node's `finding_ids` lists every finding whose `path` contains it, and its
`risk_level` is the highest severity among them (`info` when none). This is the
only place a node-scoped finding shows up, since those findings have no edges.

## GET /analyses/{analysis_id}/findings  (spec §12.3)

Returns findings ordered by `score` descending:

```json
{ "findings": [ { "id", "rule_id", "title", "severity", "score", "category",
                  "finding_class", "group_id", "path": [], "edges": [], "derivation",
                  "evidence": {}, "recommended_controls": [], "owasp_agentic": [],
                  "owasp_llm": [], "mitre_atlas": [] } ],
  "groups": [ { "group_id", "rule_id", "title", "group_by", "anchor_node_id",
                "finding_class", "count", "max_score", "severity",
                "representative_finding_id", "finding_ids": [] } ] }
```

`groups` collapses repeated occurrences of one root cause (`core/rules/grouping.py`).
Each finding's `group_id` names its group. A rule's `group_by` in `rules.yaml`
sets the key: `rule` puts every finding of that rule in one group (the
policy-absence rules FH-021/022/027/028/033/034/035, which fire once per
agent/tool/input), and `source` (the default) groups by rule and the first node
of the finding's `path`, so the routes from one entry point to several sinks
form one group. `anchor_node_id` is that first node, or `null` for `rule`
groups. Groups are ordered by `max_score` descending; `representative_finding_id`
is the group's highest-scoring finding. Grouping changes no score, severity or
finding. `/analyze` returns the same `groups` array.

`finding_class` is a derived label, not a stored field: `"attack"` for an
exploitable capability path, or `"hygiene"` for a hygiene/compliance signal (the
rule ids in `HYGIENE_RULE_IDS`, the single source of truth in
`core/rules/common.py`). It carries no scoring weight — it exists so the client
can present attack paths and hygiene findings as separate channels rather than
one ranked list. The same field appears on every finding returned by `/analyze`
and `/findings/{finding_id}`.

## GET /analyses/{analysis_id}/findings/{finding_id}  (spec §12.4)

Returns one finding plus a `path_graph` subgraph limited to that finding's nodes
and edges (same node/edge shape as `/graph`):

```json
{ "finding": { ... }, "path_graph": { "nodes": [], "edges": [] } }
```

`404 FINDING_NOT_FOUND` if the finding id is unknown.

## GET /analyses/{analysis_id}/controls/recommendations  (spec §12.5)

Recommends controls for the analysis, ranked by estimated risk reduction
(descending), then by demo priority. Each recommendation is measured by a
single-control what-if simulation, so `breaks_findings` and
`estimated_risk_reduction` are computed, not guessed.

```json
{
  "recommendations": [
    {
      "control_id": "humanInTheLoop",
      "name": "Human approval",
      "target_node_id": "output_email_candidate",
      "breaks_findings": ["finding_001"],
      "estimated_risk_reduction": 10.0,
      "cost_estimate": "low",
      "demo_priority": "must_show"
    }
  ]
}
```

`404 ANALYSIS_NOT_FOUND` if the id is unknown.

## POST /analyses/{analysis_id}/simulate-controls  (spec §12.6, §11.1)

Simulates applying a caller-supplied set of controls and returns before/after
risk. Body:

```json
{ "controls_to_apply": [
    { "control_id": "humanInTheLoop", "target_node_id": "output_email_candidate" }
] }
```

A control applied to a node marks every edge incident to that node whose
capability it breaks. `effect: total` marks the edge `blocked` and cuts it from
the recomputed graph (the attack path disappears); `effect: partial` marks it
`mitigated` and instead lowers the score of any surviving finding that crosses
it. The stored analysis is never mutated. Response:

```json
{
  "analysis_id": "uuid",
  "applied_controls": [
    { "control_id", "name", "category", "effect", "target_node_id",
      "affected_edge_ids": [] }
  ],
  "before": { "finding_count": 3, "critical_count": 1, "max_score": 10.0 },
  "after":  { "finding_count": 2, "critical_count": 0, "max_score": 8.8 },
  "risk_reduction": { "absolute": 10.0, "percentage": 36.2,
                      "by_group": { "absolute": 10.0, "percentage": 41.0 } },
  "broken_paths": [
    { "finding_id": "finding_001", "rule_id": "FH-001",
      "broken_by": "humanInTheLoop", "target_node_id": "output_email_candidate" }
  ],
  "graph": { "nodes": [], "edges": [] }
}
```

`risk_reduction.absolute`/`percentage` sum the scores of every finding, so a
cause that repeats N times counts N times. `by_group` is the same reduction with
each root-cause group counted once, at its highest score.

Because a group counts at its highest score, a partial fix doesn't move
`by_group` until the group's worst finding is gone. This matters most for the
`group_by: rule` groups, which hold one finding per agent, tool or input: with
22 agents behind FH-028, mitigating 21 of them leaves that group's contribution
unchanged, and it drops only when the last one is fixed. Use the top-level
figure to see progress on individual findings.

The returned `graph` includes the applied controls as `type: control` nodes and
flags the affected edges `blocked`/`mitigated`. Errors: `UNKNOWN_CONTROL`,
`UNKNOWN_TARGET_NODE` (400); `ANALYSIS_NOT_FOUND` (404).

## GET /capabilities

Returns the capability catalog (`catalogs/capabilities.yaml`): every verb an
edge may carry, in catalog order (the phases of the agent cognitive cycle).

```json
{ "capabilities": [ { "verb": "executeCode",
                      "description": "Execute code / shell commands.",
                      "typical_source": "agent", "typical_target": "tool",
                      "evaluated_by": ["FH-010", "FH-016"] } ] }
```

`evaluated_by` lists the rules whose logic checks for the verb, so a client can
tell which edges the rule engine actually reacts to. An empty list means the
verb is vocabulary only: it is accepted on edges and drawn in the graph, but no
rule fires because of it. `tests/test_capability_catalog.py` keeps the lists in
sync with the rule code. The catalog is static, so the response does not depend
on any analysis. The response is declared as `CapabilitiesResponse` in OpenAPI,
mirroring the type of the same name in `types.ts`.

## GET /health

`{ "status": "ok", "version": "0.1.0" }`
