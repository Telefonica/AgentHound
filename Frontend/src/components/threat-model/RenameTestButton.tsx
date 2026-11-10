import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconButton, IconEditPencilRegular, TextField, useDialog } from "@telefonica/mistica";

interface RenameFieldProps {
  initialValue: string;
  label: string;
  emptyHelperText: string;
  onChange: (value: string) => void;
}

/**
 * The dialog's content is rendered by Mistica's DialogRoot, so the field keeps
 * its own state and reports the draft upwards. It opens focused with the current
 * name, which puts the field in its "activated" state (floating label).
 */
function RenameField({ initialValue, label, emptyHelperText, onChange }: RenameFieldProps) {
  const [value, setValue] = useState(initialValue);
  const isEmpty = !value.trim();
  return (
    <TextField
      name="test-name"
      label={label}
      value={value}
      autoFocus
      fullWidth
      error={isEmpty}
      helperText={isEmpty ? emptyHelperText : undefined}
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
 *
 * Mistica's dialog always closes on accept and cannot disable its buttons, so
 * an empty name cannot block "Update": the field says so while it is empty, and
 * confirming it keeps the current name.
 */
function RenameTestButton({ name, onRename }: RenameTestButtonProps) {
  const t = useTranslations("wizard.rename");
  const { dialog } = useDialog();
  // The dialog keeps the callbacks from the render that opened it, so the draft
  // lives in a ref they can read when "Update" is pressed.
  const draftRef = useRef(name);

  const open = () => {
    draftRef.current = name;
    dialog({
      title: t("title"),
      message: t("description"),
      extra: (
        <RenameField
          initialValue={name}
          label={t("fieldLabel")}
          emptyHelperText={t("emptyName")}
          onChange={(value) => {
            draftRef.current = value;
          }}
        />
      ),
      acceptText: t("update"),
      onAccept: () => {
        const next = draftRef.current.trim();
        if (next && next !== name.trim()) onRename(next);
      },
      cancelText: t("cancel"),
      onCancel: () => {},
      closeButtonLabel: t("close"),
    });
  };

  return (
    <IconButton
      type="brand"
      backgroundType="transparent"
      Icon={IconEditPencilRegular}
      aria-label={t("editLabel")}
      onPress={open}
    />
  );
}

export default RenameTestButton;
