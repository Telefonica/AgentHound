import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonLink, IconButton, IconEditPencilRegular, TextField, useDialog } from "@telefonica/mistica";

interface RenameFieldProps {
  initialValue: string;
  label: string;
  onChange: (value: string) => void;
}

/**
 * The dialog's content is rendered by Mistica's DialogRoot, so the field keeps
 * its own state and reports the draft upwards. It opens focused with the current
 * name, which puts the field in its "activated" state (floating label).
 */
function RenameField({ initialValue, label, onChange }: RenameFieldProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <TextField
      name="test-name"
      label={label}
      value={value}
      autoFocus
      fullWidth
      error={!value.trim()}
      onChangeValue={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

interface RenameTestButtonProps {
  /** Current test name. */
  name: string;
  /** Called with the trimmed new name once the user confirms a different, non-empty one. */
  onRename: (name: string) => void;
}

/**
 * Pencil button for the wizard header. Pressing it opens a Mistica dialog to
 * edit the test name: the field starts with the current name, "Update" applies
 * it and "Cancel" (or the close button) discards it.
 */
function RenameTestButton({ name, onRename }: RenameTestButtonProps) {
  const t = useTranslations("wizard.rename");
  const { dialog } = useDialog();

  const open = () => {
    let draft = name;
    const closeLabel = t("close");
    dialog({
      title: t("title"),
      message: t("description"),
      extra: <RenameField initialValue={name} label={t("fieldLabel")} onChange={(value) => (draft = value)} />,
      acceptText: t("update"),
      onAccept: () => {
        const next = draft.trim();
        if (next && next !== name.trim()) onRename(next);
      },
      // Mistica's dialog exposes no way to close it from a custom link, so
      // "Cancel" presses the dialog's own close button (found by its label).
      link: (
        <ButtonLink
          onPress={() => document.querySelector<HTMLElement>(`button[aria-label="${closeLabel}"]`)?.click()}
        >
          {t("cancel")}
        </ButtonLink>
      ),
      closeButtonLabel: closeLabel,
    });
  };

  return <IconButton type="brand" backgroundType="transparent" Icon={IconEditPencilRegular} aria-label={t("editLabel")} onPress={open} />;
}

export default RenameTestButton;
