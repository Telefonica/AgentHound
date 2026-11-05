import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import AgentEditModal from "@/components/threat-model/AgentEditModal";
import { getCapabilities } from "@/lib/api/agentHound";
import { resetCapabilityRules } from "@/hooks/useCapabilityRules";
import type { CapabilityDescriptor } from "@/lib/api/types";
import { mount, press } from "../test-utils";
import { edges, nodes } from "./fixtures";

vi.mock("@/lib/api/agentHound", () => ({ getCapabilities: vi.fn() }));

const capability = (verb: string, evaluated_by: string[]): CapabilityDescriptor => ({
  verb,
  description: "",
  typical_source: null,
  typical_target: null,
  evaluated_by,
});

let view: ReturnType<typeof mount>;

async function open() {
  view.render(<AgentEditModal agentId="planner" nodes={nodes} edges={edges} onSave={() => {}} onClose={() => {}} />);
  await act(async () => {});
}

beforeEach(() => {
  resetCapabilityRules();
  vi.clearAllMocks();
  vi.mocked(getCapabilities).mockResolvedValue({
    capabilities: [capability("read", ["FH-001", "FH-004"]), capability("summarize", [])],
  });
  view = mount();
});

afterEach(() => {
  view.unmount();
  vi.restoreAllMocks();
});

const unchecked = () => Array.from(document.body.querySelectorAll("[data-testid=unchecked-verbs]"), (el) => el.textContent).join();
const uncheckedChips = () => Array.from(document.body.querySelectorAll("[data-testid=unchecked-verbs] button"), (el) => el.textContent);
const chip = (verb: string) => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === verb)!;
const tooltip = () => document.body.querySelector("[role=tooltip]")?.textContent ?? null;

async function hover(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
}

describe("AgentEditModal — verbs no rule looks at", () => {
  it("sets apart the verbs no rule looks at", async () => {
    await open();

    expect(unchecked()).toContain("Ninguna regla mira estos verbos");
    expect(unchecked()).toContain("summarize");
    expect(uncheckedChips()).not.toContain("read");
  });

  it("names the rules that look at a verb on hover", async () => {
    await open();

    await hover(chip("read"));
    expect(tooltip()).toContain("Lo comprueban FH-001, FH-004");
  });

  it("uses the singular when a single rule looks at a verb", async () => {
    vi.mocked(getCapabilities).mockResolvedValue({ capabilities: [capability("read", ["FH-011"])] });
    await open();

    await hover(chip("read"));
    expect(tooltip()).toBe("Lo comprueba FH-011");
  });

  it("treats a verb missing from the catalog as one no rule looks at", async () => {
    await open();

    expect(uncheckedChips()).toContain("invokeTool");
  });

  it("names the rules when adding a verb instead of a tooltip on a touch screen", async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query === "(pointer: coarse)" }));
    await open();

    await hover(chip("read"));
    expect(tooltip()).toBeNull();

    press(chip("read"));
    expect(document.body.textContent).toContain("Lo comprueban FH-001, FH-004");
  });

  it("shows no tooltip on a verb no rule looks at", async () => {
    await open();

    await hover(chip("summarize"));
    expect(tooltip()).toBeNull();
  });

  it("reuses the loaded catalog when the editor opens again", async () => {
    await open();
    view.unmount();
    view = mount();

    view.render(<AgentEditModal agentId="planner" nodes={nodes} edges={edges} onSave={() => {}} onClose={() => {}} />);

    expect(unchecked()).toContain("summarize");
    expect(getCapabilities).toHaveBeenCalledTimes(1);
  });

  it("names the rules when adding a verb some rule looks at", async () => {
    await open();

    press(chip("read"));
    expect(document.body.textContent).toContain("Lo comprueban FH-001, FH-004");

    press(chip("summarize"));
    expect(document.body.textContent).not.toContain("Lo comprueban");
  });

  it("warns when adding a verb no rule looks at", async () => {
    await open();

    press(chip("summarize"));
    expect(document.body.textContent).toContain("Ninguna regla mira el verbo \"summarize\"");

    press(chip("read"));
    expect(document.body.textContent).not.toContain("Ninguna regla mira el verbo");
  });

  it("keeps a single list per row when the catalog can't be loaded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getCapabilities).mockRejectedValueOnce(new Error("offline"));
    await open();

    expect(consoleError).toHaveBeenCalledWith("[ERROR]", "Capability catalog failed", expect.any(Error));
    expect(unchecked()).toBe("");
    expect(chip("summarize")).toBeDefined();
  });

  it("asks for the catalog again after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getCapabilities).mockRejectedValueOnce(new Error("offline"));
    await open();
    view.unmount();
    view = mount();

    await open();

    expect(getCapabilities).toHaveBeenCalledTimes(2);
    expect(unchecked()).toContain("summarize");
  });
});
