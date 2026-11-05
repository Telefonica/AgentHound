import { IconCheckRegular, Text2, skinVars } from "@telefonica/mistica";

const CIRCLE_SIZE = 36;
const LINE_THICKNESS = 4;
const LINE_GAP = 8;
const LABEL_GAP = 12;
const LABEL_HEIGHT = 24;

interface WizardStepperProps {
  /** Step labels, in order. */
  steps: string[];
  /** Current step, 1-based. */
  currentStep: number;
  "aria-label": string;
}

/** Horizontal position of the center of a step's circle, as a CSS length. */
function centerOf(index: number, count: number): string {
  if (index === 0) return `${CIRCLE_SIZE / 2}px`;
  if (index === count - 1) return `calc(100% - ${CIRCLE_SIZE / 2}px)`;
  return `${(index / (count - 1)) * 100}%`;
}

/**
 * Numbered wizard stepper: one circle per step joined by lines, with the step
 * name underneath. The first and last steps sit on the edges, the rest are
 * spread evenly in between. Done steps are outlined in brand colour with a check, the current one is filled.
 */
function WizardStepper({ steps, currentStep, "aria-label": ariaLabel }: WizardStepperProps) {
  const count = steps.length;
  return (
    <ol
      aria-label={ariaLabel}
      style={{
        position: "relative",
        listStyle: "none",
        margin: 0,
        padding: 0,
        height: CIRCLE_SIZE + LABEL_GAP + LABEL_HEIGHT,
      }}
    >
      {steps.slice(0, -1).map((_, i) => (
        <li
          key={`line-${i}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: (CIRCLE_SIZE - LINE_THICKNESS) / 2,
            height: LINE_THICKNESS,
            borderRadius: LINE_THICKNESS / 2,
            left: `calc(${centerOf(i, count)} + ${CIRCLE_SIZE / 2 + LINE_GAP}px)`,
            right: `calc(100% - ${centerOf(i + 1, count)} + ${CIRCLE_SIZE / 2 + LINE_GAP}px)`,
            backgroundColor: i + 1 < currentStep ? skinVars.colors.brand : skinVars.colors.border,
          }}
        />
      ))}
      {steps.map((label, i) => {
        const number = i + 1;
        const isCurrent = number === currentStep;
        const isDone = number < currentStep;
        const align = i === 0 ? "flex-start" : i === count - 1 ? "flex-end" : "center";
        const shift = i === 0 ? "0" : i === count - 1 ? "-100%" : "-50%";
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            style={{
              position: "absolute",
              top: 0,
              left: i === 0 ? 0 : i === count - 1 ? "100%" : `${(i / (count - 1)) * 100}%`,
              transform: `translateX(${shift})`,
              width: "max-content",
              display: "flex",
              flexDirection: "column",
              alignItems: align,
              gap: LABEL_GAP,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: CIRCLE_SIZE,
                height: CIRCLE_SIZE,
                boxSizing: "border-box",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // current: solid brand; done: brand outline with a check; upcoming: grey outline
                backgroundColor: isCurrent ? skinVars.colors.brand : "transparent",
                border: isCurrent ? "none" : `2px solid ${isDone ? skinVars.colors.brand : skinVars.colors.borderHigh}`,
              }}
            >
              {isDone ? (
                <IconCheckRegular size={20} color={skinVars.colors.brand} />
              ) : (
                <Text2 regular color={isCurrent ? skinVars.colors.textPrimaryInverse : skinVars.colors.textSecondary}>
                  {number}
                </Text2>
              )}
            </span>
            <Text2 regular color={isCurrent || isDone ? skinVars.colors.textPrimary : skinVars.colors.textSecondary}>
              {label}
            </Text2>
          </li>
        );
      })}
    </ol>
  );
}

export default WizardStepper;
