# Examples

Architectures that run through the engine as they are. Each file's header
comment states the findings it's meant to show. `Backend/tests/test_examples_baseline.py`
pins the rule set, finding count and max score of every file.

| Folder | Scenario | Formats |
|---|---|---|
| `01_support_email` | One agent reads the CRM and replies by email (FH-002, FH-003) | CrewAI, Dify, LangGraph |
| `02_data_codeexec` | Data assistant running unsandboxed code (FH-010, FH-002) | CrewAI, Dify, LangGraph |
| `03_ops_destructive` | Operations assistant deleting records without approval (FH-011) | CrewAI, Dify, LangGraph |
| `04_hiresmart_pipeline` | The paper's multi-agent recruiting case study | CrewAI, Dify, LangGraph, generic |
| `05_prototype_support_pair` | Risky/safe pair migrated from the first prototype | CrewAI, Dify |

To see which rules fire per file:

```bash
cd Backend
python scripts/coverage_matrix.py ../examples --rules
```

## Rule coverage per format

**The generic format is the only one that covers the full rule catalog.** The
framework adapters (CrewAI, Dify, LangGraph) build the graph from the
framework's own structure, and some rule shapes can't come out of it. Every
analysis of a framework file returns the gaps as `warnings[]`; the full list,
with the reason for each, is in
[`Backend/app/catalogs/adapter_coverage.yaml`](../Backend/app/catalogs/adapter_coverage.yaml).

Rules no adapter can reach today: FH-006, FH-015 and FH-031 in all three;
FH-030 in CrewAI and LangGraph; FH-001 and FH-024 in CrewAI; the delegation
rules (FH-014, FH-023) in Dify. Use the generic format when you need those.

The memory rules (FH-009, FH-020, FH-029) come from each framework's own
memory: a crew-level `memory: true` in CrewAI (shared by the crew's agents;
an agent opts out with `memory: false`), conversation variables in Dify
(written by `assigner` nodes, read by the nodes that reference them), and
`type: memory` nodes in LangGraph. Declare memory properties on the crew's
`memory` mapping, on the conversation variable, or on the LangGraph node.

### Properties that unlock rules in framework files

Some rules need a property the framework has no native field for. Declare it
on the node's entry (an agent, a tool, a data asset, an output) and the
adapter passes it through. In Dify, put it in the node's `data` block.

| Rule | Declare | On |
|---|---|---|
| FH-012 | `capability_kinds: [deployRelease]` (or `moveResource`) | the tool |
| FH-017 | `exposure_boundary: external` | the agent |
| | `authentication_scope: elevated` | a tool that agent can reach |
| FH-025 | `boundary: external` | the data asset being read |
| FH-026 | `contains_regulated_data: [gdpr]` | the data asset |
| FH-013 | `recipient_type: public_channel` (or `broadcast`) | the output |
| FH-014 | `trust_level: trusted_core` | the agent named in `delegates_to` (CrewAI, LangGraph) |
| FH-009, FH-020 | `shared: true` | the memory node (LangGraph) |
| FH-004, FH-034 | `boundary: external` | the answer/end node the agent writes to (Dify) |

For example, in CrewAI:

```yaml
agents:
  intake:
    exposure_boundary: external
    tools:
      - {name: release pipeline, capability_kinds: [deployRelease]}
      - {name: admin api, authentication_scope: elevated}
    data_assets:
      - {name: Partner feed, boundary: external}
      - {name: Patient files, contains_regulated_data: [gdpr]}
```

`Backend/tests/fixtures/coverage_{crewai,dify,langgraph}.yaml` are complete
files that reach every rule their format can express.
