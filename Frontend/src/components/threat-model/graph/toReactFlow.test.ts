import { describe, expect, it } from "vitest";

import { buildGraph, findingRoute, nodeFindingId, nodeFindingMarks, playbackFrame, primaryRoute, primaryRouteId } from "./toReactFlow";
import type { Attack, Finding, GraphEdge, GraphNode } from "@/types/ThreatModel";

const edges: GraphEdge[] = [
  { id: "e1", f: "a", t: "b" },
  { id: "e2", f: "a", t: "b" },
  { id: "e3", f: "b", t: "c" },
  { id: "e4", f: "c", t: "d" },
];

describe("findingRoute", () => {
  it("uses the finding's own edge ids, including every parallel edge of a hop", () => {
    expect(findingRoute({ path: ["a", "b", "c"], edges: ["e1", "e2", "e3"] }, edges)).toEqual({
      nodeIds: ["a", "b", "c"],
      edgeIds: ["e1", "e2", "e3"],
    });
  });

  it("drops edge ids that are not in the rendered graph", () => {
    expect(findingRoute({ path: ["b", "c"], edges: ["gone", "e3"] }, edges).edgeIds).toEqual(["e3"]);
  });

  it("falls back to path pairs in either direction when edges are missing", () => {
    expect(findingRoute({ path: ["c", "b"] }, edges).edgeIds).toEqual(["e3"]);
    expect(findingRoute({ path: ["a", "b"], edges: [] }, edges).edgeIds).toEqual(["e1", "e2"]);
  });

  it("includes edge endpoints missing from a display-ordered path", () => {
    expect(findingRoute({ path: ["b"], edges: ["e3", "e4"] }, edges).nodeIds).toEqual(["b", "c", "d"]);
  });
});

describe("playbackFrame", () => {
  const rfEdges = edges.map((e) => ({ id: e.id, source: e.f, target: e.t }));
  const frame = (route: { nodeIds: string[]; edgeIds: string[] }, step: number) => {
    const f = playbackFrame(route, step, rfEdges);
    return { currentNode: f.currentNode, liveNodes: [...f.liveNodes], currentEdges: [...f.currentEdges], liveEdges: [...f.liveEdges] };
  };

  it("starts on the first node with no edge lit", () => {
    expect(frame({ nodeIds: ["a", "b", "c"], edgeIds: ["e1", "e3"] }, 0)).toEqual({
      currentNode: "a",
      liveNodes: ["a"],
      currentEdges: [],
      liveEdges: [],
    });
  });

  it("lights the hop into the current node and keeps earlier hops live", () => {
    expect(frame({ nodeIds: ["a", "b", "c"], edgeIds: ["e1", "e3"] }, 2)).toEqual({
      currentNode: "c",
      liveNodes: ["a", "b", "c"],
      currentEdges: ["e3"],
      liveEdges: ["e1", "e3"],
    });
  });

  it("only lights the parallel edge that belongs to the route", () => {
    expect(frame({ nodeIds: ["a", "b"], edgeIds: ["e2"] }, 1).liveEdges).toEqual(["e2"]);
  });

  it("follows a route whose edges are listed out of path order", () => {
    expect(frame({ nodeIds: ["b", "c", "d"], edgeIds: ["e4", "e3"] }, 1)).toMatchObject({
      currentEdges: ["e3"],
      liveEdges: ["e3"],
    });
  });
});

describe("primaryRoute", () => {
  const attack = (id: string, overrides: Partial<Attack> = {}): Attack => ({
    id,
    severity: "critical",
    score: 10,
    exposure: 20,
    width: 2.5,
    nodes: ["a", "b", "c"],
    label: id.toUpperCase(),
    dash: false,
    ...overrides,
  });

  it("prefers the higher severity, then the higher score", () => {
    expect(primaryRouteId([attack("a1", { severity: "high", exposure: 99 }), attack("a2")])).toBe("A2");
    expect(primaryRouteId([attack("a1", { score: 9.6, exposure: 99 }), attack("a2")])).toBe("A2");
  });

  it("breaks a severity and score tie by the route that concentrates the most risk", () => {
    const attacks = [attack("a1"), attack("a2", { exposure: 33.6, nodes: ["a", "b", "d"] })];
    expect(primaryRoute(attacks)).toEqual({ label: "A2", nodeIds: ["a", "b", "d"] });
  });

  it("then prefers the most direct route", () => {
    expect(primaryRouteId([attack("a1"), attack("a2", { nodes: ["a", "c"] })])).toBe("A2");
  });

  it("falls back to the finding id in numeric order on a full tie", () => {
    expect(primaryRouteId([attack("finding_10"), attack("finding_9")])).toBe("FINDING_9");
  });

  it("does not depend on the order the attacks come in", () => {
    const attacks = [attack("a1"), attack("a2", { exposure: 33.6 }), attack("a3", { nodes: ["a", "c"] })];
    expect(primaryRouteId(attacks)).toBe("A2");
    expect(primaryRouteId([...attacks].reverse())).toBe("A2");
  });

  it("returns nothing without attacks", () => {
    expect(primaryRouteId([])).toBe("");
    expect(primaryRoute([])).toBeNull();
  });

  it("paints and plays the chosen route in the graph", () => {
    const routeEdges: GraphEdge[] = [
      { id: "ab", f: "a", t: "b" },
      { id: "bc", f: "b", t: "c" },
      { id: "bd", f: "b", t: "d" },
    ];
    const attacks = [attack("a1"), attack("a2", { exposure: 33.6, nodes: ["a", "b", "d"] })];
    const built = buildGraph([], routeEdges, attacks, false);
    expect(built.attackEdgeIds).toEqual(["ab", "bd"]);
    expect(built.edges.filter((e) => e.data?.variant === "danger").map((e) => [e.id, e.data?.pathLabel])).toEqual([
      ["ab", "A2"],
      ["bd", "A2"],
    ]);
  });
});

describe("nodeFindingId", () => {
  it("returns the node a finding without hops sits on", () => {
    expect(nodeFindingId({ path: ["c"], edges: [] }, edges)).toBe("c");
    expect(nodeFindingId({ path: ["c", "c"], edges: undefined }, edges)).toBe("c");
  });

  it("keeps the node when the finding's edges are not in the graph", () => {
    expect(nodeFindingId({ path: ["c"], edges: ["gone"] }, edges)).toBe("c");
  });

  it("returns nothing for a route or an empty path", () => {
    expect(nodeFindingId({ path: ["a", "b"], edges: ["e1"] }, edges)).toBeUndefined();
    expect(nodeFindingId({ path: ["a", "c"], edges: ["gone"] }, edges)).toBeUndefined();
    expect(nodeFindingId({ path: [], edges: [] }, edges)).toBeUndefined();
  });

  it("returns nothing for a single node reached through one of the graph's edges", () => {
    expect(nodeFindingId({ path: ["c"], edges: ["e3"] }, edges)).toBeUndefined();
  });
});

describe("nodeFindingMarks", () => {
  type NodeFinding = Pick<Finding, "path" | "edges" | "severity" | "score">;
  const finding = (path: string[], overrides: Partial<NodeFinding> = {}): NodeFinding => ({
    path,
    edges: [],
    severity: "high",
    score: 8,
    ...overrides,
  });

  it("marks the node a finding without hops points at", () => {
    expect(nodeFindingMarks([finding(["c"], { severity: "critical", score: 9.8 })], edges)).toEqual(
      new Map([["c", { severity: "critical", score: 9.8, count: 1 }]]),
    );
  });

  it("leaves route findings to their edges", () => {
    expect(nodeFindingMarks([finding(["a", "b"], { edges: ["e1"] }), finding(["b", "c"], { edges: undefined })], edges).size).toBe(0);
  });

  it("marks a finding whose edges are not in the rendered graph", () => {
    expect([...nodeFindingMarks([finding(["c"], { edges: ["gone"] })], edges).keys()]).toEqual(["c"]);
  });

  it("leaves unmarked a route whose hops are missing from the graph", () => {
    expect(nodeFindingMarks([finding(["a", "c"], { edges: ["gone"] })], edges).size).toBe(0);
  });

  it("keeps the worst severity and score and counts every finding on a node", () => {
    const marks = nodeFindingMarks(
      [
        finding(["c"], { severity: "medium", score: 9 }),
        finding(["c"], { severity: "critical", score: 7 }),
        finding(["c", "c"], { severity: "none", score: 1 }),
      ],
      edges,
    );
    expect(marks.get("c")).toEqual({ severity: "critical", score: 9, count: 3 });
    expect(nodeFindingMarks([finding(["c"], { severity: "none" })], edges).get("c")?.severity).toBe("none");
  });
});

describe("buildGraph node findings", () => {
  const nodes: GraphNode[] = ["a", "b", "c"].map((id) => ({ id, type: "tool", label: id, x: 0, y: 0 }));
  const findings: Pick<Finding, "path" | "edges" | "severity" | "score">[] = [
    { path: ["c"], edges: [], severity: "critical", score: 9.8 },
    { path: ["a", "b"], edges: ["e1"], severity: "high", score: 8.8 },
  ];
  const marks = (solved: boolean) =>
    buildGraph(nodes, edges, [], solved, {}, {}, "", undefined, findings).nodes.map((n) => [n.id, n.data.findingMark]);

  it("puts node findings on their node in the findings view", () => {
    expect(marks(false)).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["c", { severity: "critical", score: 9.8, count: 1 }],
    ]);
  });

  it("drops them in the solution view", () => {
    expect(marks(true).every(([, mark]) => mark === undefined)).toBe(true);
  });
});

describe("buildGraph nodes", () => {
  it("does not draw control nodes", () => {
    const nodes: GraphNode[] = [
      { id: "a", type: "agent", label: "a", x: 0, y: 0 },
      { id: "k", type: "control", label: "k", x: 0, y: 0 },
      { id: "b", type: "tool", label: "b", x: 0, y: 0 },
    ];
    expect(buildGraph(nodes, [], [], false).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
