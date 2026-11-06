import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Box,
  Boxed,
  ButtonPrimary,
  Callout,
  IconAlertFilled,
  IconCheckFilled,
  Inline,
  ProgressBar,
  Spinner,
  Stack,
  Text1,
  Text2,
  Text4,
  skinVars,
} from "@telefonica/mistica";
import { REASONING } from "@/lib/threatModelData";

const STEP_INTERVAL_MS = 640;

interface ProcessingStepProps {
  /** True once the backend analysis request has resolved successfully. */
  requestDone: boolean;
  /** Non-null when the analysis request failed; holds a human-readable message. */
  error: string | null;
  /** Re-run the analysis after a failure. */
  onRetry: () => void;
  /** Real analysis counts, available once the request resolves; used for the completion subtitle. */
  counts: { findings: number; critical: number; maxScore: number; agents: number } | null;
  onComplete?: () => void;
}

function ProcessingStep({ requestDone, error, onRetry, counts, onComplete }: ProcessingStepProps) {
  const t = useTranslations("processing");
  const tCommon = useTranslations("common");
  const [index, setIndex] = useState(1);

  // Cosmetic reasoning animation. It walks through the reasoning lines but stops
  // one short of the end until the real request resolves, so the UI never claims
  // completion before the backend does.
  useEffect(() => {
    if (error) return;
    const atLastStep = index >= REASONING.length;
    if (!atLastStep && (index < REASONING.length - 1 || requestDone)) {
      const timer = setTimeout(() => setIndex((i) => i + 1), STEP_INTERVAL_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [index, requestDone, error]);

  const percent = error ? 100 : Math.round((index / REASONING.length) * 100);
  const complete = !error && index >= REASONING.length && requestDone;

  useEffect(() => {
    if (complete) onComplete?.();
  }, [complete, onComplete]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 24 }}>
      <Stack space={12}>
        <Inline space={12} alignItems="center">
          {!error &&
            (complete ? (
              <IconCheckFilled size={22} color={skinVars.colors.brand} />
            ) : (
              <Spinner size={22} color={skinVars.colors.brand} />
            ))}
          <Text4 medium as="h1">
            {error ? t("errorTitle") : complete ? t("doneTitle") : t("title")}
          </Text4>
        </Inline>
        <Text2 regular color={skinVars.colors.textSecondary}>
          {complete && counts ? t("doneDesc", counts) : t("subtitle")}
        </Text2>
      </Stack>

      <Stack space={8}>
        <Inline space="between">
          <Text1 regular color={skinVars.colors.textSecondary}>{t("progressLabel")}</Text1>
          <Text1 regular color={skinVars.colors.textSecondary}>{percent}%</Text1>
        </Inline>
        <ProgressBar progressPercent={percent} />
      </Stack>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Boxed height="100%">
          <div style={{ height: "100%", overflowY: "auto" }}>
            <Box paddingX={20} paddingY={20}>
              <Stack space={4}>
                {REASONING.slice(0, index).map((line, i) => {
                  const isActive = i === index - 1 && !complete && !error;
                  const isFinal = complete && i === REASONING.length - 1;
                  const lineColor = isActive || isFinal ? skinVars.colors.textPrimary : skinVars.colors.textSecondary;
                  return (
                    <Inline key={line} space={8} alignItems="center">
                      {isActive ? (
                        <Spinner size={14} color={skinVars.colors.brand} />
                      ) : isFinal ? (
                        <IconCheckFilled size={14} color={skinVars.colors.brand} />
                      ) : (
                        <Box width={14}>
                          <Text1 regular color={lineColor} textAlign="center">–</Text1>
                        </Box>
                      )}
                      <Text1 regular color={lineColor}>
                        {line}
                      </Text1>
                    </Inline>
                  );
                })}
              </Stack>
            </Box>
          </div>
        </Boxed>
      </div>

      {error && (
        <Callout
          variant="default"
          title={t("errorTitle")}
          description={error}
          asset={<IconAlertFilled color={skinVars.colors.error} />}
          button={
            <ButtonPrimary small onPress={onRetry}>
              {tCommon("actions.retry")}
            </ButtonPrimary>
          }
        />
      )}
    </div>
  );
}

export default ProcessingStep;
