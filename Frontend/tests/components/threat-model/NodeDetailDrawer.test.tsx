import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NodeDetailDrawer from "@/components/threat-model/NodeDetailDrawer";
import { nodeFindingMarks } from "@/components/threat-model/graph/toReactFlow";
import { findingLabels } from "@/lib/results/findingDisplay";
import type { Finding } from "@/types/ThreatModel";
import { mount, press } from "../test-utils";
import { edges, findings as baseFindings, nodes } from "./fixtures";

const nodesById = new Map(nodes.map((n) => [n.id, n]));
let view: ReturnType<typeof mount>;

const onNode = (over: Partial<Finding> & Pick<Finding, "id" | "ruleId">): Finding => ({
  severity: "medium",
  category: "missing_control",
  title: "Agente sin límite de iteraciones",
  desc: "",
  path: ["planner"],
  edges: [],
  score: 4.8,
  findingClass: "attack",
  groupId: `g-${over.id}`,
  ...over,
});

const findings: Finding[] = [
  ...baseFindings,
  onNode({ id: "n1", ruleId: "FH-021" }),
  onNode({ id: "n2", ruleId: "FH-022", severity: "high", score: 7.4, title: "Agente sin aprobación" }),
];

function open(list: Finding[] = findings, onShowRoute?: (findingId: string) => void) {
  view = mount();
  view.render(
    <NodeDetailDrawer
      node={nodesById.get("planner")!}
      findings={list}
      findingLabelById={findingLabels(list)}
      nodesById={nodesById}
      edges={edges}
      onClose={() => {}}
      onShowRoute={onShowRoute}
    />,
  );
}

afterEach(() => view.unmount());

const body = () => document.body;
const texts = () => Array.from(body().querySelectorAll("*"), (el) => el.textContent);
const section = (id: string) => body().querySelector(`[data-testid="${id}"]`);
const ids = (id: string) => Array.from(section(id)?.querySelectorAll('[data-testid="node-finding"]') ?? [], (el) => el.textContent ?? "");

describe("NodeDetailDrawer — findings through the node", () => {
  beforeEach(() => open());

  it("tells findings of the same rule apart by label, id and route", () => {
    expect(texts()).toEqual(expect.arrayContaining([
      "FH-001 #1",
      "f1",
      "Email entrante → Planner → CRM",
      "FH-001 #2",
      "f2",
      "Email entrante → Planner → Logs",
    ]));
  });

  it("lists only findings whose path crosses the node", () => {
    expect(texts()).not.toContain("f4");
  });
});

describe("NodeDetailDrawer — the node's own findings", () => {
  beforeEach(() => open());

  it("separates the findings that sit on the node from the routes that pass through it", () => {
    expect(section("node-own-findings")?.textContent).toContain("Hallazgos en este nodo");
    expect(ids("node-own-findings")).toHaveLength(2);
    expect(ids("node-through-findings")).toHaveLength(3);
    expect(section("node-through-findings")?.textContent).toContain("Rutas de ataque a través de este nodo");
  });

  it("never lists a finding in both sections", () => {
    const own = ids("node-own-findings").join("|");
    const through = ids("node-through-findings").join("|");
    expect(own).toContain("FH-021");
    expect(own).toContain("FH-022");
    expect(through).not.toContain("FH-021");
    expect(through).toContain("FH-001");
  });

  it("orders each section by severity, then score", () => {
    const own = ids("node-own-findings");
    expect(own[0]).toContain("FH-022");
    expect(own[1]).toContain("FH-021");
    const through = ids("node-through-findings");
    expect(through[0]).toContain("FH-001");
    expect(through[2]).toContain("FH-004");
  });

  it("shows how many findings each section holds", () => {
    const count = (id: string) => section(id)?.querySelector('[data-testid="node-findings-count"]')?.textContent;
    expect(count("node-own-findings")).toBe("2");
    expect(count("node-through-findings")).toBe("3");
  });

  it("leaves out the route of the node's own findings, which is the node itself", () => {
    expect(ids("node-own-findings").join("|")).not.toContain("Planner");
    expect(ids("node-through-findings")[0]).toContain("Email entrante → Planner → CRM");
  });

  it("lists as its own the same findings the node mark counts", () => {
    expect(ids("node-own-findings")).toHaveLength(nodeFindingMarks(findings, edges).get("planner")!.count);
  });
});

describe("NodeDetailDrawer — route link", () => {
  const link = (id: string, label: string) => section(id)?.querySelector(`[aria-label="Mostrar la ruta ${label} en el grafo"]`);

  it("asks to show the route of a finding from either section", () => {
    const onShowRoute = vi.fn();
    open(findings, onShowRoute);
    press(link("node-through-findings", "FH-004")!);
    press(link("node-own-findings", "FH-022")!);
    expect(onShowRoute.mock.calls).toEqual([["f3"], ["n2"]]);
  });

  it("shows the label as a plain tag when routes cannot be shown", () => {
    open();
    expect(body().querySelector('[aria-label^="Mostrar la ruta"]')).toBeNull();
    expect(ids("node-own-findings")[0]).toContain("FH-022");
  });
});

describe("NodeDetailDrawer — without own findings", () => {
  it("shows only the routes through the node", () => {
    open(baseFindings.filter((f) => f.severity === "critical"));
    expect(section("node-own-findings")).toBeNull();
    expect(ids("node-through-findings")).toHaveLength(2);
  });
});
