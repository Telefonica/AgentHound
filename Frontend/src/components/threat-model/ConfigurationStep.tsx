import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Align,
  ButtonSecondary,
  DoubleField,
  FileUpload,
  IconExportRegular,
  Select,
  Stack,
  Text1,
  TextField,
  skinVars,
} from "@telefonica/mistica";
import FileBox from "@/components/ui/FileBox";
import StepSection from "@/components/threat-model/StepSection";
import { PROVIDERS, YAML_COUNT } from "@/lib/threatModelData";

/**
 * Mistica's FileUpload keeps its selected files internally and only exposes them
 * through `renderFiles`. This reporter renders nothing itself; it just lifts the
 * current file to the parent via an effect, reporting only when the set actually
 * changes (guarded by a name/size signature) to avoid a render loop. The parent
 * owns the visible file list so it can swap the dropzone out once a file exists.
 */
function FileReporter({
  files,
  onFiles,
}: {
  files: FileList | null;
  onFiles: (files: File[]) => void;
}) {
  const list = useMemo(() => (files ? Array.from(files) : []), [files]);
  const signature = list.map((f) => `${f.name}:${f.size}`).join("|");
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      onFiles(list);
    }
  }, [signature, list, onFiles]);

  return null;
}

interface YamlUploadFieldProps {
  title: string;
  description: string;
  onFiles: (files: File[]) => void;
}

/**
 * Single-YAML upload field. Each field holds exactly one file, so once a file is
 * picked the parent swaps this dropzone for a FileBox; here we only need to
 * accept one file and report it upwards.
 */
function YamlUploadField({ title, description, onFiles }: YamlUploadFieldProps) {
  const t = useTranslations("configuration");
  return (
    <FileUpload
      accept=".yaml,.yml"
      withDropZone
      // The dropzone centres its text but leaves the asset at the start; Align puts the icon over it.
      asset={
        <Align x="center">
          <IconExportRegular size={24} color={skinVars.colors.brand} />
        </Align>
      }
      title={title}
      description={description}
      renderButton={({ onPress, small, disabled }) => (
        <ButtonSecondary small={small} disabled={disabled} onPress={onPress}>
          {t("chooseFileButton")}
        </ButtonSecondary>
      )}
      renderFiles={({ files }) => <FileReporter files={files} onFiles={onFiles} />}
    />
  );
}

interface ConfigurationStepProps {
  name: string;
  onNameChange: (value: string) => void;
  provider: string;
  onProviderChange: (value: string) => void;
  showValidation: boolean;
  onFilesChange: (filesByField: Record<string, File[]>) => void;
}

function ConfigurationStep({
  name,
  onNameChange,
  provider,
  onProviderChange,
  showValidation,
  onFilesChange,
}: ConfigurationStepProps) {
  const t = useTranslations("configuration");
  const [touched, setTouched] = useState(false);
  const [filesByField, setFilesByField] = useState<Record<string, File[]>>({});

  const fileCount = YAML_COUNT[provider] ?? 1;
  const uploadFields = useMemo(
    () =>
      fileCount === 2
        ? [
            { key: "agents", title: t("fileAgentsTitle"), description: t("fileAgentsDesc") },
            { key: "tasks", title: t("fileTasksTitle"), description: t("fileTasksDesc") },
          ]
        : [{ key: "workflow", title: t("fileWorkflowTitle"), description: t("fileWorkflowDesc") }],
    [fileCount, t],
  );

  const handleFieldFiles = useCallback((key: string, files: File[]) => {
    setFilesByField((prev) => ({ ...prev, [key]: files }));
  }, []);

  const removeFieldFile = useCallback((key: string) => {
    setFilesByField((prev) => ({ ...prev, [key]: [] }));
  }, []);

  // Report files keyed by field so the parent merges the CrewAI agents/tasks
  // pair deterministically — a flat list silently dropped the tasks file.
  const activeKeys = uploadFields.map((f) => f.key).join(",");
  useEffect(() => {
    const keys = activeKeys ? activeKeys.split(",") : [];
    const active: Record<string, File[]> = {};
    for (const key of keys) {
      const forKey = filesByField[key];
      if (forKey && forKey.length > 0) active[key] = forKey;
    }
    onFilesChange(active);
  }, [activeKeys, filesByField, onFilesChange]);

  const nameInvalid = (showValidation || touched) && !name.trim();
  const showFilesError = showValidation && uploadFields.every((f) => (filesByField[f.key] ?? []).length === 0);

  // The step renders straight onto the wizard's container (the screen wraps the
  // stepper and this content in a single Boxed), so there are no inner boxes.
  // The header and the 32 gap to the content come from StepSection; the fields
  // and the upload zones are 32 apart.
  return (
    <StepSection title={t("heading")} description={t("subtitle")}>
      <Stack space={32}>
        <DoubleField layout="50/50" fullWidth>
          <TextField
            name="threat-model-name"
            label={t("nameLabel")}
            placeholder={t("namePlaceholder")}
            value={name}
            onChangeValue={onNameChange}
            onBlur={() => setTouched(true)}
            error={nameInvalid}
            helperText={nameInvalid ? t("nameRequired") : undefined}
            fullWidth
          />
          <Select
            name="threat-model-provider"
            label={t("providerLabel")}
            value={provider}
            onChangeValue={onProviderChange}
            options={PROVIDERS.map((p) => ({ value: p.value, text: p.text }))}
            fullWidth
          />
        </DoubleField>

        <Stack space={12}>
          <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
            {uploadFields.map((field) => {
              const current = filesByField[field.key] ?? [];
              return (
                <div key={field.key} style={{ flex: "1 1 0", minWidth: 0 }}>
                  {current.length > 0 ? (
                    <Stack space={12}>
                      {current.map((file) => (
                        <FileBox
                          key={`${file.name}:${file.size}`}
                          file={file}
                          onRemove={() => removeFieldFile(field.key)}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <YamlUploadField
                      title={field.title}
                      description={field.description}
                      onFiles={(files) => handleFieldFiles(field.key, files)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {showFilesError && (
            <Text1 regular color={skinVars.colors.error}>
              {t("filesRequired")}
            </Text1>
          )}
        </Stack>
      </Stack>
    </StepSection>
  );
}

export default ConfigurationStep;
