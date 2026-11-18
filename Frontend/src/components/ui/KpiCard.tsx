import { IconButton, IconInformationRegular, Boxed, Stack, Text3, Text5, Text8, Tooltip, skinVars } from "@telefonica/mistica";
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
  /** Explains what the KPI counts: an info icon in the top-right corner opens it as a tooltip. */
  info?: { label: string; description: string };
}

/**
 * One figure of a dashboard row: an icon, what is being counted and the figure
 * itself. Overview and Results share it so their KPI rows look the same.
 */
function KpiCard({ Icon, iconColor, title, value, unit, valueColor, info }: KpiCardProps) {
  return (
    <Boxed width="100%" height="100%">
      {/* Box can't take a height, so this column pins the figure to the bottom of the
          card: when a title wraps in a narrow card, the figures still line up. */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16, height: "100%", padding: 24, boxSizing: "border-box", position: "relative" }}>
        {info && (
          // Pinned to the corner so the extra icon doesn't change the card's height,
          // and the cards with and without it keep their rows aligned.
          <div style={{ position: "absolute", top: 20, right: 20 }}>
            <Tooltip
              description={info.description}
              position="bottom"
              target={
                <IconButton
                  Icon={IconInformationRegular}
                  type="brand"
                  backgroundType="transparent"
                  small
                  aria-label={info.label}
                  onPress={() => {}}
                />
              }
            />
          </div>
        )}
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
