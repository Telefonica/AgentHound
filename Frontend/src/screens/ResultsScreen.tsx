"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Align,
  Box,
  Boxed,
  ButtonPrimary,
  Grid,
  IconAddMoreRegular,
  IconChemistryFilled,
  IconChemistryRegular,
  IconPodiumRegular,
  IconSearchRegular,
  IconWarningFilled,
  Inline,
  Row,
  RowList,
  Spinner,
  Stack,
  Tabs,
  Text2,
  Text6,
  skinVars,
  useTheme,
} from "@telefonica/mistica";
import DashboardPage from "@/components/layout/DashboardPage";
import KpiCard from "@/components/ui/KpiCard";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import InlineError from "@/components/ui/InlineError";
import { listAnalyses } from "@/lib/api/agentHound";
import type { AnalysisListItem } from "@/lib/api/types";
import { aggregateResults } from "@/lib/results/aggregate";
import { SEVERITY_STYLES } from "@/lib/severity";

export default function ResultsScreen() {
  const t = useTranslations("results.dashboard");
  const tSeverity = useTranslations("overview.severity");
  const tOverview = useTranslations("overview");
  const { isDarkMode } = useTheme();
  const router = useRouter();

  const [items, setItems] = useState<AnalysisListItem[]>([]);
  // Start loading so the first paint is the spinner, not a flash of empty state.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped by retry to re-run the fetch effect.
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { analyses } = await listAnalyses();
        if (!active) return;
        setItems(analyses);
        setError(false);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    // Ignore a resolved request if the component unmounted or a retry
    // superseded it, so stale results never overwrite fresh state.
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Retry is a user event, so showing the spinner synchronously is fine here.
  const retry = () => {
    setLoading(true);
    setError(false);
    setReloadKey((k) => k + 1);
  };

  const agg = useMemo(() => aggregateResults(items), [items]);
  const critical = SEVERITY_STYLES.critical;
  const criticalColor = isDarkMode ? critical.accentDark : critical.accentLight;

  const kpis = [
    {
      key: "totalTests",
      value: agg.totalTests,
      color: skinVars.colors.neutralHigh,
      Icon: IconChemistryRegular,
      iconColor: skinVars.colors.brand,
    },
    {
      key: "criticalRate",
      value: agg.criticalRate,
      unit: "%",
      color: criticalColor,
      Icon: IconChemistryFilled,
      iconColor: criticalColor,
      info: true,
    },
    {
      key: "totalFindings",
      value: agg.totalFindings,
      color: skinVars.colors.neutralHigh,
      Icon: IconSearchRegular,
      iconColor: skinVars.colors.textSecondary,
    },
    {
      key: "totalCritical",
      value: agg.totalCritical,
      color: criticalColor,
      Icon: IconWarningFilled,
      iconColor: criticalColor,
    },
    {
      key: "avgMaxScore",
      value: agg.avgMaxScore,
      color: skinVars.colors.neutralHigh,
      Icon: IconPodiumRegular,
      iconColor: skinVars.colors.brand,
      info: true,
    },
  ] as const;

  // Order of the stacked severity segments in each framework bar, worst first.
  const SEVERITY_SEGMENTS = ["critical", "high", "medium", "low"] as const;

  const showKpis = !loading && !error && agg.totalTests > 0;
  const kpiRow = showKpis ? (
    <Grid columns={5} gap={16}>
      {kpis.map((kpi) => (
        <KpiCard
          key={kpi.key}
          Icon={kpi.Icon}
          iconColor={kpi.iconColor}
          title={t(`kpis.${kpi.key}`)}
          value={kpi.value}
          unit={"unit" in kpi ? kpi.unit : undefined}
          info={
            "info" in kpi
              ? {
                  label: t("kpiInfoLabel", { name: t(`kpis.${kpi.key}`) }),
                  description: t(`kpiInfo.${kpi.key}`),
                }
              : undefined
          }
          valueColor={kpi.color}
        />
      ))}
    </Grid>
  ) : undefined;

  return (
    <DashboardPage title={t("title")} kpis={kpiRow}>
      {loading ? (
        <Box paddingY={48}>
          <Align x="center">
            <Spinner size={32} color={skinVars.colors.brand} />
          </Align>
        </Box>
      ) : error ? (
        <InlineError message={t("loadError")} onRetry={retry} />
      ) : agg.totalTests === 0 ? (
        <Boxed>
          <Box padding={24}>
            <Stack space={24}>
              <Stack space={8}>
                <Text6>{t("emptyTitle")}</Text6>
                <Text2 regular color={skinVars.colors.textSecondary}>
                  {t("emptyDescription")}
                </Text2>
              </Stack>
              <ButtonPrimary StartIcon={IconAddMoreRegular} onPress={() => router.push("/tests/new")}>
                {tOverview("newThreatModel")}
              </ButtonPrimary>
            </Stack>
          </Box>
        </Boxed>
      ) : (
        <Stack space={16}>
          <Tabs
            selectedIndex={tab}
            onChange={setTab}
            tabs={[{ text: t("worstTitle") }, { text: t("frameworkTitle") }]}
          />
          {tab === 0 ? (
            <Boxed>
              <Box paddingX={8} paddingY={8}>
                <RowList>
                  {agg.worstTests.map((test) => {
                    const style = SEVERITY_STYLES[test.severity];
                    return (
                      <Row
                        key={test.id}
                        title={test.name}
                        description={`${test.framework} · ${t("maxScoreLabel", { score: test.maxScore })}`}
                        onPress={() => router.push(`/tests/${test.id}?from=results`)}
                        right={
                          <Align y="center" height="100%">
                            <Inline space={8} alignItems="center">
                              <Box width={20}>
                                <Text2
                                  medium
                                  color={isDarkMode ? style.accentDark : style.accentLight}
                                  textAlign="right"
                                >
                                  {test.findings > 0 ? test.findings : ""}
                                </Text2>
                              </Box>
                              <SeverityBadge severity={test.severity} withIcon>
                                {tSeverity(test.severity)}
                              </SeverityBadge>
                            </Inline>
                          </Align>
                        }
                      />
                    );
                  })}
                </RowList>
              </Box>
            </Boxed>
          ) : (
            <Stack space={16}>
              <Align x="end">
                <Inline space={16} alignItems="center" wrap verticalSpace={8}>
                  {SEVERITY_SEGMENTS.map((sev) => (
                    <Inline key={sev} space={4} alignItems="center">
                      <span
                        style={{
                          display: "block",
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          backgroundColor: SEVERITY_STYLES[sev].background,
                        }}
                      />
                      <Text2 regular color={skinVars.colors.textSecondary}>
                        {tSeverity(sev)}
                      </Text2>
                    </Inline>
                  ))}
                </Inline>
              </Align>
              <Boxed>
                <Box padding={24}>
                  <Stack space={24}>
                    {agg.byFramework.map((fw) => (
                      <Stack space={8} key={fw.framework}>
                        <Inline space="between" alignItems="baseline">
                          <Text2 medium color={skinVars.colors.neutralHigh}>
                            {fw.framework}
                          </Text2>
                          <Text2 regular color={skinVars.colors.textSecondary}>
                            {t("frameworkRow", { tests: fw.tests, findings: fw.findings })}
                          </Text2>
                        </Inline>
                        <div
                          style={{
                            display: "flex",
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: skinVars.colors.neutralLow,
                            overflow: "hidden",
                          }}
                        >
                          {fw.findings > 0 &&
                            SEVERITY_SEGMENTS.map((sev) => {
                              const count = fw[sev];
                              if (count === 0) return null;
                              return (
                                <div
                                  key={sev}
                                  style={{
                                    height: "100%",
                                    width: `${(100 * count) / fw.findings}%`,
                                    backgroundColor: SEVERITY_STYLES[sev].background,
                                  }}
                                />
                              );
                            })}
                        </div>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </Boxed>
            </Stack>
          )}
        </Stack>
      )}
    </DashboardPage>
  );
}
