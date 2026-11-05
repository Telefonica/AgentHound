"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ContentLayout from "@/components/layout/ContentLayout";
import {
  Box,
  Stack,
  Inline,
  Align,
  Grid,
  Spinner,
  Text2,
  Text3,
  Text6,
  Text8,
  Tabs,
  Boxed,
  RowList,
  Row,
  ButtonPrimary,
  ButtonSecondary,
  IconAddMoreRegular,
  IconAddMoreFilled,
  IconArrowDownFilled,
  IconCheckedFilled,
  IconListRegular,
  IconTrashCanRegular,
  IconWarningFilled,
  skinVars,
  useDialog,
  useTheme,
} from "@telefonica/mistica";
import { useLocale, useTranslations } from "next-intl";
import InlineError from "@/components/ui/InlineError";
import Pagination from "@/components/ui/Pagination";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import { deleteAnalysis, listAnalyses } from "@/lib/api/agentHound";
import { toAnalysisSummaryItem, type AnalysisSummaryItem } from "@/lib/api/adapters";
import { SEVERITY_STYLES } from "@/lib/severity";

export default function Page() {
  const t = useTranslations("overview");
  const locale = useLocale();
  const { isDarkMode } = useTheme();
  const router = useRouter();
  const goToNewThreatModel = () => router.push("/tests/new");

  const [models, setModels] = useState<AnalysisSummaryItem[]>([]);
  // Start in the loading state so the first paint shows the spinner, not a
  // flash of the empty state before the request resolves.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped by retry to re-run the fetch effect (rather than duplicating the
  // request logic in an event handler).
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState(0);
  // Paginate the tests list: pagination only shows past a full first page.
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { analyses } = await listAnalyses();
        if (!active) return;
        setModels(analyses.map(toAnalysisSummaryItem));
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

  // Retry is a user event, so showing the spinner synchronously is fine here;
  // bumping reloadKey re-runs the effect above.
  const retry = () => {
    setLoading(true);
    setError(false);
    setReloadKey((k) => k + 1);
  };

  const { confirm, alert } = useDialog();

  const performDelete = async (id: string) => {
    try {
      await deleteAnalysis(id);
      // Drop it from local state instead of refetching: the list is already
      // authoritative and this keeps the row from lingering during a round-trip.
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch {
      alert({ title: t("delete.errorTitle"), message: t("delete.errorMessage") });
    }
  };

  const requestDelete = (model: AnalysisSummaryItem) => {
    confirm({
      title: t("delete.title"),
      message: t("delete.message", { name: model.name }),
      acceptText: t("delete.confirm"),
      cancelText: t("delete.cancel"),
      destructive: true,
      onAccept: () => void performDelete(model.id),
    });
  };

  // Constructing an Intl formatter is expensive; keep one per locale rather than
  // rebuilding it on every render.
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const formatDate = (iso: string) => {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : dateFormatter.format(parsed);
  };

  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(models.length / PAGE_SIZE);
  // Clamp in case the list shrank (e.g. after a retry) below the current page.
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pagedModels = models.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // The three severity buckets partition the list: every severity falls in
  // exactly one, so they always add up to the total.
  const kpis = [
    { key: "totalModels", value: models.length, severity: null, Icon: IconListRegular },
    {
      key: "critical",
      value: models.filter((m) => m.severity === "critical" || m.severity === "high").length,
      severity: "critical" as const,
      Icon: IconWarningFilled,
    },
    {
      key: "medium",
      value: models.filter((m) => m.severity === "medium" || m.severity === "low").length,
      severity: "medium" as const,
      Icon: IconArrowDownFilled,
    },
    {
      key: "clean",
      value: models.filter((m) => m.severity === "none").length,
      severity: "none" as const,
      Icon: IconCheckedFilled,
    },
  ] as const;

  // The KPI cards sit across the top edge of the general container: this many
  // pixels of each card stick out above it. The mockup has 45; 48 is the nearest
  // step of Mistica's spacing scale, which is what Box padding accepts.
  const KPI_OVERLAP = 48;
  const showKpis = !loading && !error;

  return (
    // The title sits 48 from the top like on the wizard, so the page starts at 0.
    <ContentLayout paddingTop={0}>
      <Box paddingX={32} paddingBottom={32}>
        {/* From 1920px up the page stops at 1440px, the same cap as the wizard's
            container. It lives on a plain wrapper because Mistica's own (unlayered)
            styles win over a utility class set on its components. */}
        <div className="w-full min-[1920px]:max-w-[1440px]">
          <Box paddingTop={48} paddingBottom={40}>
            <Inline space="between" alignItems="center">
              <Text8 as="h1" color={skinVars.colors.neutralHigh}>
                {t("title")}
              </Text8>
              <ButtonPrimary StartIcon={IconAddMoreRegular} onPress={goToNewThreatModel}>
                {t("newThreatModel")}
              </ButtonPrimary>
            </Inline>
          </Box>

          {/* Two layers share one grid cell: the container (a Boxed, which clips
              whatever pokes out of it) and, over it, the content. The content is
              taller than the container by KPI_OVERLAP, so the KPI cards cross its
              top edge, and they stay 40 under the title like anything that follows
              the header. Mistica has no layering primitive, hence the plain divs. */}
          <div style={{ display: "grid" }}>
            <div
              aria-hidden="true"
              style={{ gridArea: "1 / 1", display: "grid", paddingTop: showKpis ? KPI_OVERLAP : 0 }}
            >
              <Boxed width="100%">{null}</Boxed>
            </div>
            <div style={{ gridArea: "1 / 1", position: "relative" }}>
              <Box paddingX={32} paddingTop={showKpis ? 0 : 40} paddingBottom={40}>
                <Stack space={40}>
                  {showKpis && (
                    <Grid columns={4} gap={16}>
                      {kpis.map(({ key, value, severity, Icon }) => {
                        const style = severity ? SEVERITY_STYLES[severity] : null;
                        const color = style
                          ? isDarkMode
                            ? style.accentDark
                            : style.accentLight
                          : skinVars.colors.neutralHigh;
                        return (
                          <Boxed key={key} width="100%" height="100%">
                            <Box padding={24}>
                              <Stack space={16}>
                                <Icon size={24} color={style ? color : skinVars.colors.brand} />
                                <Text3 medium color={skinVars.colors.neutralHigh}>
                                  {t(`kpis.${key}`)}
                                </Text3>
                                <Text8 color={color}>{value}</Text8>
                              </Stack>
                            </Box>
                          </Boxed>
                        );
                      })}
                    </Grid>
                  )}

                  <Stack space={16}>
                    <Box width={145}>
                      <Tabs selectedIndex={tab} onChange={setTab} tabs={[{ text: t("listTitle") }]} />
                    </Box>
                    {loading ? (
                      <Box paddingY={48}>
                        <Align x="center">
                          <Spinner size={32} color={skinVars.colors.brand} />
                        </Align>
                      </Box>
                    ) : error ? (
                      <InlineError message={t("loadError")} onRetry={retry} />
                    ) : models.length === 0 ? (
                      <Boxed>
                        <Box padding={24}>
                          <Stack space={32}>
                            <Stack space={16}>
                              <Text6>{t("emptyTitle")}</Text6>
                              <Box width={485}>
                                <Text2 regular color={skinVars.colors.textSecondary}>
                                  {t("description")}
                                </Text2>
                              </Box>
                            </Stack>
                            <ButtonSecondary StartIcon={IconAddMoreFilled} onPress={goToNewThreatModel}>
                              {t("newThreatModel")}
                            </ButtonSecondary>
                          </Stack>
                        </Box>
                      </Boxed>
                    ) : (
                      <Stack space={24}>
                        <Boxed>
                          <Box paddingX={8} paddingY={8}>
                            <RowList>
                              {pagedModels.map((model) => {
                                const style = SEVERITY_STYLES[model.severity];
                                return (
                                  <Row
                                    key={model.id}
                                    title={model.name}
                                    description={`${model.framework} · ${formatDate(model.uploadedAt)}`}
                                    right={
                                      <Align y="center" height="100%">
                                        <Inline space={8} alignItems="center">
                                          <Box width={20}>
                                            <Text2
                                              medium
                                              color={isDarkMode ? style.accentDark : style.accentLight}
                                              textAlign="right"
                                            >
                                              {model.findings > 0 ? model.findings : ""}
                                            </Text2>
                                          </Box>
                                          <SeverityBadge severity={model.severity} withIcon>
                                            {t(`severity.${model.severity}`)}
                                          </SeverityBadge>
                                        </Inline>
                                      </Align>
                                    }
                                    // `iconButton` renders the action outside the row's touchable
                                    // (Mistica's dual-action row), so the delete button isn't a
                                    // <button> nested inside the row's own <button>.
                                    iconButton={{
                                      Icon: IconTrashCanRegular,
                                      type: "danger",
                                      backgroundType: "transparent",
                                      "aria-label": t("delete.action", { name: model.name }),
                                      onPress: () => requestDelete(model),
                                    }}
                                    onPress={() => router.push(`/tests/${model.id}`)}
                                  />
                                );
                              })}
                            </RowList>
                          </Box>
                        </Boxed>
                        <Align x="start">
                          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
                        </Align>
                      </Stack>
                    )}
                  </Stack>
                </Stack>
              </Box>
            </div>
          </div>
        </div>
      </Box>
    </ContentLayout>
  );
}
