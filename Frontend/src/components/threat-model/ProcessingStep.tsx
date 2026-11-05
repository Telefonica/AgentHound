import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Box,
  Boxed,
  ButtonPrimary,
  Callout,
  IconAlertFilled,
  IconCheckFilled,
  IconRocketRegular,
  Inline,
  ProgressBar,
  Spinner,
  Stack,
  Text1,
  Text2,
  Text3,
  Text4,
  Text6,
  skinVars,
} from "@telefonica/mistica";
import { REASONING } from "@/lib/threatModelData";

const STEP_INTERVAL_MS = 640;
const ELAPSED_TICK_MS = 500;

/** Formats a duration in milliseconds as HH:MM:SS. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

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

  // Elapsed time since the analysis started (or was last retried). It stops
  // ticking once the step completes or fails.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const stopped = complete || Boolean(error);
  useEffect(() => {
    if (stopped) return undefined;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [stopped, startedAt]);

  const handleRetry = () => {
    setStartedAt(Date.now());
    setElapsedMs(0);
    onRetry();
  };

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
        {complete && counts && (
          <Text2 regular color={skinVars.colors.textSecondary}>
            {t("doneDesc", counts)}
          </Text2>
        )}
        {error && (
          <Callout
            variant="default"
            title={t("errorTitle")}
            description={error}
            asset={<IconAlertFilled color={skinVars.colors.error} />}
            button={
              <ButtonPrimary small onPress={handleRetry}>
                {tCommon("actions.retry")}
              </ButtonPrimary>
            }
          />
        )}
      </Stack>

      <Boxed>
        <Box paddingX={32} paddingY={32}>
          <Stack space={12}>
            <Stack space={40}>
              <Inline space={16} alignItems="center">
                <IconRocketRegular size={24} color={skinVars.colors.brand} />
                <Text3 regular>{t("progressLabel")}</Text3>
              </Inline>
              <Stack space={24}>
                <Inline space="between" alignItems="center">
                  <Text2 regular color={skinVars.colors.textSecondary}>
                    {t("subtitle")}
                  </Text2>
                  <Text1 regular color={skinVars.colors.textSecondary}>
                    {t("elapsedTime", { time: formatElapsed(elapsedMs) })}
                  </Text1>
                </Inline>
                <ProgressBar progressPercent={percent} />
              </Stack>
            </Stack>
            <Text6>{percent}%</Text6>
          </Stack>
        </Box>
      </Boxed>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Boxed height="100%">
          <div style={{ height: "100%", overflowY: "auto" }}>
            <Box paddingX={20} paddingY={20}>
              <Stack space={4}>
                {REASONING.slice(0, index).map((line, i) => {
                  const isActive = i === index - 1 && !complete;
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
    </div>
  );
}

export default ProcessingStep;
