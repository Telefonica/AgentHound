import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import ResultsStep from "@/components/threat-model/ResultsStep";
import type { AnalysisResult } from "@/lib/api/adapters";
import type CapabilityGraph from "@/components/threat-model/CapabilityGraph";
import { mount, press } from "../test-utils";
import { edges, nodes, result } from "./fixtures";

type GraphProps = ComponentProps<typeof CapabilityGraph>;

const graph = vi.hoisted(() => ({ props: null as GraphProps | null }));
vi.mock("next/dynamic", () => ({
  default: () => (props: GraphProps) => {
    graph.props = props;
    return null;
  },
}));

let view: ReturnType<typeof mount>;

beforeEach(() => {
  view = mount();
  graph.props = null;
  view.render(<ResultsStep result={result} />);
});

afterEach(() => view.unmount());

function openAttackGroup() {
  const header = Array.from(view.container.querySelectorAll("[aria-expanded]")).find((el) =>
    el.textContent?.includes("ataque"),
  );
  press(header!);
}

const cards = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>("button[aria-description]"));
const cardFor = (label: string) => cards().find((b) => b.textContent?.includes(label));

describe("ResultsStep — finding cards", () => {
  it("labels duplicate rules with an ordinal and shows each route", () => {
    openAttackGroup();

    const first = cardFor("FH-001 #1")!;
    expect(first.textContent).toContain("Email entrante → Planner → CRM");
    expect(cardFor("FH-001 #2")).toBeDefined();
  });

  it("shows each finding's id next to its label", () => {
    openAttackGroup();

    const texts = Array.from(cardFor("FH-001 #2")!.querySelectorAll("*"), (el) => el.textContent);
    expect(texts).toContain("f2");
  });

  it("selects a card's finding in the graph and toggles it off on a second press", () => {
    openAttackGroup();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    press(cardFor("FH-001 #2")!);
    expect(graph.props?.selectedFindingId).toBe("f2");
    expect(cardFor("FH-001 #2")!.getAttribute("aria-current")).toBe("true");
    expect(scroll).toHaveBeenCalled();

    press(cardFor("FH-001 #2")!);
    expect(graph.props?.selectedFindingId).toBeNull();
    expect(cardFor("FH-001 #2")!.hasAttribute("aria-current")).toBe(false);
  });

  it("moves the selection when another card is pressed", () => {
    openAttackGroup();

    press(cardFor("FH-001 #1")!);
    press(cardFor("FH-004")!);

    expect(graph.props?.selectedFindingId).toBe("f3");
  });

  it("shares one selection with the graph's own list and its clear action", () => {
    openAttackGroup();

    act(() => graph.props?.onSelectFinding("f1"));
    expect(cardFor("FH-001 #1")!.getAttribute("aria-current")).toBe("true");

    act(() => graph.props?.onClearSelection());
    expect(graph.props?.selectedFindingId).toBeNull();
  });

  it("passes the same labels the cards show", () => {
    expect(graph.props?.findingLabelById.get("f2")).toBe("FH-001 #2");
  });
});

describe("ResultsStep — coverage warnings", () => {
  const coverage = () => view.container.querySelector("[data-testid=coverage-warnings]");

  it("shows nothing for the generic format", () => {
    expect(coverage()).toBeNull();
  });

  const warnings: AnalysisResult["warnings"] = [
    { kind: "not_expressible", rules: ["FH-006"], properties: [], message: "No adapter passes it on." },
    {
      kind: "needs_declaration",
      rules: ["FH-017"],
      properties: ["exposure_boundary", "authentication_scope"],
      message: "Declare `exposure_boundary: external` on the agent and ...",
      declare: [[
        { node_type: "agent", property: "exposure_boundary", values: ["external"] },
        { node_type: "tool", role: "reachable", property: "authentication_scope", values: ["elevated"] },
      ]],
    },
    {
      kind: "ignored_property",
      rules: [],
      properties: ["sensitivty"],
      message: "",
      node: "Patients",
      node_type: "data_asset",
      suggestion: "sensitivity",
    },
  ];

  function openCoverage(sourceFramework: string): string {
    view.render(<ResultsStep result={{ ...result, sourceFramework, warnings }} />);
    press(coverage()!.querySelector("[aria-expanded]")!);
    return coverage()!.textContent ?? "";
  }

  it("lists what a framework file's format can't check, translated from the structured fields", () => {
    const text = openCoverage("crewai");

    expect(text).toContain("2 reglas que el formato de este fichero no puede comprobar del todo");
    expect(text).toContain("FH-006");
    expect(text).toContain(
      "Declara exposure_boundary: external en el agente y authentication_scope: elevated en una herramienta que ese agente pueda alcanzar",
    );
    expect(text).toContain("sensitivty en Patients no es una propiedad conocida y se ha ignorado. ¿Querías decir sensitivity?");
    expect(text).not.toContain("Declare `exposure_boundary");
  });

  it("points other frameworks at the node's entry", () => {
    const text = openCoverage("crewai");
    expect(text).toContain("Añádela a la entrada del nodo");
    expect(text).not.toContain("bloque data");
  });

  it("points Dify files at the node's data block", () => {
    expect(openCoverage("dify")).toContain("Añádela al bloque data del nodo");
  });
});

describe("ResultsStep — resolved findings", () => {
  beforeEach(() => {
    view.render(
      <ResultsStep
        result={{
          ...result,
          solution: {
            remediation: [],
            beforeAfter: {
              before: { findingCount: 4, criticalCount: 2, maxScore: 9.1, riskScoreTotal: 27.4 },
              after: { findingCount: 0, criticalCount: 0, maxScore: 0, riskReductionPct: 100 },
            },
            nodes,
            edges,
            attacks: [],
            brokenFindingIds: ["f1", "f2"],
            appliedControlCount: 0,
            nodeControlInfo: {},
            edgeControlInfo: {},
            chokepointRec: null,
          },
        }}
      />,
    );
    press(Array.from(view.container.querySelectorAll("[role=tab]")).find((el) => el.textContent?.includes("Solución"))!);
    press(Array.from(view.container.querySelectorAll("[aria-expanded]")).find((el) => el.textContent?.includes("Resuelto"))!);
  });

  it("tells resolved findings of the same rule apart by label, id and route", () => {
    const texts = Array.from(view.container.querySelectorAll("*"), (el) => el.textContent);

    expect(texts).toEqual(expect.arrayContaining([
      "f1",
      "Email entrante → Planner → CRM",
      "f2",
      "Email entrante → Planner → Logs",
    ]));
    expect(texts).toContain("FH-001 #2");
  });

  it("lists only the findings the simulation broke", () => {
    const resolved = Array.from(view.container.querySelectorAll("[data-testid=resolved-finding]"), (el) => el.textContent);

    expect(resolved).toHaveLength(2);
    expect(resolved.join()).not.toMatch(/f3|f4/);
  });

  it("hands the solved graph only the findings still open", () => {
    expect(graph.props?.findings.map((f) => f.id)).toEqual(["f3", "f4"]);
  });
});
