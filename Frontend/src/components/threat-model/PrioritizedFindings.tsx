import { useCallback, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Box,
  Boxed,
  ButtonLink,
  IconChevronDownRegular,
  IconChevronUpRegular,
  Inline,
  Stack,
  Tag,
  Text1,
  Touchable,
  skinVars,
  useTheme,
} from "@telefonica/mistica";
import { groupFindings, routeSummary, type FindingPattern } from "@/lib/results/findingDisplay";
import { severityAccentColor } from "@/lib/threatModelColors";
import type { Finding, GraphNode } from "@/types/ThreatModel";

export const VISIBLE_GROUPS = 5;
export const VISIBLE_OCCURRENCES = 10;

type NodesById = Map<string, Pick<GraphNode, "label" | "type">>;

interface PrioritizedFindingsProps {
  findings: Finding[];
  findingLabelById: Map<string, string>;
  nodesById: NodesById;
  selectedFindingId: string | null;
  onSelectFinding: (id: string) => void;
}

const rowStyle = (highlighted: boolean) => ({
  display: "block",
  width: "100%",
  borderRadius: skinVars.borderRadii.container,
  background: highlighted ? skinVars.colors.brandLow : undefined,
});

function capped<T>(items: T[], limit: number, holdsSelection: (item: T) => boolean): T[] {
  return items.filter((item, i) => i < limit || holdsSelection(item));
}

function usePatternTitle(nodesById: NodesById) {
  const t = useTranslations("results");
  return (finding: Finding) => {
    const anchorId = finding.groupAnchor;
    if (!anchorId) return finding.title;
    const key = nodesById.get(anchorId)?.type === "input" ? "findingGroupFrom" : "findingGroupAt";
    return t(key, { title: finding.title, node: routeSummary([anchorId], nodesById) });
  };
}

interface FindingRowProps {
  finding: Finding;
  label: string;
  text: string;
  selected: boolean;
  isDarkMode: boolean;
  onSelect: (id: string) => void;
}

function FindingRow({ finding, label, text, selected, isDarkMode, onSelect }: FindingRowProps) {
  const t = useTranslations("results");
  const row = (
    <Inline space={4} wrap>
      <Text1 medium color={severityAccentColor(finding.severity, isDarkMode)}>{label}</Text1>
      <Text1 regular color={skinVars.colors.textSecondary}>{t("findingSummary", { title: text, score: finding.score })}</Text1>
    </Inline>
  );
  if (finding.path.length === 0) return <Box paddingX={8} paddingY={4}>{row}</Box>;
  return (
    <Touchable
      onPress={() => onSelect(finding.id)}
      dataAttributes={{ testid: "prioritized-finding" }}
      aria-current={selected ? "true" : undefined}
      aria-description={t("showRouteHint")}
      style={rowStyle(selected)}
    >
      <Box paddingX={8} paddingY={4}>{row}</Box>
    </Touchable>
  );
}

interface GroupRowsProps {
  group: FindingPattern<Finding>;
  expanded: boolean;
  onToggle: (id: string) => void;
  findingLabelById: Map<string, string>;
  nodesById: NodesById;
  selectedFindingId: string | null;
  isDarkMode: boolean;
  onSelectFinding: (id: string) => void;
}

function GroupRows({ group, expanded, onToggle, findingLabelById, nodesById, selectedFindingId, isDarkMode, onSelectFinding }: GroupRowsProps) {
  const t = useTranslations("results");
  const contentId = useId();
  const [showAll, setShowAll] = useState(false);
  const patternTitle = usePatternTitle(nodesById);
  const [top] = group.findings;
  const title = patternTitle(top);
  const holdsSelection = group.findings.some((f) => f.id === selectedFindingId);
  const visible = showAll ? group.findings : capped(group.findings, VISIBLE_OCCURRENCES, (f) => f.id === selectedFindingId);
  const Chevron = expanded ? IconChevronUpRegular : IconChevronDownRegular;
  return (
    <Stack space={2}>
      <Touchable
        onPress={() => onToggle(group.id)}
        dataAttributes={{ testid: "prioritized-finding-group" }}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-description={holdsSelection && !expanded ? t("findingGroupHoldsSelection") : undefined}
        style={rowStyle(holdsSelection && !expanded)}
      >
        <Box paddingX={8} paddingY={4}>
          <Inline space="between" alignItems="center">
            <Inline space={4} alignItems="center" wrap verticalSpace={2}>
              <Text1 medium color={severityAccentColor(top.severity, isDarkMode)}>{top.ruleId}</Text1>
              <Text1 regular color={skinVars.colors.textSecondary}>{t("findingSummary", { title, score: top.score })}</Text1>
              <Tag type="inactive" small>{t("findingGroupCount", { count: group.findings.length })}</Tag>
            </Inline>
            <Chevron size={16} color={skinVars.colors.textSecondary} />
          </Inline>
        </Box>
      </Touchable>
      {expanded && (
        <Box paddingLeft={16} id={contentId}>
          <Stack space={2}>
            {visible.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                label={findingLabelById.get(f.id) ?? f.ruleId}
                text={f.path.length > 0 ? routeSummary(f.path, nodesById) : f.title}
                selected={f.id === selectedFindingId}
                isDarkMode={isDarkMode}
                onSelect={onSelectFinding}
              />
            ))}
            {group.findings.length > VISIBLE_OCCURRENCES && (
              <Box paddingX={8}>
                <ButtonLink small bleedLeft aria-expanded={showAll} aria-controls={contentId} onPress={() => setShowAll((v) => !v)}>
                  {showAll
                    ? t("showTopFindingGroups", { count: VISIBLE_OCCURRENCES })
                    : t("showMoreOccurrences", { count: group.findings.length - visible.length })}
                </ButtonLink>
              </Box>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function PrioritizedFindings({ findings, findingLabelById, nodesById, selectedFindingId, onSelectFinding }: PrioritizedFindingsProps) {
  const t = useTranslations("results");
  const { isDarkMode } = useTheme();
  const patternTitle = usePatternTitle(nodesById);
  const listId = useId();
  const groups = useMemo(() => groupFindings(findings), [findings]);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const visibleGroups = showAll
    ? groups
    : capped(groups, VISIBLE_GROUPS, (g) => g.findings.some((f) => f.id === selectedFindingId));

  return (
    <Boxed dataAttributes={{ testid: "prioritized-findings" }}>
      <Box paddingX={16} paddingY={12}>
        <Stack space={8}>
          <Inline space={8} alignItems="baseline" wrap verticalSpace={2}>
            <Text1 medium color={skinVars.colors.error}>{t("prioritizedFindings")}</Text1>
            <Text1 regular color={skinVars.colors.textSecondary}>
              {t("prioritizedFindingsCount", { findings: findings.length, groups: groups.length })}
            </Text1>
          </Inline>
          <Box id={listId}>
            <Stack space={2}>
              {visibleGroups.map((group) => {
                const [only] = group.findings;
                return group.findings.length === 1 ? (
                  <FindingRow
                    key={group.id}
                    finding={only}
                    label={findingLabelById.get(only.id) ?? only.ruleId}
                    text={patternTitle(only)}
                    selected={only.id === selectedFindingId}
                    isDarkMode={isDarkMode}
                    onSelect={onSelectFinding}
                  />
                ) : (
                  <GroupRows
                    key={group.id}
                    group={group}
                    expanded={expanded.has(group.id)}
                    onToggle={toggleGroup}
                    findingLabelById={findingLabelById}
                    nodesById={nodesById}
                    selectedFindingId={selectedFindingId}
                    isDarkMode={isDarkMode}
                    onSelectFinding={onSelectFinding}
                  />
                );
              })}
            </Stack>
          </Box>
          {groups.length > VISIBLE_GROUPS && (
            <Box>
              <ButtonLink small bleedLeft aria-expanded={showAll} aria-controls={listId} onPress={() => setShowAll((v) => !v)}>
                {showAll
                  ? t("showTopFindingGroups", { count: VISIBLE_GROUPS })
                  : t("showAllFindingGroups", { count: groups.length })}
              </ButtonLink>
            </Box>
          )}
        </Stack>
      </Box>
    </Boxed>
  );
}

export default PrioritizedFindings;
