import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CapabilityGraph from "@/components/threat-model/CapabilityGraph";
import type { CyberGraphProps } from "@/components/threat-model/graph/CyberGraph";
import { getFinding } from "@/lib/api/agentHound";
import type { FindingDetailResponse } from "@/lib/api/types";
import type { Attack } from "@/types/ThreatModel";
import { findingLabels } from "@/lib/results/findingDisplay";
import { mount, press } from "../test-utils";
import { edges, findings, nodes } from "./fixtures";

const canvas = vi.hoisted(() => ({ props: null as CyberGraphProps | null }));
vi.mock("@/components/threat-model/graph/CyberGraph", () => ({
  default: (props: CyberGraphProps) => {
    canvas.props = props;
    return null;
  },
}));

vi.mock("@/lib/api/agentHound", () => ({ getFinding: vi.fn() }));
const getFindingMock = vi.mocked(getFinding);

const labels = findingLabels(findings);
let view: ReturnType<typeof mount>;
let onSelectFinding: ReturnType<typeof vi.fn<(id: string) => void>>;
let onClearSelection: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  view = mount();
  onSelectFinding = vi.fn<(id: string) => void>();
  onClearSelection = vi.fn<() => void>();
  canvas.props = null;
  getFindingMock.mockReset();
});

afterEach(() => {
  view.unmount();
  vi.restoreAllMocks();
});

function render({ selectedFindingId = null as string | null, solved = false, findingList = findings, attacks = [] as Attack[] } = {}) {
  view.render(
    <CapabilityGraph
      analysisId="a1"
      solved={solved}
      nodes={nodes}
      edges={edges}
      findings={findingList}
      attacks={attacks}
      findingLabelById={labels}
      selectedFindingId={selectedFindingId}
      onSelectFinding={onSelectFinding}
      onClearSelection={onClearSelection}
    />,
  );
}

const rows = () => Array.from(view.container.querySelectorAll("button"));
const rowFor = (label: string) => rows().find((b) => b.textContent?.startsWith(label));

describe("CapabilityGraph — prioritized findings", () => {
  it("lists repeated rules with an ordinal so duplicates are distinguishable", () => {
    render();

    expect(rows().map((b) => b.textContent?.split("Datos")[0]?.split("Escritura")[0])).toEqual([
      "FH-001 #1",
      "FH-001 #2",
      "FH-004",
    ]);
  });

  it("selects a finding when its row is pressed", () => {
    render();

    press(rowFor("FH-001 #2")!);

    expect(onSelectFinding).toHaveBeenCalledWith("f2");
  });

  it("does not offer a route for findings without a path", () => {
    render();

    expect(view.container.textContent).toContain("HY-002");
    expect(rowFor("HY-002")).toBeUndefined();
  });

  it("marks only the selected row as current", () => {
    render({ selectedFindingId: "f1" });

    expect(rowFor("FH-001 #1")!.getAttribute("aria-current")).toBe("true");
    expect(rowFor("FH-001 #2")!.hasAttribute("aria-current")).toBe(false);
  });
});

describe("CapabilityGraph — graph highlight", () => {
  it("passes no highlight while nothing is selected", () => {
    render();

    expect(canvas.props?.highlight).toBeNull();
  });

  it("highlights the selected finding's exact hops, telling duplicates apart", () => {
    render({ selectedFindingId: "f1" });
    const first = canvas.props?.highlight;
    render({ selectedFindingId: "f2" });
    const second = canvas.props?.highlight;

    expect(first).toEqual({
      nodeIds: ["input", "planner", "crm"],
      edgeIds: ["e1", "e3"],
      label: "FH-001 #1",
      summary: "Email entrante → Planner → CRM",
    });
    expect(second?.nodeIds).toEqual(["input", "planner", "logs"]);
    expect(second?.edgeIds).toEqual(["e1", "e4"]);
    expect(second?.label).toBe("FH-001 #2");
  });

  it("wires the canvas' clear action to the parent", () => {
    render({ selectedFindingId: "f1" });

    canvas.props?.onClearHighlight?.();

    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("names the selected finding on the canvas' play action", () => {
    render({ selectedFindingId: "f2" });

    expect(canvas.props?.labels.playRoute(canvas.props.highlight!.label)).toBe("Reproducir FH-001 #2");
  });

  it("drops the highlight in the solved view", () => {
    render({ selectedFindingId: "f1", solved: true });

    expect(canvas.props?.highlight).toBeNull();
  });
});

const f1Detail: FindingDetailResponse = {
  finding: {
    id: "f1", rule_id: "FH-001", title: findings[0]!.title, severity: "critical", score: 9.1,
    category: "capability_path", path: ["input", "planner", "crm"], edges: ["e1", "e3"], derivation: "",
    evidence: {}, recommended_controls: ["humanInTheLoop"], owasp_agentic: [], owasp_llm: [], mitre_atlas: [],
    finding_class: "attack", group_id: "g1",
  },
  path_graph: {
    nodes: ["input", "planner", "crm"].map((id) => ({
      id, label: id, type: id === "input" ? "input" : id === "planner" ? "agent" : "data_asset",
      risk_score: 9.1, risk_level: "critical", finding_ids: ["f1"], properties: {}, badges: [],
    })),
    edges: [
      { id: "e1", source: "input", target: "planner", label: "", capability: "read", risk_level: "critical", blocked: false, mitigated: false, detected: false, finding_ids: ["f1"] },
      { id: "e3", source: "planner", target: "crm", label: "", capability: "read", risk_level: "critical", blocked: false, mitigated: false, detected: false, finding_ids: ["f1"] },
    ],
  },
};

const f2Detail: FindingDetailResponse = {
  finding: { ...f1Detail.finding, id: "f2", path: ["input", "planner", "logs"], edges: ["e1", "e4"] },
  path_graph: {
    nodes: f1Detail.path_graph.nodes.map((n) => (n.id === "crm" ? { ...n, id: "logs", label: "logs" } : n)),
    edges: [
      f1Detail.path_graph.edges[0]!,
      { ...f1Detail.path_graph.edges[1]!, id: "e4", target: "logs" },
    ],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await act(async () => {});
}

function isolate() {
  act(() => canvas.props?.onToggleIsolated?.());
}

describe("CapabilityGraph — isolated finding", () => {
  it("draws the whole graph until the finding is isolated", () => {
    render({ selectedFindingId: "f1" });

    expect(canvas.props?.nodes).toHaveLength(nodes.length);
    expect(canvas.props?.isolated).toBe(false);
    expect(getFindingMock).not.toHaveBeenCalled();
  });

  it("fetches the finding's subgraph and draws only its nodes and edges", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });

    isolate();
    expect(canvas.props?.isolating).toBe(true);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);
    await settle();

    expect(getFindingMock).toHaveBeenCalledWith("a1", "f1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(canvas.props?.isolated).toBe(true);
    expect(canvas.props?.isolating).toBe(false);
    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "crm"]);
    expect(canvas.props?.edges.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(canvas.props?.attacks).toEqual([]);
    expect(canvas.props?.highlight).toMatchObject({ edgeIds: ["e1", "e3"], label: "FH-001 #1" });
    expect(canvas.props?.labels.isolatedRoute).toBe("Hallazgo aislado");
  });

  it("only lists the isolated finding's controls on its nodes", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    expect(Object.keys(canvas.props?.nodeControls ?? {})).toEqual(["input", "planner", "crm"]);
    expect(Object.keys(canvas.props?.edgeControls ?? {})).toEqual(["e1", "e3"]);
  });

  it("goes back to the whole graph when shown in context, without refetching", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    isolate();
    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);

    isolate();
    await settle();
    expect(canvas.props?.isolated).toBe(true);
    expect(getFindingMock).toHaveBeenCalledOnce();
  });

  it("leaves isolation when the selection is cleared", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    render({ selectedFindingId: null });
    render({ selectedFindingId: "f1" });

    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);
  });

  it("never isolates in the solved view", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    render({ selectedFindingId: "f1", solved: true });

    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);

    render({ selectedFindingId: "f1" });

    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);
  });

  it("leaves isolation and does not refetch when the selected finding is gone", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    render({ selectedFindingId: "f1", findingList: findings.filter((f) => f.id !== "f1") });
    await settle();

    expect(getFindingMock).toHaveBeenCalledOnce();
    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.isolateFailed).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);
  });

  it("hides the primary route card while a finding is isolated", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    const attacks: Attack[] = [{ id: "a1", severity: "critical", score: 10, exposure: 10, width: 3, nodes: ["input", "planner", "crm"], label: "FH-001", dash: false }];
    render({ selectedFindingId: "f1", attacks });
    expect(view.container.textContent).toContain("Ruta crítica principal");

    isolate();
    await settle();

    expect(view.container.textContent).not.toContain("Ruta crítica principal");
  });

  it("drops a slow response for a finding the user has already moved on from", async () => {
    const slowF1 = deferred<FindingDetailResponse>();
    const fastF2 = deferred<FindingDetailResponse>();
    getFindingMock.mockReturnValueOnce(slowF1.promise).mockReturnValueOnce(fastF2.promise);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    render({ selectedFindingId: "f2" });
    await settle();
    const f1Signal = getFindingMock.mock.calls[0]![2]!.signal!;
    expect(f1Signal.aborted).toBe(true);

    fastF2.resolve(f2Detail);
    await settle();
    slowF1.resolve(f1Detail);
    await settle();

    expect(canvas.props?.isolated).toBe(true);
    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "logs"]);
    expect(canvas.props?.highlight).toMatchObject({ edgeIds: ["e1", "e4"], label: "FH-001 #2" });
  });

  it("keeps the previous subgraph on screen, marked as pending, while the next one loads", async () => {
    const f2 = deferred<FindingDetailResponse>();
    getFindingMock.mockResolvedValueOnce(f1Detail).mockReturnValueOnce(f2.promise);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    render({ selectedFindingId: "f2" });
    await settle();

    expect(canvas.props?.isolated).toBe(true);
    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "crm"]);
    expect(canvas.props?.highlight).toMatchObject({ edgeIds: ["e1", "e3"], label: "FH-001 #1" });
    expect(canvas.props?.pendingRoute).toBe("FH-001 #2");

    f2.resolve(f2Detail);
    await settle();

    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "logs"]);
    expect(canvas.props?.highlight).toMatchObject({ edgeIds: ["e1", "e4"], label: "FH-001 #2" });
    expect(canvas.props?.pendingRoute).toBeNull();
  });

  it("refetches after a re-analysis instead of reusing the previous run's subgraph", async () => {
    getFindingMock.mockResolvedValueOnce(f1Detail).mockResolvedValueOnce(f2Detail);
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();
    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "crm"]);

    render({ selectedFindingId: "f1", findingList: [...findings] });
    expect(canvas.props?.isolating).toBe(true);
    await settle();

    expect(getFindingMock).toHaveBeenCalledTimes(2);
    expect(canvas.props?.nodes.map((n) => n.id)).toEqual(["input", "planner", "logs"]);
  });

  it("keeps the whole graph and offers a retry when the subgraph fails to load", async () => {
    getFindingMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(f1Detail);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    expect(canvas.props?.isolateFailed).toBe(true);
    expect(canvas.props?.isolated).toBe(false);
    expect(canvas.props?.nodes).toHaveLength(nodes.length);

    isolate();
    expect(canvas.props?.isolating).toBe(true);
    await settle();

    expect(getFindingMock).toHaveBeenCalledTimes(2);
    expect(canvas.props?.isolated).toBe(true);
    expect(canvas.props?.isolateFailed).toBe(false);
  });

  it("reports a malformed response as a failed load instead of loading forever", async () => {
    getFindingMock.mockResolvedValue({ ...f1Detail, path_graph: null } as unknown as FindingDetailResponse);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render({ selectedFindingId: "f1" });
    isolate();
    await settle();

    expect(canvas.props?.isolating).toBe(false);
    expect(canvas.props?.isolateFailed).toBe(true);
  });
});
