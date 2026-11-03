import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CapabilityGraph from "@/components/threat-model/CapabilityGraph";
import type { CyberGraphProps } from "@/components/threat-model/graph/CyberGraph";
import { getFinding } from "@/lib/api/agentHound";
import type { FindingDetailResponse } from "@/lib/api/types";
import type { Attack, Finding } from "@/types/ThreatModel";
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

const byTestId = (id: string) => Array.from(view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
const rows = () => byTestId("prioritized-finding");
const rowFor = (label: string) => rows().find((b) => new RegExp(`^${label}(?!\\d| #)`).test(b.textContent ?? ""));
const groupFor = (ruleId: string) => byTestId("prioritized-finding-group").find((b) => b.textContent?.startsWith(ruleId));
const box = () => byTestId("prioritized-findings")[0]!;
const buttonNamed = (text: string) => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === text);

function renderList(list: Finding[], selectedFindingId: string | null = null) {
  view.render(
    <CapabilityGraph
      analysisId="a1"
      solved={false}
      nodes={nodes}
      edges={edges}
      findings={list}
      attacks={[]}
      findingLabelById={findingLabels(list)}
      selectedFindingId={selectedFindingId}
      onSelectFinding={onSelectFinding}
      onClearSelection={onClearSelection}
    />,
  );
}

function manyGroups(count: number): Finding[] {
  return Array.from({ length: count }, (_, i) => ({
    ...findings[2]!,
    id: `m${i}`,
    ruleId: `FH-${String(100 + i)}`,
    groupId: `mg${i}`,
    score: 9 - i * 0.1,
  }));
}

describe("CapabilityGraph — prioritized findings", () => {
  it("collapses the occurrences of one root cause into a single row with their count", () => {
    render();

    expect(groupFor("FH-001")!.textContent).toContain("2 hallazgos");
    expect(groupFor("FH-001")!.getAttribute("aria-expanded")).toBe("false");
    expect(rowFor("FH-001 #1")).toBeUndefined();
    expect(rows().map((b) => b.textContent?.split("Escritura")[0])).toEqual(["FH-004"]);
  });

  it("names the entry point a pattern's routes share, so patterns of one rule tell apart", () => {
    render();

    expect(groupFor("FH-001")!.textContent).toBe(
      "FH-001Datos sensibles alcanzables desde entrada no confiable desde Email entrante · puntuación 9.12 hallazgos",
    );
  });

  it("names no node for a rule-wide pattern", () => {
    const perNode = [
      { ...findings[3]!, id: "h1", path: ["planner"], groupId: "hy" },
      { ...findings[3]!, id: "h2", path: ["planner"], groupId: "hy" },
    ];
    render({ findingList: perNode });

    expect(groupFor("HY-002")!.textContent).toBe("HY-002Sin auditoría · puntuación 22 hallazgos");
  });

  it("names the node a pattern sits in when it is not an entry point", () => {
    const perTool = [
      { ...findings[2]!, id: "t1", groupId: "gt", groupAnchor: "planner" },
      { ...findings[2]!, id: "t2", groupId: "gt", groupAnchor: "planner" },
    ];
    render({ findingList: perTool });

    expect(groupFor("FH-004")!.textContent).toBe("FH-004Escritura en logs en Planner · puntuación 7.22 hallazgos");
  });

  it("names the node of single-occurrence patterns too, so patterns of one rule tell apart", () => {
    const perNode = [
      { ...findings[2]!, id: "s1", groupId: "gs1", groupAnchor: "planner" },
      { ...findings[2]!, id: "s2", groupId: "gs2", groupAnchor: "input" },
    ];
    renderList(perNode);

    expect(rows().map((b) => b.textContent)).toEqual([
      "FH-004 #1Escritura en logs en Planner · puntuación 7.2",
      "FH-004 #2Escritura en logs desde Email entrante · puntuación 7.2",
    ]);
  });

  it("states how many findings and patterns the box covers instead of counting rows in the title", () => {
    render();

    expect(box().textContent).toContain("Hallazgos priorizados4 hallazgos · 3 patrones");
  });

  it("lists a group's occurrences, numbered and with their route, when it is expanded", () => {
    render();

    press(groupFor("FH-001")!);

    expect(groupFor("FH-001")!.getAttribute("aria-expanded")).toBe("true");
    expect(rows().map((b) => b.textContent)).toEqual([
      "FH-001 #1Email entrante → Planner → CRM · puntuación 9.1",
      "FH-001 #2Email entrante → Planner → Logs · puntuación 9.1",
      "FH-004Escritura en logs · puntuación 7.2",
    ]);

    press(groupFor("FH-001")!);

    expect(rowFor("FH-001 #1")).toBeUndefined();
  });

  it("selects an occurrence when its row is pressed", () => {
    render();
    press(groupFor("FH-001")!);

    press(rowFor("FH-001 #2")!);

    expect(onSelectFinding).toHaveBeenCalledWith("f2");
  });

  it("does not select anything when a group is expanded", () => {
    render();

    press(groupFor("FH-001")!);

    expect(onSelectFinding).not.toHaveBeenCalled();
  });

  it("does not offer a route for findings without a path", () => {
    render();

    expect(view.container.textContent).toContain("HY-002");
    expect(rowFor("HY-002")).toBeUndefined();
  });

  it("marks only the selected row as current", () => {
    render({ selectedFindingId: "f1" });
    press(groupFor("FH-001")!);

    expect(rowFor("FH-001 #1")!.getAttribute("aria-current")).toBe("true");
    expect(rowFor("FH-001 #2")!.hasAttribute("aria-current")).toBe(false);
  });

  it("flags a collapsed group that holds the selected finding", () => {
    render({ selectedFindingId: "f2" });

    expect(groupFor("FH-001")!.getAttribute("aria-description")).toBe("Contiene el hallazgo seleccionado");

    render({ selectedFindingId: "f3" });

    expect(groupFor("FH-001")!.hasAttribute("aria-description")).toBe(false);
  });

  it("shows the first occurrences of a large pattern and the rest on demand", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...findings[1]!, id: `o${i}` }));
    renderList(many);

    press(groupFor("FH-001")!);

    expect(rows()).toHaveLength(10);

    press(buttonNamed("Ver 4 más")!);

    expect(rows()).toHaveLength(14);

    press(buttonNamed("Ver solo los 10 primeros")!);

    expect(rows()).toHaveLength(10);
  });

  it("keeps a selected occurrence past the cap visible", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...findings[1]!, id: `o${i}` }));
    renderList(many, "o12");

    press(groupFor("FH-001")!);

    expect(rows()).toHaveLength(11);
    expect(rows().at(-1)!.getAttribute("aria-current")).toBe("true");
    expect(buttonNamed("Ver 3 más")).toBeDefined();
  });

  it("keeps the pattern holding the selection visible past the top five", () => {
    renderList(manyGroups(8), "m7");

    expect(rows().map((b) => b.textContent?.slice(0, 6))).toEqual(["FH-100", "FH-101", "FH-102", "FH-103", "FH-104", "FH-107"]);
  });

  it("shows only the top five patterns and lets the rest be shown and hidden again", () => {
    renderList(manyGroups(12));

    expect(rows().map((b) => b.textContent?.slice(0, 6))).toEqual(["FH-100", "FH-101", "FH-102", "FH-103", "FH-104"]);
    expect(box().textContent).toContain("12 hallazgos · 12 patrones");

    press(buttonNamed("Ver los 12 patrones")!);

    expect(rows()).toHaveLength(12);
    expect(buttonNamed("Ver solo los 5 primeros")!.getAttribute("aria-expanded")).toBe("true");

    press(buttonNamed("Ver solo los 5 primeros")!);

    expect(rows()).toHaveLength(5);
  });

  it("offers no show-all action when every pattern already fits", () => {
    render();

    expect(buttonNamed("Ver los 3 patrones")).toBeUndefined();
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

  it("hands the canvas every finding, then only the isolated one", async () => {
    getFindingMock.mockResolvedValue(f1Detail);
    render({ selectedFindingId: "f1" });
    expect(canvas.props?.findings).toBe(findings);

    isolate();
    await settle();
    expect(canvas.props?.findings?.map((f) => f.id)).toEqual(["f1"]);
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
