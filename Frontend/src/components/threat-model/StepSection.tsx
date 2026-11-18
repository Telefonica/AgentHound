import type { ReactNode } from "react";
import { Stack, Text3, Text5, skinVars } from "@telefonica/mistica";

interface StepHeaderProps {
  title: string;
  description?: string;
}

/**
 * Section header shared by every wizard step: a Text5 title with a Text3
 * paragraph underneath, 8 apart. Keeping it in one place is what guarantees the
 * same sizes in steps 1 to 4.
 */
export function StepHeader({ title, description }: StepHeaderProps) {
  return (
    <Stack space={8}>
      <Text5 as="h2">{title}</Text5>
      {description && (
        <Text3 regular as="p" color={skinVars.colors.textSecondary}>
          {description}
        </Text3>
      )}
    </Stack>
  );
}

interface StepSectionProps extends StepHeaderProps {
  children: ReactNode;
}

/** A step's header followed by its content, always 32 apart. */
function StepSection({ title, description, children }: StepSectionProps) {
  return (
    <Stack space={32}>
      <StepHeader title={title} description={description} />
      {children}
    </Stack>
  );
}

export default StepSection;
