import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFindingCorner } from "@/components/threat-model/graph/nodeTypes";
import { mount } from "../test-utils";

let view: ReturnType<typeof mount>;

beforeEach(() => {
  view = mount();
});

afterEach(() => view.unmount());

const count = () => view.container.querySelector('[data-testid="node-finding-count"]');
const badge = () => view.container.querySelector('[data-testid="node-finding-badge"]');

describe("NodeFindingCorner", () => {
  it("shows only the score for a single finding", () => {
    view.render(<NodeFindingCorner mark={{ severity: "high", score: 7.6, count: 1 }} />);
    expect(badge()?.textContent).toBe("7,6");
    expect(badge()?.getAttribute("data-severity")).toBe("high");
  });

  it("adds how many findings sit on the node as a separate, neutral tag", () => {
    view.render(<NodeFindingCorner mark={{ severity: "critical", score: 9.8, count: 3 }} />);
    expect(badge()?.textContent).toBe("9,8");
    expect(count()?.textContent).toBe("3 hallazgos");
    expect(count()?.getAttribute("data-severity")).toBeNull();
  });

  it("shows no count for a single finding", () => {
    view.render(<NodeFindingCorner mark={{ severity: "high", score: 7.6, count: 1 }} />);
    expect(count()).toBeNull();
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
