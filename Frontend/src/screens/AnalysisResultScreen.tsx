"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Align,
  Box,
  Inline,
  IconArrowLineLeftLight,
  Spinner,
  Stack,
  Text2,
  Touchable,
  skinVars,
} from "@telefonica/mistica";
import ContentLayout from "@/components/layout/ContentLayout";
import ResultsStep from "@/components/threat-model/ResultsStep";
import InlineError from "@/components/ui/InlineError";
import { loadAnalysisResult } from "@/lib/api/loadAnalysis";
import type { AnalysisResult } from "@/lib/api/adapters";

/**
 * Standalone view of a stored analysis' results, reached by opening a row from
 * the overview or the results dashboard. Fetches the same Findings + Proposed
 * Solution the wizard shows on its last step and renders the shared
 * {@link ResultsStep}. `backTo` is the entry point, so the back link returns
 * where the user came from.
 */
function AnalysisResultScreen({
  analysisId,
  backTo = "overview",
}: {
  analysisId: string;
  backTo?: "overview" | "results";
}) {
  const t = useTranslations("overview");
  const tResults = useTranslations("results.dashboard");
  const router = useRouter();

  const backHref = backTo === "results" ? "/results" : "/overview";
  const backLabel = backTo === "results" ? tResults("back") : t("back");

  const [result, setResult] = useState<AnalysisResult | null>(null);
  // Start loading so the first paint is the spinner, not a flash of error.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped by retry to re-run the fetch effect.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await loadAnalysisResult(analysisId);
        if (!active) return;
        setResult(loaded);
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
  }, [analysisId, reloadKey]);

  // Retry is a user event, so showing the spinner synchronously is fine here;
  // bumping reloadKey re-runs the effect above.
  const retry = () => {
    setLoading(true);
    setError(false);
    setReloadKey((k) => k + 1);
  };

  return (
    <ContentLayout paddingTop={24}>
      <Box paddingX={32}>
        <Stack space={32}>
          <Inline space={0}>
            <Touchable onPress={() => router.push(backHref)}>
              <Inline space={4} alignItems="center">
                <IconArrowLineLeftLight size={16} color={skinVars.colors.textSecondary} />
                <Text2 regular color={skinVars.colors.textSecondary}>
                  {backLabel}
                </Text2>
              </Inline>
            </Touchable>
          </Inline>

          {loading ? (
            <Box paddingY={48}>
              <Align x="center">
                <Spinner size={32} color={skinVars.colors.brand} />
              </Align>
            </Box>
          ) : error ? (
            <InlineError message={t("loadTestError")} onRetry={retry} />
          ) : (
            <ResultsStep result={result} />
          )}
        </Stack>
      </Box>
    </ContentLayout>
  );
}

export default AnalysisResultScreen;
