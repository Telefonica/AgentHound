"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Align,
  Box,
  Boxed,
  ButtonPrimary,
  DataCard,
  Grid,
  IconAddMoreRegular,
  Inline,
  Row,
  RowList,
  Spinner,
  Stack,
  Tag,
  Text2,
  Text6,
  Text7,
  Text8,
  skinVars,
  useTheme,
} from "@telefonica/mistica";
import ContentLayout from "@/components/layout/ContentLayout";
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
    { key: "totalTests", value: agg.totalTests, color: skinVars.colors.neutralHigh },
    { key: "totalFindings", value: agg.totalFindings, color: skinVars.colors.neutralHigh },
    { key: "totalCritical", value: agg.totalCritical, color: criticalColor },
    { key: "criticalRate", value: `${agg.criticalRate}%`, color: criticalColor },
    { key: "avgMaxScore", value: agg.avgMaxScore, color: skinVars.colors.neutralHigh },
  ] as const;

  // Order of the stacked severity segments in each framework bar, worst first.
  const SEVERITY_SEGMENTS = ["critical", "high", "medium", "low"] as const;

  return (
    <ContentLayout paddingTop={107}>
      <Box paddingX={32}>
        <Stack space={48}>
          <Stack space={4}>
            <Text8 as="h1" color={skinVars.colors.neutralHigh}>
              {t("title")}
            </Text8>
            <Text2 regular color={skinVars.colors.textSecondary}>
              {t("subtitle")}
            </Text2>
          </Stack>

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
                  <ButtonPrimary
                    StartIcon={IconAddMoreRegular}
                    onPress={() => router.push("/tests/new")}
                  >
                    {tOverview("newThreatModel")}
                  </ButtonPrimary>
                </Stack>
              </Box>
            </Boxed>
          ) : (
            <Stack space={48}>
              <Grid columns={5} gap={16}>
                {kpis.map(({ key, value, color }) => (
                  <DataCard
                    key={key}
                    width="100%"
                    title={t(`kpis.${key}`)}
                    slot={
                      <Box paddingTop={40} paddingBottom={24}>
                        <Text7 color={color}>{value}</Text7>
                      </Box>
                    }
                  />
                ))}
              </Grid>

              <Stack space={16}>
                <Text6 as="h2">{t("worstTitle")}</Text6>
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
                                  <Tag backgroundColor={style.background} textColor={style.text}>
                                    {tSeverity(test.severity)}
                                  </Tag>
                                </Inline>
                              </Align>
                            }
                          />
                        );
                      })}
                    </RowList>
                  </Box>
                </Boxed>
              </Stack>

              <Stack space={16}>
                <Inline space="between" alignItems="center">
                  <Text6 as="h2">{t("frameworkTitle")}</Text6>
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
                </Inline>
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
            </Stack>
          )}
        </Stack>
      </Box>
    </ContentLayout>
  );
}
