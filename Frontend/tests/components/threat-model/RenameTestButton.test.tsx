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

/** Lets Mistica load the dialog lazily and run its open/close animations. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

async function openDialog() {
  view.render(<RenameTestButton name="Prueba 02" onRename={onRename} />);
  const pencil = view.container.querySelector<HTMLElement>(`button[aria-label="${t.editLabel}"]`);
  expect(pencil).not.toBeNull();
  press(pencil as HTMLElement);
  await settle();
}

function dialogEl(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function field(): HTMLInputElement {
  const input = dialogEl()?.querySelector<HTMLInputElement>('input[name="test-name"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

/** Types into the controlled field the way React listens for it. */
function typeName(value: string) {
  const input = field();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function dialogButton(text: string): HTMLElement {
  const button = Array.from(dialogEl()?.querySelectorAll<HTMLElement>("button") ?? []).find(
    (b) => b.textContent === text,
  );
  expect(button).toBeDefined();
  return button as HTMLElement;
}

async function pressInDialog(text: string) {
  press(dialogButton(text));
  await settle();
}

describe("RenameTestButton", () => {
  it("renders an accessible pencil button", () => {
    view.render(<RenameTestButton name="Prueba 02" onRename={onRename} />);
    expect(view.container.querySelector(`button[aria-label="${t.editLabel}"]`)).not.toBeNull();
  });

  it("opens a dialog with the current name in the field", async () => {
    await openDialog();
    expect(dialogEl()?.textContent).toContain(t.title);
    expect(dialogEl()?.textContent).toContain(t.description);
    expect(field().value).toBe("Prueba 02");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("renames with the trimmed new name on Update", async () => {
    await openDialog();
    typeName("  Prueba 03  ");
    await pressInDialog(t.update);
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith("Prueba 03");
    expect(dialogEl()).toBeNull();
  });

  it("discards the edit on Cancel", async () => {
    await openDialog();
    typeName("Prueba 03");
    await pressInDialog(t.cancel);
    expect(onRename).not.toHaveBeenCalled();
    expect(dialogEl()).toBeNull();
  });

  it("explains an empty name and keeps the current one on Update", async () => {
    await openDialog();
    typeName("   ");
    expect(dialogEl()?.textContent).toContain(t.emptyName);
    await pressInDialog(t.update);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("does not rename when the name is unchanged", async () => {
    await openDialog();
    await pressInDialog(t.update);
    expect(onRename).not.toHaveBeenCalled();
  });
});
