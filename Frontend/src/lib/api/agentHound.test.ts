import { afterEach, describe, expect, it, vi } from "vitest";

import { toFindingPathGraph } from "./adapters";
import { getFinding, renameAnalysis } from "./agentHound";
import type { BackendFinding, FindingDetailResponse } from "./types";

const backendFinding: BackendFinding = {
  id: "finding_002",
  rule_id: "FH-011",
  title: "Untrusted input reaches an external output",
  severity: "high",
  score: 8.2,
  category: "capability_path",
  path: ["input_email", "agent_triage", "output_reply"],
  edges: ["e1", "e2"],
  derivation: "",
  evidence: {},
  recommended_controls: ["humanInTheLoop"],
  owasp_agentic: [],
  owasp_llm: [],
  mitre_atlas: [],
  finding_class: "attack",
  group_id: "g1",
};

const detail: FindingDetailResponse = {
  finding: backendFinding,
  path_graph: {
    nodes: [
      { id: "input_email", label: "Email", type: "input", risk_score: 8.2, risk_level: "high", finding_ids: ["finding_002"], properties: {}, badges: [] },
      { id: "agent_triage", label: "Triage", type: "agent", risk_score: 8.2, risk_level: "high", finding_ids: ["finding_002"], properties: {}, badges: [] },
      { id: "output_reply", label: "Reply", type: "output", risk_score: 8.2, risk_level: "high", finding_ids: ["finding_002"], properties: {}, badges: [] },
    ],
    edges: [
      { id: "e1", source: "input_email", target: "agent_triage", label: "", capability: "read", risk_level: "high", blocked: false, mitigated: false, detected: false, finding_ids: ["finding_002"] },
      { id: "e2", source: "agent_triage", target: "output_reply", label: "", capability: "send", risk_level: "high", blocked: false, mitigated: false, detected: false, finding_ids: ["finding_002"] },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFinding", () => {
  it("requests the finding's own endpoint, encoding both ids, and forwards the abort signal", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const res = await getFinding("a/1", "finding 002", { signal: controller.signal });

    expect(res).toEqual(detail);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/analyses/a%2F1/findings/finding%20002",
      { signal: controller.signal },
    );
  });

  it("surfaces FINDING_NOT_FOUND from the error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "FINDING_NOT_FOUND", message: "No finding x." } }), { status: 404 }),
      ),
    );

    await expect(getFinding("a1", "x")).rejects.toMatchObject({ code: "FINDING_NOT_FOUND", status: 404 });
  });
});

describe("renameAnalysis", () => {
  it("PATCHes the analysis with the new name as JSON", async () => {
    const item = { analysis_id: "a/1", name: "Renamed" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(item), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await renameAnalysis("a/1", "Renamed");

    expect(res).toEqual(item);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/analyses/a%2F1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
  });

  it("surfaces INVALID_NAME from the error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_NAME", message: "Empty." } }), { status: 400 }),
      ),
    );

    await expect(renameAnalysis("a1", " ")).rejects.toMatchObject({ code: "INVALID_NAME", status: 400 });
  });
});

describe("toFindingPathGraph", () => {
  it("maps the finding and keeps only the nodes and edges of its route", () => {
    const graph = toFindingPathGraph(detail);

    expect(graph.finding).toMatchObject({ id: "finding_002", ruleId: "FH-011", severity: "high", groupId: "g1" });
    expect(graph.nodes.map((n) => [n.id, n.type])).toEqual([
      ["input_email", "input"],
      ["agent_triage", "agent"],
      ["output_reply", "output"],
    ]);
    expect(graph.edges.map((e) => [e.id, e.f, e.t, e.riskLevel, e.findingIds])).toEqual([
      ["e1", "input_email", "agent_triage", "high", ["finding_002"]],
      ["e2", "agent_triage", "output_reply", "high", ["finding_002"]],
    ]);
  });
});
