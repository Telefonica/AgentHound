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
  Text6,
  skinVars,
} from "@telefonica/mistica";
import StepSection from "@/components/threat-model/StepSection";
import { REASONING } from "@/lib/threatModelData";

const STEP_INTERVAL_MS = 640;
const ELAPSED_TICK_MS = 500;

/** Formats a duration in milliseconds as HH:MM:SS. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

interface ElapsedTimeProps {
  /** When the analysis started (or was last retried), from `Date.now()`. */
  startedAt: number;
  /** True once the step completes or fails: the time freezes at that moment. */
  stopped: boolean;
}

/**
 * Elapsed time since `startedAt`. It keeps its own ticking state so only this
 * text re-renders every tick, not the whole step and its reasoning log.
 */
function ElapsedTime({ startedAt, stopped }: ElapsedTimeProps) {
  const t = useTranslations("processing");
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    // On stop, the tick above freezes the exact final time instead of the last
    // interval's value, which can be up to one tick behind.
    if (stopped) return undefined;
    const timer = setInterval(tick, ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [stopped, startedAt]);

  return (
    <Text1 regular color={skinVars.colors.textSecondary}>
      {t("elapsedTime", { time: formatElapsed(elapsedMs) })}
    </Text1>
  );
}

interface ProcessingStepProps {
  /** True once the backend analysis request has resolved successfully. */
  requestDone: boolean;
  /** Non-null when the analysis request failed; holds a human-readable message. */
  error: string | null;
  /** Re-run the analysis after a failure. */
  onRetry: () => void;
  onComplete?: () => void;
}

function ProcessingStep({ requestDone, error, onRetry, onComplete }: ProcessingStepProps) {
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

  // When the analysis started (or was last retried); ElapsedTime counts from it.
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const handleRetry = () => {
    setStartedAt(Date.now());
    onRetry();
  };

  // The header follows the step's state. On error the Callout below carries the
  // backend's message, so the header only names the failure.
  const title = error ? t("errorTitle") : complete ? t("doneTitle") : t("heading");
  const description = error ? undefined : complete ? t("doneDescription") : t("title");

  // Rendered inside the wizard's container. The header and the 32 gap to the
  // content come from StepSection; the progress card holds both the progress
  // summary and the reasoning log, 32 apart.
  return (
    <StepSection title={title} description={description}>
      <Stack space={24}>
        {error && (
          <Callout
            variant="default"
            description={error}
            asset={<IconAlertFilled color={skinVars.colors.error} />}
            button={
              <ButtonPrimary small onPress={handleRetry}>
                {tCommon("actions.retry")}
              </ButtonPrimary>
            }
          />
        )}

        <Boxed>
          <Box paddingX={32} paddingY={32}>
            <Stack space={32}>
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
                      <ElapsedTime startedAt={startedAt} stopped={complete || Boolean(error)} />
                    </Inline>
                    <ProgressBar progressPercent={percent} aria-label={t("progressLabel")} />
                  </Stack>
                </Stack>
                <Text6>{percent}%</Text6>
              </Stack>

              <Stack space={8}>
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
                          <Text1 regular color={lineColor} textAlign="center">
                            –
                          </Text1>
                        </Box>
                      )}
                      <Text1 regular color={lineColor}>
                        {line}
                      </Text1>
                    </Inline>
                  );
                })}
              </Stack>
            </Stack>
          </Box>
        </Boxed>
      </Stack>
    </StepSection>
  );
}

export default ProcessingStep;
