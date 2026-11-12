import { useTranslations } from "next-intl";
import {
  Avatar,
  Box,
  Boxed,
  IconButton,
  IconEditRegular,
  IconRobotRegular,
  Inline,
  Stack,
  Tag,
  Text1,
  Text2,
  skinVars,
} from "@telefonica/mistica";
import {
  EDITABLE_ROWS,
  type CapabilityLink,
  type AgentCapabilities as AgentCapabilitiesModel,
} from "@/lib/agentCapabilities";

interface CapabilityRowProps {
  label: string;
  links: CapabilityLink[];
}

/** Read-only display of a capability row. All pills are neutral (gray); editing
 * happens in the agent edit modal, not here. */
function CapabilityRow({ label, links }: CapabilityRowProps) {
  if (links.length === 0) return null;
  return (
    <Stack space={4}>
      <Text1 regular color={skinVars.colors.textSecondary} transform="uppercase">
        {label}
      </Text1>
      <Inline space={8} wrap verticalSpace={8} alignItems="center">
        {links.map(({ edge, node }) => (
          <Tag key={edge.id} small type="inactive">
            {Array.from(new Set([edge.capability, node.label].filter(Boolean))).join(" · ")}
          </Tag>
        ))}
      </Inline>
    </Stack>
  );
}

interface AgentCapabilityCardProps {
  group: AgentCapabilitiesModel;
  onEditAgent: (agentId: string) => void;
}

function AgentCapabilityCard({ group, onEditAgent }: AgentCapabilityCardProps) {
  const t = useTranslations("inference");
  const { agent, other } = group;
  const props = agent.properties ?? {};
  const roleType = typeof props.role_type === "string" ? props.role_type : undefined;
  const trustLevel = typeof props.trust_level === "string" ? props.trust_level : undefined;
  const autonomyLevel = typeof props.autonomy_level === "string" ? props.autonomy_level : undefined;

  return (
    <Boxed>
      <Box padding={16}>
        <Stack space={12}>
          <Inline space="between" alignItems="center">
            <Inline space={12} alignItems="center">
              <Avatar
                size={48}
                Icon={IconRobotRegular}
                backgroundColor={skinVars.colors.brandLow}
                textColor={skinVars.colors.brand}
              />
              <Stack space={2}>
                <Text2 medium truncate>{agent.label}</Text2>
                {roleType && (
                  <Text1 regular color={skinVars.colors.textSecondary}>{roleType}</Text1>
                )}
              </Stack>
            </Inline>
            <IconButton
              small
              Icon={IconEditRegular}
              type="brand"
              backgroundType="transparent"
              aria-label={t("editAgent")}
              onPress={() => onEditAgent(agent.id)}
            />
          </Inline>

          {(trustLevel || autonomyLevel) && (
            <Inline space={4} wrap verticalSpace={4}>
              {trustLevel && <Tag small type="inactive">{t("trustBadge", { value: trustLevel })}</Tag>}
              {autonomyLevel && <Tag small type="inactive">{t("autonomyBadge", { value: autonomyLevel })}</Tag>}
            </Inline>
          )}

          {EDITABLE_ROWS.map((row) => (
            <CapabilityRow key={row} label={t(row)} links={group[row]} />
          ))}

          <CapabilityRow label={t("otherConnections")} links={other} />
        </Stack>
      </Box>
    </Boxed>
  );
}

export default AgentCapabilityCard;
