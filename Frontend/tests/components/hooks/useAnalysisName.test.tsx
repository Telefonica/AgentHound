import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnalysisName, type AnalysisName } from "@/hooks/useAnalysisName";
import { renameAnalysis } from "@/lib/api/agentHound";
import type { AnalysisListItem } from "@/lib/api/types";

vi.mock("@/lib/api/agentHound", () => ({ renameAnalysis: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const renameMock = vi.mocked(renameAnalysis);

/** A PATCH the test resolves or rejects by hand, to control the order. */
interface Pending {
  id: string;
  name: string;
  succeed: () => Promise<void>;
  fail: () => Promise<void>;
}
let pending: Pending[];

function nth(i: number): Pending {
  const p = pending[i];
  if (!p) throw new Error(`No request #${i} was sent`);
  return p;
}

let hook: AnalysisName;
function Harness() {
  hook = useAnalysisName();
  return null;
}

let root: Root;
let container: HTMLDivElement;

/** Let queued saves start their request (microtasks only). */
const flush = () => act(async () => {});

beforeEach(() => {
  pending = [];
  renameMock.mockReset();
  renameMock.mockImplementation(
    (id: string, name: string) =>
      new Promise<AnalysisListItem>((resolve, reject) => {
        pending.push({
          id,
          name,
          succeed: () => act(async () => resolve({ analysis_id: id, name } as AnalysisListItem)),
          fail: () => act(async () => reject(new Error("disk full"))),
        });
      }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useAnalysisName", () => {
  it("only changes the local name before the analysis exists", async () => {
    act(() => hook.setName("Draft"));
    act(() => hook.rename("Renamed"));
    await flush();

    expect(hook.name).toBe("Renamed");
    expect(hook.getName()).toBe("Renamed");
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("sends nothing on attach when the stored name is the current one", async () => {
    act(() => hook.setName("Test"));
    act(() => hook.attach("a1", "Test"));
    await flush();

    expect(renameMock).not.toHaveBeenCalled();
  });

  it("saves a rename made while the parse ran as soon as the analysis exists", async () => {
    act(() => hook.setName("Original"));
    act(() => hook.rename("Renamed mid-parse"));
    act(() => hook.attach("a1", "Original"));
    await flush();

    expect(pending.map((p) => [p.id, p.name])).toEqual([["a1", "Renamed mid-parse"]]);
    await nth(0).succeed();
    expect(hook.name).toBe("Renamed mid-parse");
    expect(hook.saveFailed).toBe(false);
  });

  it("shows a rename at once and saves it", async () => {
    act(() => hook.setName("Original"));
    act(() => hook.attach("a1", "Original"));
    act(() => hook.rename("Renamed"));

    expect(hook.name).toBe("Renamed");
    await flush();
    expect(pending.map((p) => p.name)).toEqual(["Renamed"]);
    await nth(0).succeed();
    expect(hook.name).toBe("Renamed");
  });

  it("goes back to the saved name and flags the failure when saving fails", async () => {
    act(() => hook.setName("Original"));
    act(() => hook.attach("a1", "Original"));
    act(() => hook.rename("Renamed"));
    await flush();
    await nth(0).fail();

    expect(hook.name).toBe("Original");
    expect(hook.saveFailed).toBe(true);

    // The next rename clears the error.
    act(() => hook.rename("Again"));
    expect(hook.saveFailed).toBe(false);
  });

  it("saves quick renames one at a time, in order, and rolls back to the last confirmed one", async () => {
    act(() => hook.setName("A"));
    act(() => hook.attach("a1", "A"));
    act(() => hook.rename("B"));
    await flush();
    act(() => hook.rename("C"));
    await flush();

    // C waits until B's request is answered.
    expect(pending.map((p) => p.name)).toEqual(["B"]);
    await nth(0).succeed();
    // B is confirmed, but C is what the user sees.
    expect(hook.name).toBe("C");
    await flush();
    expect(pending.map((p) => p.name)).toEqual(["B", "C"]);

    await nth(1).fail();
    expect(hook.name).toBe("B");
    expect(hook.saveFailed).toBe(true);
  });

  it("skips renames that were overtaken before their turn", async () => {
    act(() => hook.setName("A"));
    act(() => hook.attach("a1", "A"));
    act(() => hook.rename("B"));
    await flush();
    act(() => hook.rename("C"));
    act(() => hook.rename("D"));
    await nth(0).succeed();
    await flush();

    // C was never sent: by its turn the name was already D.
    expect(pending.map((p) => p.name)).toEqual(["B", "D"]);
  });

  it("keeps a newer rename when an older save fails", async () => {
    act(() => hook.setName("A"));
    act(() => hook.attach("a1", "A"));
    act(() => hook.rename("B"));
    await flush();
    act(() => hook.rename("C"));
    await nth(0).fail();

    expect(hook.name).toBe("C");
    expect(hook.saveFailed).toBe(false);
    await flush();
    expect(pending.map((p) => p.name)).toEqual(["B", "C"]);
  });

  it("ignores saves for an analysis that a new parse replaced", async () => {
    act(() => hook.setName("A"));
    act(() => hook.attach("a1", "A"));
    act(() => hook.rename("B"));
    await flush();
    act(() => hook.detach());
    await nth(0).fail();

    expect(hook.name).toBe("B");
    expect(hook.saveFailed).toBe(false);
  });
});
