import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import InferenceStep from "@/components/threat-model/InferenceStep";
import { getCapabilities } from "@/lib/api/agentHound";
import { resetCapabilityRules } from "@/hooks/useCapabilityRules";
import type { CoverageWarning } from "@/lib/api/types";
import { mount } from "../test-utils";
import { edges, nodes } from "./fixtures";

vi.mock("@/lib/api/agentHound", () => ({ getCapabilities: vi.fn() }));

let view: ReturnType<typeof mount>;

beforeEach(() => {
  resetCapabilityRules();
  vi.clearAllMocks();
  vi.mocked(getCapabilities).mockResolvedValue({ capabilities: [] });
  view = mount();
});

afterEach(() => view.unmount());

const box = () => view.container.querySelector('[data-testid="coverage-warnings"]');
const noop = () => {};

describe("InferenceStep — coverage warnings", () => {
  it("flags the rules out of reach before the analysis runs", () => {
    const warnings: CoverageWarning[] = [
      {
        kind: "needs_declaration",
        rules: ["FH-012"],
        properties: ["capability_kinds"],
        message: "",
        declare: [[{ node_type: "tool", property: "capability_kinds", values: ["deployRelease"] }]],
      },
    ];
    view.render(<InferenceStep nodes={nodes} edges={edges} warnings={warnings} framework="langgraph" onNodesChange={noop} onEdgesChange={noop} />);

    expect(box()?.textContent).toContain("1 regla que el formato de este fichero no puede comprobar del todo");
  });

  it("renders nothing for a file without warnings", () => {
    view.render(<InferenceStep nodes={nodes} edges={edges} warnings={[]} framework="generic" onNodesChange={noop} onEdgesChange={noop} />);

    expect(box()).toBeNull();
  });
});

describe("InferenceStep — capability catalog", () => {
  it("starts loading the catalog before the agent editor opens", () => {
    view.render(<InferenceStep nodes={nodes} edges={edges} warnings={[]} framework="generic" onNodesChange={noop} onEdgesChange={noop} />);

    expect(getCapabilities).toHaveBeenCalledTimes(1);
  });

  it("asks for the catalog again after a failed preload", async () => {
    vi.mocked(getCapabilities).mockRejectedValueOnce(new Error("offline"));
    view.render(<InferenceStep nodes={nodes} edges={edges} warnings={[]} framework="generic" onNodesChange={noop} onEdgesChange={noop} />);
    await act(async () => {});
    view.unmount();
    view = mount();

    view.render(<InferenceStep nodes={nodes} edges={edges} warnings={[]} framework="generic" onNodesChange={noop} onEdgesChange={noop} />);

    expect(getCapabilities).toHaveBeenCalledTimes(2);
  });
});
