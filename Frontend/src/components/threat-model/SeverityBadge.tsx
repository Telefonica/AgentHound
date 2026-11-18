import { Tag } from "@telefonica/mistica";
import type { DataAttributes } from "@telefonica/mistica";
import { SEVERITY_STYLES, type Severity } from "@/lib/severity";

interface SeverityBadgeProps {
  severity: Severity;
  children: string;
  small?: boolean;
  withIcon?: boolean;
  dataAttributes?: DataAttributes;
}

function SeverityBadge({ severity, children, small, withIcon, dataAttributes }: SeverityBadgeProps) {
  const style = SEVERITY_STYLES[severity];
  return (
    <Tag
      backgroundColor={style.background}
      textColor={style.text}
      small={small}
      Icon={withIcon ? style.Icon : undefined}
      dataAttributes={dataAttributes}
    >
      {children}
    </Tag>
  );
}

export default SeverityBadge;
