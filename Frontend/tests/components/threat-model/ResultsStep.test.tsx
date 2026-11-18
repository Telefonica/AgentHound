import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import ResultsStep from "@/components/threat-model/ResultsStep";
import type { AnalysisResult } from "@/lib/api/adapters";
import type CapabilityGraph from "@/components/threat-model/CapabilityGraph";
import { mount, press } from "../test-utils";
import { edges, findings, nodes, result } from "./fixtures";

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

const toggles = () => Array.from(view.container.querySelectorAll<HTMLElement>("[aria-expanded]"));
const attackHeader = () => toggles().find((el) => el.textContent?.includes("ataque"))!;
const occurrencesToggle = () => toggles().find((el) => el.textContent?.includes("ocurrencias"))!;
const pattern = () => view.container.querySelector("[data-testid=finding-pattern]");

function openAttackGroup() {
  press(attackHeader());
  press(occurrencesToggle());
}

const cards = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>("[data-testid=finding-card]"));
const cardFor = (label: string) => cards().find((b) => b.textContent?.includes(label));

describe("ResultsStep — finding patterns", () => {
  beforeEach(() => press(attackHeader()));

  it("counts causes, not occurrences, in the group header", () => {
    expect(attackHeader().textContent).toContain("2 causas");
  });

  it("folds the occurrences of one cause into a single card", () => {
    expect(pattern()!.textContent).toContain("2 hallazgos");
    expect(pattern()!.textContent).toContain("Datos sensibles alcanzables desde entrada no confiable desde Email entrante");
    expect(cardFor("FH-001 #1")).toBeUndefined();
    expect(cardFor("FH-004")).toBeDefined();
  });

  it("lists every occurrence with its own label once expanded, and folds them back", () => {
    press(occurrencesToggle());
    expect(occurrencesToggle().getAttribute("aria-expanded")).toBe("true");
    expect(cardFor("FH-001 #1")).toBeDefined();
    expect(cardFor("FH-001 #2")).toBeDefined();

    press(occurrencesToggle());
    expect(cardFor("FH-001 #1")).toBeUndefined();
  });

  it("leaves the cause's title to the pattern card, not to each occurrence", () => {
    press(occurrencesToggle());

    expect(cardFor("FH-001 #1")!.textContent).not.toContain("Datos sensibles alcanzables");
    expect(cardFor("FH-004")!.textContent).toContain("Escritura en logs");
  });

  it("only points at the occurrences while they are in the page", () => {
    expect(occurrencesToggle().hasAttribute("aria-controls")).toBe(false);

    press(occurrencesToggle());
    const id = occurrencesToggle().getAttribute("aria-controls");
    expect(id && view.container.querySelector(`[id="${id}"]`)).toBeTruthy();
  });

  it("unfolds a cause when the graph selects one of its occurrences", () => {
    act(() => graph.props?.onSelectFinding("f2"));

    expect(occurrencesToggle().getAttribute("aria-expanded")).toBe("true");
    expect(occurrencesToggle().hasAttribute("aria-description")).toBe(false);
    expect(cardFor("FH-001 #2")!.getAttribute("aria-current")).toBe("true");
  });

  it("lets the user fold a cause back and marks that it holds the selection", () => {
    act(() => graph.props?.onSelectFinding("f2"));
    press(occurrencesToggle());

    expect(cardFor("FH-001 #2")).toBeUndefined();
    expect(occurrencesToggle().getAttribute("aria-description")).toBe("Contiene el hallazgo seleccionado");
  });

  it("leaves a cause folded when the selection lands elsewhere", () => {
    act(() => graph.props?.onSelectFinding("f3"));

    expect(occurrencesToggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ResultsStep — a cause with many occurrences", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...findings[0]!, id: `o${i + 1}` }));
  const moreToggle = () => toggles().find((el) => el.textContent?.includes("más") || el.textContent?.includes("primeras"))!;

  beforeEach(() => {
    view.render(<ResultsStep result={{ ...result, findings: many }} />);
    press(attackHeader());
  });

  it("caps the unfolded occurrences and shows the rest on demand", () => {
    press(occurrencesToggle());
    expect(cards()).toHaveLength(10);
    expect(moreToggle().textContent).toBe("Ver 2 más");

    press(moreToggle());
    expect(cards()).toHaveLength(12);

    press(moreToggle());
    expect(cards()).toHaveLength(10);
    expect(moreToggle().textContent).toBe("Ver 2 más");
  });

  it("names the collapse after occurrences, not groups", () => {
    press(occurrencesToggle());
    press(moreToggle());

    expect(moreToggle().textContent).toBe("Ver solo las 10 primeras");
  });

  it("keeps a selected occurrence past the cap visible", () => {
    act(() => graph.props?.onSelectFinding("o12"));

    expect(cards()).toHaveLength(11);
    expect(cardFor("FH-001 #12")!.getAttribute("aria-current")).toBe("true");
    expect(moreToggle().textContent).toBe("Ver 1 más");
  });
});

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
              after: { findingCount: 0, criticalCount: 0, maxScore: 0, riskReductionPct: 100, riskReductionByGroupPct: 80 },
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

  it("shows the risk reduction with each cause counted once", () => {
    const rows = Array.from(view.container.querySelectorAll("[data-testid=metric-row]"), (el) => el.textContent);

    expect(rows).toContain("Reducción por causa-80%");
  });

  it("shows both risk reductions together as rows", () => {
    const after = Array.from(view.container.querySelectorAll("[data-testid=before-after-card]"))[1]!;
    const rows = Array.from(after.querySelectorAll("[data-testid=metric-row]"), (el) => el.textContent);

    expect(rows.slice(-2)).toEqual(["Reducción por hallazgo-100%", "Reducción por causa-80%"]);
  });

  it("counts causes on both sides so the rows line up", () => {
    const [before, after] = Array.from(view.container.querySelectorAll("[data-testid=before-after-card]"), (card) =>
      Array.from(card.querySelectorAll("[data-testid=metric-row]"), (el) => el.textContent),
    );

    expect(before!.slice(0, 2)).toEqual(["Hallazgos4", "Causas3"]);
    expect(after!.slice(0, 2)).toEqual(["Hallazgos0", "Causas2"]);
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
