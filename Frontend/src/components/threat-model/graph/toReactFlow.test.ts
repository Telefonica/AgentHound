import { describe, expect, it } from "vitest";

import { buildGraph, findingRoute, playbackFrame, primaryRoute, primaryRouteId } from "./toReactFlow";
import type { Attack, GraphEdge } from "@/types/ThreatModel";

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
