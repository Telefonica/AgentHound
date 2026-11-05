import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WizardStepper from "@/components/threat-model/WizardStepper";
import { mount } from "../test-utils";

const LABELS = ["Configuración", "Análisis", "Capacidades", "Resultados"];

let view: ReturnType<typeof mount>;

beforeEach(() => {
  view = mount();
});

afterEach(() => {
  view.unmount();
});

function renderAt(currentStep: number) {
  view.render(<WizardStepper steps={LABELS} currentStep={currentStep} aria-label="Progreso" />);
  const items = Array.from(view.container.querySelectorAll("li:not([aria-hidden])"));
  return items;
}

describe("WizardStepper", () => {
  it("renders every step name and exposes the list label", () => {
    const items = renderAt(1);
    expect(view.container.querySelector("ol")?.getAttribute("aria-label")).toBe("Progreso");
    expect(items.map((li) => li.textContent)).toEqual([
      "1Configuración",
      "2Análisis",
      "3Capacidades",
      "4Resultados",
    ]);
  });

  it("marks only the current step with aria-current", () => {
    const items = renderAt(2);
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
  });

  it("shows a check instead of the number for completed steps", () => {
    const items = renderAt(3);
    // Steps 1 and 2 are done: no number, an icon instead.
    expect(items[0]?.textContent).toBe("Configuración");
    expect(items[0]?.querySelector("svg")).not.toBeNull();
    expect(items[1]?.textContent).toBe("Análisis");
    // Current and upcoming steps keep their number and have no icon.
    expect(items[2]?.textContent).toBe("3Capacidades");
    expect(items[2]?.querySelector("svg")).toBeNull();
    expect(items[3]?.textContent).toBe("4Resultados");
  });

  it("draws one connector between each pair of steps", () => {
    renderAt(1);
    expect(view.container.querySelectorAll('li[aria-hidden="true"]').length).toBe(LABELS.length - 1);
  });
});
