import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PrioritizedFindings from "@/components/threat-model/PrioritizedFindings";
import { findingLabels } from "@/lib/results/findingDisplay";
import { findings, nodes } from "./fixtures";
import { mount, press } from "../test-utils";

let view: ReturnType<typeof mount>;

const labelById = findingLabels(findings);
const nodesById = new Map(nodes.map((n) => [n.id, n]));

beforeEach(() => {
  view = mount();
  view.render(
    <PrioritizedFindings
      findings={findings}
      findingLabelById={labelById}
      nodesById={nodesById}
      selectedFindingId={null}
      onSelectFinding={() => {}}
    />,
  );
});

afterEach(() => view.unmount());

const box = () => view.container.querySelector('[data-testid="prioritized-findings"]') as HTMLElement;
const search = () => box().querySelector("input") as HTMLInputElement;
const matchCount = () => box().querySelector('[data-testid="findings-match-count"]')?.textContent;
const empty = () => box().querySelector('[data-testid="findings-empty"]');
const chip = (severity: string) => box().querySelector(`[data-testid="severity-chip-${severity}"]`) as HTMLElement;

function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PrioritizedFindings search", () => {
  it("lists every pattern and hides the match count while nothing is filtered", () => {
    expect(box().textContent).toContain("FH-001");
    expect(box().textContent).toContain("FH-004");
    expect(box().textContent).toContain("HY-002");
    expect(matchCount()).toBeUndefined();
    expect(empty()).toBeNull();
  });

  it("finds a finding by part of its FH, without typing it whole", () => {
    type("fh-00");
    expect(matchCount()).toBe("3 de 4 hallazgos");
    type("004");
    expect(matchCount()).toBe("1 de 4 hallazgos");
    expect(box().textContent).toContain("FH-004");
    expect(box().textContent).not.toContain("FH-001");
  });

  it("ignores case and accents", () => {
    type("AUDITORIA");
    expect(matchCount()).toBe("1 de 4 hallazgos");
    expect(box().textContent).toContain("HY-002");
  });

  it("opens the repeated causes that match so their numbered occurrences show", () => {
    expect(box().textContent).not.toContain("FH-001 #1");
    type("FH-001");
    expect(matchCount()).toBe("2 de 4 hallazgos");
    expect(box().textContent).toContain("FH-001 #1");
    expect(box().textContent).toContain("FH-001 #2");
  });

  it("keeps the header totals while filtering", () => {
    expect(box().textContent).toContain("4 hallazgos · 3 patrones");
    type("FH-004");
    expect(box().textContent).toContain("4 hallazgos · 3 patrones");
  });

  it("narrows by severity and toggles the filter off", () => {
    press(chip("high"));
    expect(matchCount()).toBe("1 de 4 hallazgos");
    expect(box().textContent).toContain("FH-004");
    expect(box().textContent).not.toContain("HY-002");
    press(chip("high"));
    expect(matchCount()).toBeUndefined();
    expect(box().textContent).toContain("HY-002");
  });

  it("combines the text with the severity", () => {
    press(chip("critical"));
    type("FH-004");
    expect(empty()).not.toBeNull();
  });

  it("groups the severity filters under a label and announces the result count politely", () => {
    expect(box().querySelector('[role="group"][aria-label="Filtrar por severidad"]')).not.toBeNull();
    const live = box().querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("");
    press(chip("low"));
    expect(box().querySelector('[aria-live="polite"]')).toBe(live);
    expect(live?.textContent).toBe("1 de 4 hallazgos");
  });

  it("exposes each severity filter as a checkbox with its state", () => {
    expect(chip("high").getAttribute("role")).toBe("checkbox");
    expect(chip("high").getAttribute("aria-checked")).toBe("false");
    press(chip("high"));
    expect(chip("high").getAttribute("aria-checked")).toBe("true");
  });

  it("leaves out the severity group when only one severity is present", () => {
    view.unmount();
    view = mount();
    const critical = findings.filter((f) => f.severity === "critical");
    view.render(
      <PrioritizedFindings
        findings={critical}
        findingLabelById={labelById}
        nodesById={nodesById}
        selectedFindingId={null}
        onSelectFinding={() => {}}
      />,
    );
    expect(box().querySelector('[role="group"]')).toBeNull();
    expect(chip("critical")).toBeNull();
  });

  it("only offers the severities that exist", () => {
    expect(chip("critical")).not.toBeNull();
    expect(chip("high")).not.toBeNull();
    expect(chip("low")).not.toBeNull();
    expect(chip("medium")).toBeNull();
  });

  it("says nothing matches and offers a way back", () => {
    type("zzzz");
    expect(empty()?.textContent).toContain("Ningún hallazgo coincide con la búsqueda");
    expect(matchCount()).toBe("0 de 4 hallazgos");
    expect(box().textContent).not.toContain("FH-004");

    press(empty()!.querySelector("button")!);
    expect(search().value).toBe("");
    expect(empty()).toBeNull();
    expect(matchCount()).toBeUndefined();
    expect(box().textContent).toContain("FH-004");
  });

  it("clears the severity filter too when going back", () => {
    press(chip("low"));
    expect(matchCount()).toBe("1 de 4 hallazgos");
    type("zzzz");
    press(empty()!.querySelector("button")!);
    expect(matchCount()).toBeUndefined();
    expect(box().textContent).toContain("FH-004");
  });
});

describe("PrioritizedFindings search with a selected finding", () => {
  beforeEach(() => {
    view.unmount();
    view = mount();
    view.render(
      <PrioritizedFindings
        findings={findings}
        findingLabelById={labelById}
        nodesById={nodesById}
        selectedFindingId="f3"
        onSelectFinding={() => {}}
      />,
    );
  });

  const selectedRow = () => box().querySelector('[aria-current="true"]');

  it("keeps the selected finding listed when the search leaves it out", () => {
    type("HY-002");
    expect(matchCount()).toBe("1 de 4 hallazgos");
    expect(selectedRow()?.textContent).toContain("FH-004");
    expect(box().textContent).toContain("HY-002");
    expect(box().textContent).not.toContain("FH-001");
  });

  it("keeps it listed next to the empty state when nothing matches", () => {
    type("zzzz");
    expect(empty()).not.toBeNull();
    expect(selectedRow()?.textContent).toContain("FH-004");
  });
});

describe("PrioritizedFindings match count", () => {
  it("uses the singular when there is a single finding", () => {
    view.unmount();
    view = mount();
    view.render(
      <PrioritizedFindings
        findings={findings.slice(0, 1)}
        findingLabelById={labelById}
        nodesById={nodesById}
        selectedFindingId={null}
        onSelectFinding={() => {}}
      />,
    );
    type("FH-001");
    expect(matchCount()).toBe("1 de 1 hallazgo");
  });
});
