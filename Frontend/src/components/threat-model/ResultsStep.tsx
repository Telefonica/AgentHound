"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  Align,
  Box,
  Boxed,
  BoxedAccordion,
  BoxedAccordionItem,
  ButtonPrimary,
  ButtonSecondary,
  Callout,
  Circle,
  DataCard,
  Divider,
  Grid,
  IconArrowLineRightRegular,
  IconCheckFilled,
  IconDownloadRegular,
  IconRobotRegular,
  IconShieldCheckedOkRegular,
  IconTargetRegular,
  Inline,
  Spinner,
  Stack,
  Tabs,
  Tag,
  Text1,
  Text2,
  Text4,
  Text6,
  Timeline,
  TimelineItem,
  Touchable,
  skinVars,
  useTheme,
} from "@telefonica/mistica";
import type { IconProps } from "@telefonica/mistica";
import { FindingId, FindingRoute } from "@/components/threat-model/FindingIdentity";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import { StepHeader } from "@/components/threat-model/StepSection";
import InlineError from "@/components/ui/InlineError";
import { severityAccentColor } from "@/lib/threatModelColors";
import { formatSnakeCase, formatValue } from "@/lib/format";
import { findingLabels } from "@/lib/results/findingDisplay";
import { SEVERITY_STYLES } from "@/lib/severity";
import type { AnalysisResult, ChokepointRec } from "@/lib/api/adapters";
import {
  downloadFindingsJson,
  downloadGraphJson,
  downloadMarkdownReport,
  downloadYaml,
} from "@/lib/threatModelExport";
import type { Finding, GraphNode } from "@/types/ThreatModel";
import type { ReactElement } from "react";

// The graph is a large, decorative SVG only needed once a user reaches this step of the
// wizard — keep it out of the initial results-step bundle.
const CapabilityGraph = dynamic(() => import("@/components/threat-model/CapabilityGraph"), {
  ssr: false,
  loading: () => (
    <Boxed>
      <Box paddingY={64}>
        <Align x="center">
          <Spinner size={24} color={skinVars.colors.brand} />
        </Align>
      </Box>
    </Boxed>
  ),
});

interface MetricRowProps {
  label: string;
  value: string | number;
  color?: string;
}

function MetricRow({ label, value, color }: MetricRowProps) {
  return (
    <Inline space="between" alignItems="baseline">
      <Text1 regular color={skinVars.colors.textSecondary}>{label}</Text1>
      <Text1 medium color={color}>{value}</Text1>
    </Inline>
  );
}

interface BeforeAfterCardProps {
  label: string;
  Icon: (props: IconProps) => ReactElement;
  color: string;
  rows: { label: string; value: string | number; color?: string }[];
  headerBadge?: { label: string; value: string | number; color: string };
}

function BeforeAfterCard({ label, Icon, color, rows, headerBadge }: BeforeAfterCardProps) {
  return (
    <Boxed>
      <Box paddingX={20} paddingY={20}>
        <Stack space={16}>
          <Inline space="between" alignItems="center">
            <Inline space={12} alignItems="center">
              <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                <Icon size={18} color={color} />
              </Circle>
              <Text2 medium color={color}>{label}</Text2>
            </Inline>
            {headerBadge && (
              <Inline space={4} alignItems="baseline">
                <Text2 medium color={headerBadge.color}>{headerBadge.value}</Text2>
                <Text1 regular color={skinVars.colors.textSecondary}>{headerBadge.label}</Text1>
              </Inline>
            )}
          </Inline>
          <Divider />
          <Stack space={8}>
            {rows.map((row) => (
              <MetricRow key={row.label} label={row.label} value={row.value} color={row.color} />
            ))}
          </Stack>
        </Stack>
      </Box>
    </Boxed>
  );
}

interface FindingCardProps {
  finding: Finding;
  label: string;
  nodesById: Map<string, Pick<GraphNode, "label">>;
  isDarkMode: boolean;
  tSeverity: (key: string) => string;
  scoreLabel: string;
  routeHint: string;
  selected: boolean;
  onSelect?: (id: string) => void;
}

function FindingCard({ finding, label, nodesById, isDarkMode, tSeverity, scoreLabel, routeHint, selected, onSelect }: FindingCardProps) {
  const accent = severityAccentColor(finding.severity, isDarkMode);
  const hasRefs = Boolean(
    finding.owaspAgentic?.length || finding.owaspLlm?.length || finding.mitre?.length,
  );
  const card = (
    <Boxed>
      <Box paddingX={20} paddingY={16}>
        <Stack space={12}>
          <Inline space="between" alignItems="center">
            <Inline space={8} alignItems="center" wrap verticalSpace={4}>
              <SeverityBadge severity={finding.severity} small>{tSeverity(finding.severity)}</SeverityBadge>
              <Text1 medium color={skinVars.colors.textSecondary}>{label}</Text1>
              <FindingId id={finding.id} />
              <Tag type="inactive" small>{formatSnakeCase(finding.category)}</Tag>
            </Inline>
            <Text2 medium color={accent}>{scoreLabel}: {finding.score}</Text2>
          </Inline>
          <Stack space={4}>
            <Text2 medium>{finding.title}</Text2>
            <FindingRoute path={finding.path} nodesById={nodesById} />
            {finding.desc && <Text1 regular color={skinVars.colors.textSecondary}>{finding.desc}</Text1>}
            {finding.evidence && Object.keys(finding.evidence).length > 0 && (
              <Inline space={4} wrap verticalSpace={4}>
                {Object.entries(finding.evidence).map(([key, value]) => (
                  <Tag key={key} small type="inactive">
                    {`${formatSnakeCase(key)}: ${formatValue(value)}`}
                  </Tag>
                ))}
              </Inline>
            )}
          </Stack>
          {hasRefs && (
            <Inline space={4} wrap verticalSpace={4}>
              {finding.owaspAgentic?.map((tag) => <Tag key={tag} small type="inactive">{`Agentic ${tag}`}</Tag>)}
              {finding.owaspLlm?.map((tag) => <Tag key={tag} small type="inactive">{tag}</Tag>)}
              {finding.mitre?.map((tag) => <Tag key={tag} small type="inactive">{tag}</Tag>)}
            </Inline>
          )}
        </Stack>
      </Box>
    </Boxed>
  );
  if (!onSelect) return card;
  return (
    <Touchable
      onPress={() => onSelect(finding.id)}
      dataAttributes={{ testid: "finding-card" }}
      aria-current={selected ? "true" : undefined}
      aria-description={routeHint}
      style={{
        display: "block",
        width: "100%",
        borderRadius: skinVars.borderRadii.container,
        outline: selected ? `2px solid ${skinVars.colors.borderSelected}` : undefined,
        outlineOffset: 2,
      }}
    >
      {card}
    </Touchable>
  );
}

function ChokepointCallout({ rec }: { rec: ChokepointRec }) {
  const t = useTranslations("results");
  return (
    <Callout
      title={t("chokepointTitle")}
      description={t("chokepointDesc", {
        control: rec.controlName,
        node: rec.targetNodeLabel,
        pct: rec.riskReductionPct,
        cost: rec.costEstimate,
      })}
      asset={<IconArrowLineRightRegular color={skinVars.colors.brand} />}
    />
  );
}

interface ResultsStepProps {
  result: AnalysisResult | null;
  hideTitle?: boolean;
  /** Wizard step title. When set, the header uses the shared step header (title + paragraph) instead of the page-title style. */
  stepTitle?: string;
}

function ResultsStep({ result, hideTitle = false, stepTitle }: ResultsStepProps) {
  const t = useTranslations("results");
  const tSeverity = useTranslations("overview.severity");
  const tCommon = useTranslations("common");
  const { isDarkMode } = useTheme();
  const [tab, setTab] = useState(0);
  const solved = tab === 1;
  const view = solved ? "solution" : "findings";

  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const selectFinding = useCallback((id: string) => {
    setSelectedFindingId((current) => (current === id ? null : id));
    graphSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  const clearSelection = useCallback(() => setSelectedFindingId(null), []);
  const labelById = useMemo(() => findingLabels(result?.findings ?? []), [result]);
  const nodesById = useMemo(() => new Map((result?.nodes ?? []).map((n) => [n.id, n])), [result]);
  const [resolvedFindings, openFindings] = useMemo(() => {
    const broken = new Set(result?.solution?.brokenFindingIds);
    const all = result?.findings ?? [];
    return [all.filter((f) => broken.has(f.id)), all.filter((f) => !broken.has(f.id))];
  }, [result]);

  if (!result) {
    return <InlineError message={tCommon("error.description")} />;
  }

  const { counts, findings } = result;
  const sol = result.solution;
  const findingGroups = (["attack", "hygiene"] as const)
    .map((cls) => ({ cls, items: findings.filter((f: Finding) => f.findingClass === cls) }))
    .filter(({ items }) => items.length > 0);
  // The Proposed Solution tab needs the live simulation; if it failed to load
  // (Phase 2 unavailable), surface a notice rather than a misleading green graph.
  const solutionUnavailable = solved && !sol;
  const subtitle = t("subtitleTemplate", {
    agents: counts.agents,
    tools: counts.tools,
    data: counts.dataAssets,
    findings: counts.findings,
    critical: counts.critical,
  });

  return (
    <Stack space={32}>
      {stepTitle ? (
        <StepHeader title={stepTitle} description={subtitle} />
      ) : (
        <Stack space={4}>
          {!hideTitle && <Text4 medium as="h1">{result.name || t("title")}</Text4>}
          <Text2 regular color={skinVars.colors.textSecondary}>
            {subtitle}
          </Text2>
        </Stack>
      )}

      <Tabs
        selectedIndex={tab}
        onChange={setTab}
        tabs={[
          { text: `${t("tabFindings")} (${counts.findings})` },
          { text: t("tabProposedSolution") },
        ]}
      />

      {solutionUnavailable ? (
        <InlineError message={tCommon("error.description")} />
      ) : (
        <Stack space={32}>
          <div ref={graphSectionRef} style={{ scrollMarginTop: 16, scrollMarginBottom: 16 }}>
            <Stack space={16}>
              <Stack space={4}>
                <Text4 medium as="h2">{solved ? t("graphTitleSolution") : t("graphTitleFindings")}</Text4>
                <Text2 regular color={skinVars.colors.textSecondary}>{solved ? t("graphDescSolution") : t("graphDescFindings")}</Text2>
              </Stack>
              <CapabilityGraph
                analysisId={result.analysisId}
                solved={solved}
                nodes={solved && sol ? sol.nodes : result.nodes}
                edges={solved && sol ? sol.edges : result.edges}
                findings={solved && sol ? openFindings : findings}
                name={result.name}
                attacks={solved && sol ? sol.attacks : result.attacks}
                appliedControlCount={solved && sol ? sol.appliedControlCount : undefined}
                nodeControlInfo={solved && sol ? sol.nodeControlInfo : undefined}
                edgeControlInfo={solved && sol ? sol.edgeControlInfo : undefined}
                onToggleView={() => setTab(solved ? 0 : 1)}
                solutionAvailable={Boolean(sol)}
                findingLabelById={labelById}
                selectedFindingId={selectedFindingId}
                onSelectFinding={selectFinding}
                onClearSelection={clearSelection}
              />
            </Stack>
          </div>

          <Stack space={16}>
            <Text4 medium as="h2">{solved ? t("metricsTitleSolution") : t("metricsTitleFindings")}</Text4>
            {!solved ? (
              <Grid columns={{ minSize: 150 }} gap={16}>
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <SEVERITY_STYLES.critical.Icon size={18} color={severityAccentColor("critical", isDarkMode)} />
                    </Circle>
                  }
                  title={t("kpis.critical")}
                  slot={<Text6 color={severityAccentColor("critical", isDarkMode)}>{counts.critical}</Text6>}
                />
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <SEVERITY_STYLES.high.Icon size={18} color={severityAccentColor("high", isDarkMode)} />
                    </Circle>
                  }
                  title={t("kpis.high")}
                  slot={<Text6 color={severityAccentColor("high", isDarkMode)}>{counts.high}</Text6>}
                />
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <SEVERITY_STYLES.medium.Icon size={18} color={severityAccentColor("medium", isDarkMode)} />
                    </Circle>
                  }
                  title={t("kpis.medium")}
                  slot={<Text6 color={severityAccentColor("medium", isDarkMode)}>{counts.medium}</Text6>}
                />
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <SEVERITY_STYLES.low.Icon size={18} color={severityAccentColor("low", isDarkMode)} />
                    </Circle>
                  }
                  title={t("kpis.low")}
                  slot={<Text6 color={severityAccentColor("low", isDarkMode)}>{counts.low}</Text6>}
                />
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <IconTargetRegular size={18} color={severityAccentColor("critical", isDarkMode)} />
                    </Circle>
                  }
                  title={t("kpis.maxScore")}
                  slot={<Text6 color={severityAccentColor("critical", isDarkMode)}>{counts.maxScore}</Text6>}
                />
                <DataCard
                  width="100%"
                  asset={
                    <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                      <IconRobotRegular size={18} color={skinVars.colors.neutralHigh} />
                    </Circle>
                  }
                  title={t("kpis.agents")}
                  slot={<Text6 color={skinVars.colors.neutralHigh}>{counts.agents}</Text6>}
                />
              </Grid>
            ) : (
              sol && (
                <Inline space={16} alignItems="center" expand={[0, 2]}>
                  <BeforeAfterCard
                    label={t("before")}
                    Icon={SEVERITY_STYLES.critical.Icon}
                    color={severityAccentColor("critical", isDarkMode)}
                    rows={[
                      { label: t("beforeAfter.findingCount"), value: sol.beforeAfter.before.findingCount, color: severityAccentColor("critical", isDarkMode) },
                      { label: t("beforeAfter.criticalCount"), value: sol.beforeAfter.before.criticalCount, color: severityAccentColor("critical", isDarkMode) },
                      { label: t("beforeAfter.maxScore"), value: sol.beforeAfter.before.maxScore, color: severityAccentColor("critical", isDarkMode) },
                    ]}
                  />
                  <IconArrowLineRightRegular color={skinVars.colors.brand} />
                  <BeforeAfterCard
                    label={t("after")}
                    Icon={IconShieldCheckedOkRegular}
                    color={severityAccentColor("none", isDarkMode)}
                    headerBadge={{
                      label: t("beforeAfter.riskReduction"),
                      value: `-${sol.beforeAfter.after.riskReductionPct}%`,
                      color: severityAccentColor("none", isDarkMode),
                    }}
                    rows={[
                      { label: t("beforeAfter.findingCount"), value: sol.beforeAfter.after.findingCount, color: severityAccentColor("none", isDarkMode) },
                      { label: t("beforeAfter.criticalCount"), value: sol.beforeAfter.after.criticalCount, color: severityAccentColor("none", isDarkMode) },
                      { label: t("beforeAfter.maxScore"), value: sol.beforeAfter.after.maxScore, color: severityAccentColor("none", isDarkMode) },
                    ]}
                  />
                </Inline>
              )
            )}
          </Stack>

          {!solved && result.solution?.chokepointRec && (
            <ChokepointCallout rec={result.solution.chokepointRec} />
          )}

          {!solved ? (
            findingGroups.length > 0 && (
              <BoxedAccordion>
                {findingGroups.map(({ cls, items }) => (
                  <BoxedAccordionItem
                    key={cls}
                    title={cls === "attack" ? t("attackFindingsTitle") : t("hygieneTitle")}
                    right={<Tag type="inactive" small>{`${items.length}`}</Tag>}
                    content={
                      <Stack space={12}>
                        {items.map((f: Finding) => (
                          <FindingCard
                            key={f.id}
                            finding={f}
                            label={labelById.get(f.id) ?? f.ruleId}
                            nodesById={nodesById}
                            isDarkMode={isDarkMode}
                            tSeverity={tSeverity}
                            scoreLabel={t("tableHeaders.score")}
                            routeHint={t("showRouteHint")}
                            selected={f.id === selectedFindingId}
                            onSelect={f.path.length > 0 ? selectFinding : undefined}
                          />
                        ))}
                      </Stack>
                    }
                  />
                ))}
              </BoxedAccordion>
            )
          ) : (
            sol && (
              <BoxedAccordion>
                {[
                  sol.remediation.length > 0 ? (
                    <BoxedAccordionItem
                      key="controls"
                      title={t("controlsTitle")}
                      right={<Tag type="active" small>{`${sol.remediation.length}`}</Tag>}
                      content={
                        <Timeline>
                          {sol.remediation.map((step) => (
                            <TimelineItem
                              key={step.title}
                              state={step.done ? "completed" : "active"}
                              asset={step.done ? { kind: "circled-icon", Icon: IconCheckFilled } : undefined}
                            >
                              <Stack space={2}>
                                <Text2 medium>{step.title}</Text2>
                                {step.desc.map((line, i) => (
                                  <Text1 key={i} regular color={skinVars.colors.textSecondary}>{line}</Text1>
                                ))}
                              </Stack>
                            </TimelineItem>
                          ))}
                        </Timeline>
                      }
                    />
                  ) : null,
                  <BoxedAccordionItem
                    key="resolved"
                    title={t("resolved")}
                    right={<Tag type="success" small>{`${resolvedFindings.length}`}</Tag>}
                    content={
                      <Stack space={8}>
                        {resolvedFindings.map((f) => (
                          <Boxed key={f.id} dataAttributes={{ testid: "resolved-finding" }}>
                            <Box padding={16}>
                              <Stack space={8}>
                                <Inline space={8} alignItems="center" wrap verticalSpace={4}>
                                  <IconCheckFilled color={skinVars.colors.success} />
                                  <Text2 medium>{labelById.get(f.id) ?? f.ruleId}</Text2>
                                  <FindingId id={f.id} />
                                </Inline>
                                <Stack space={4}>
                                  <Text2 regular>{f.title}</Text2>
                                  <FindingRoute path={f.path} nodesById={nodesById} />
                                </Stack>
                                <Inline space={4} wrap verticalSpace={4}>
                                  {f.controls?.map((c) => <Tag key={c} type="success" small>{c}</Tag>)}
                                </Inline>
                              </Stack>
                            </Box>
                          </Boxed>
                        ))}
                      </Stack>
                    }
                  />,
                ].filter(Boolean)}
              </BoxedAccordion>
            )
          )}

          <Boxed>
            <Box paddingX={20} paddingY={20}>
              <Stack space={16}>
                <Inline space={12} alignItems="center">
                  <Circle size={32} backgroundColor={skinVars.colors.neutralLow}>
                    <IconDownloadRegular size={18} color={skinVars.colors.brand} />
                  </Circle>
                  <Stack space={2}>
                    <Text2 medium>{solved ? t("exportTitleSolution") : t("exportTitleFindings")}</Text2>
                    <Text1 regular color={skinVars.colors.textSecondary}>
                      {solved ? t("exportDescSolution") : t("exportDescFindings")}
                    </Text1>
                  </Stack>
                </Inline>
                <Inline space={12} wrap verticalSpace={12}>
                  <ButtonPrimary
                    small
                    onPress={() => downloadMarkdownReport(result, view)}
                    StartIcon={IconDownloadRegular}
                  >
                    {t("exportReportMd")}
                  </ButtonPrimary>
                  <ButtonSecondary
                    small
                    onPress={() =>
                      downloadGraphJson(
                        result,
                        view,
                        solved && sol ? sol.nodes : result.nodes,
                        solved && sol ? sol.edges : result.edges,
                        solved && sol ? sol.attacks : result.attacks,
                      )
                    }
                    StartIcon={IconDownloadRegular}
                  >
                    {t("exportGraphJson")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    small
                    onPress={() => downloadFindingsJson(result)}
                    StartIcon={IconDownloadRegular}
                  >
                    {t("exportFindingsJson")}
                  </ButtonSecondary>
                  <ButtonSecondary
                    small
                    onPress={() => downloadYaml(view, result)}
                    StartIcon={IconDownloadRegular}
                  >
                    {t("exportButton")}
                  </ButtonSecondary>
                </Inline>
              </Stack>
            </Box>
          </Boxed>
        </Stack>
      )}
    </Stack>
  );
}

export default ResultsStep;
