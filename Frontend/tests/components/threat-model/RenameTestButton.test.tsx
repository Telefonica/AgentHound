import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RenameTestButton from "@/components/threat-model/RenameTestButton";
import messages from "../../../messages/es.json";
import { mount, press } from "../test-utils";

const t = messages.wizard.rename;

let view: ReturnType<typeof mount>;
let onRename: ReturnType<typeof vi.fn<(name: string) => void>>;

beforeEach(() => {
  view = mount();
  onRename = vi.fn<(name: string) => void>();
});

afterEach(() => {
  view.unmount();
  document.body.innerHTML = "";
});

async function openDialog() {
  view.render(<RenameTestButton name="Prueba 02" onRename={onRename} />);
  const pencil = view.container.querySelector<HTMLElement>(`button[aria-label="${t.editLabel}"]`);
  expect(pencil).not.toBeNull();
  press(pencil as HTMLElement);
  // Mistica loads the dialog lazily.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("RenameTestButton", () => {
  it("renders an accessible pencil button", () => {
    view.render(<RenameTestButton name="Prueba 02" onRename={onRename} />);
    expect(view.container.querySelector(`button[aria-label="${t.editLabel}"]`)).not.toBeNull();
  });

  it("opens a dialog with the current name in the field", async () => {
    await openDialog();
    expect(document.body.textContent).toContain(t.title);
    expect(document.body.textContent).toContain(t.description);
    const input = document.body.querySelector<HTMLInputElement>('input[name="test-name"]');
    expect(input?.value).toBe("Prueba 02");
    expect(onRename).not.toHaveBeenCalled();
  });
});
