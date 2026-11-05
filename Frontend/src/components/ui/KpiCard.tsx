import { Boxed, Stack, Text3, Text5, Text8, skinVars } from "@telefonica/mistica";
import type { IconProps } from "@telefonica/mistica";
import type { ReactElement } from "react";

interface KpiCardProps {
  Icon: (props: IconProps) => ReactElement;
  iconColor: string;
  title: string;
  value: string | number;
  /** Small suffix next to the figure, such as "%". */
  unit?: string;
  valueColor: string;
}

/**
 * One figure of a dashboard row: an icon, what is being counted and the figure
 * itself. Overview and Results share it so their KPI rows look the same.
 */
function KpiCard({ Icon, iconColor, title, value, unit, valueColor }: KpiCardProps) {
  return (
    <Boxed width="100%" height="100%">
      {/* Box can't take a height, so this column pins the figure to the bottom of the
          card: when a title wraps in a narrow card, the figures still line up. */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16, height: "100%", padding: 24, boxSizing: "border-box" }}>
        <Stack space={16}>
          <Icon size={24} color={iconColor} />
          <Text3 medium color={skinVars.colors.neutralHigh}>
            {title}
          </Text3>
        </Stack>
        <Text8 color={valueColor}>
          {value}
          {unit && (
            <Text5 as="span" color={valueColor}>
              {unit}
            </Text5>
          )}
        </Text8>
      </div>
    </Boxed>
  );
}

export default KpiCard;
