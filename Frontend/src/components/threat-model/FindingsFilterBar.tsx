import { useTranslations } from "next-intl";
import { Checkbox, Chip, Inline, SearchField, Text1, skinVars, useTheme } from "@telefonica/mistica";
import type { IconProps } from "@telefonica/mistica";
import { FILTER_SEVERITIES } from "@/lib/results/findingSearch";
import { SEVERITY_STYLES, type Severity } from "@/lib/severity";
import { severityAccentColor } from "@/lib/threatModelColors";

function severityIcon(severity: Severity, active: boolean) {
  const Icon = SEVERITY_STYLES[severity].Icon;
  function SeverityChipIcon({ size, color }: IconProps) {
    const { isDarkMode } = useTheme();
    return <Icon size={size} color={active ? color : severityAccentColor(severity, isDarkMode)} />;
  }
  return SeverityChipIcon;
}

const SEVERITY_ICONS = Object.fromEntries(
  FILTER_SEVERITIES.map((s) => [s, { idle: severityIcon(s, false), active: severityIcon(s, true) }]),
) as Record<Severity, { idle: ReturnType<typeof severityIcon>; active: ReturnType<typeof severityIcon> }>;

interface FindingsFilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  severities: ReadonlySet<Severity>;
  severityCounts: Record<Severity, number>;
  onToggleSeverity: (severity: Severity) => void;
  matching: number;
  total: number;
  filtering: boolean;
}

function FindingsFilterBar({ query, onQueryChange, severities, severityCounts, onToggleSeverity, matching, total, filtering }: FindingsFilterBarProps) {
  const t = useTranslations("results");
  const tSeverity = useTranslations("overview.severity");
  const present = FILTER_SEVERITIES.filter((s) => severityCounts[s] > 0);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ flex: "0 1 320px", minWidth: 0 }}>
          <SearchField
            name="findings-search"
            label={t("searchFindings")}
            placeholder={t("searchFindingsPlaceholder")}
            value={query}
            onChangeValue={onQueryChange}
            inputMode="search"
            autoComplete="off"
            fullWidth
          />
        </div>
        <div aria-live="polite">
          {filtering && (
            <Text1 regular color={skinVars.colors.textSecondary} dataAttributes={{ testid: "findings-match-count" }}>
              {t("findingsMatching", { count: matching, total })}
            </Text1>
          )}
        </div>
      </div>
      {present.length > 1 && (
        <Inline space={8} alignItems="center" wrap verticalSpace={8} role="group" aria-label={t("filterBySeverity")}>
          {present.map((s) => (
            <Checkbox
              key={s}
              name={`severity-${s}`}
              checked={severities.has(s)}
              onChange={() => onToggleSeverity(s)}
              dataAttributes={{ testid: `severity-chip-${s}` }}
              render={({ checked }) => (
                <Chip Icon={SEVERITY_ICONS[s][checked ? "active" : "idle"]} active={checked}>
                  {`${tSeverity(s)} ${severityCounts[s]}`}
                </Chip>
              )}
            />
          ))}
        </Inline>
      )}
    </div>
  );
}

export default FindingsFilterBar;
