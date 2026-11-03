import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFindingCorner } from "@/components/threat-model/graph/nodeTypes";
import { mount } from "../test-utils";

let view: ReturnType<typeof mount>;

beforeEach(() => {
  view = mount();
});

afterEach(() => view.unmount());

const badge = () => view.container.querySelector('[data-testid="node-finding-badge"]');

describe("NodeFindingCorner", () => {
  it("shows only the score for a single finding", () => {
    view.render(<NodeFindingCorner mark={{ severity: "high", score: 7.6, count: 1 }} />);
    expect(badge()?.textContent).toBe("7,6");
    expect(badge()?.getAttribute("data-severity")).toBe("high");
  });

  it("adds how many more findings sit on the node", () => {
    view.render(<NodeFindingCorner mark={{ severity: "critical", score: 9.8, count: 3 }} />);
    expect(badge()?.textContent).toBe("9,8 · +2");
  });

  it("reads the full sentence to screen readers instead of the compact label", () => {
    view.render(<NodeFindingCorner mark={{ severity: "critical", score: 9.8, count: 3 }} />);
    const sentence = "3 hallazgos en este nodo · máx. 9,8";
    expect(badge()?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(view.container.querySelector(`[title="${sentence}"]`)).not.toBeNull();
    const spoken = Array.from(view.container.querySelectorAll("span"), (el) => el.textContent);
    expect(spoken).toContain(sentence);
  });
});
