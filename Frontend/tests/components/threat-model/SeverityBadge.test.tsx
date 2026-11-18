import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import { mount } from "../test-utils";

const LABEL = "Crítico";
let view: ReturnType<typeof mount>;

beforeEach(() => {
  view = mount();
});

afterEach(() => view.unmount());

describe("SeverityBadge", () => {
  it("shows the severity icon only when asked to", () => {
    view.render(
      <>
        <SeverityBadge severity="critical" withIcon dataAttributes={{ testid: "with-icon" }}>{LABEL}</SeverityBadge>
        <SeverityBadge severity="critical" dataAttributes={{ testid: "without-icon" }}>{LABEL}</SeverityBadge>
      </>,
    );
    expect(view.container.querySelector('[data-testid="with-icon"] svg')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="without-icon"] svg')).toBeNull();
  });

  it("forwards its data attributes to the tag", () => {
    view.render(
      <SeverityBadge severity="critical" dataAttributes={{ testid: "badge", severity: "critical" }}>{LABEL}</SeverityBadge>,
    );
    const badge = view.container.querySelector('[data-testid="badge"]');
    expect(badge?.getAttribute("data-severity")).toBe("critical");
    expect(badge?.textContent).toBe(LABEL);
  });
});
