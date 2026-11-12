import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Box, Boxed, Drawer, Inline, Stack, Tag, Text1, Text2, TextLink, skinVars, useTheme } from "@telefonica/mistica";
import { FindingId, FindingRoute } from "@/components/threat-model/FindingIdentity";
import { nodeFindingId } from "@/components/threat-model/graph/toReactFlow";
import SeverityBadge from "@/components/threat-model/SeverityBadge";
import { propPositive } from "@/lib/api/adapters";
import { severityAccentColor } from "@/lib/threatModelColors";
import { formatSnakeCase, formatValue } from "@/lib/format";
import { SEVERITY_RANK } from "@/lib/severity";
import type { Finding, GraphEdge, GraphNode, NodeProp } from "@/types/ThreatModel";

interface NodeDetailDrawerProps {
  node: GraphNode;
  findings: Finding[];
  findingLabelById: Map<string, string>;
  nodesById: Map<string, Pick<GraphNode, "label">>;
  edges: GraphEdge[];
  onClose: () => void;
  onShowRoute?: (findingId: string) => void;
}

function formatProperty(value: unknown): string {
  return value === null || value === undefined ? "—" : formatValue(value);
}

function bySeverityThenScore(a: Finding, b: Finding): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.score - a.score;
}

interface NodeFindingCardProps {
  finding: Finding;
  label: string;
  nodesById: Map<string, Pick<GraphNode, "label">>;
  withRoute: boolean;
  onShowRoute?: (findingId: string) => void;
}

function NodeFindingCard({ finding: f, label, nodesById, withRoute, onShowRoute }: NodeFindingCardProps) {
  const t = useTranslations("node");
  const tSeverity = useTranslations("overview.severity");
  const { isDarkMode } = useTheme();
  const tags = [...(f.owaspAgentic ?? []).map((tag) => `OWASP ${tag}`), ...(f.owaspLlm ?? []), ...(f.mitre ?? [])];
  return (
    <Boxed dataAttributes={{ testid: "node-finding" }}>
      <Box padding={16}>
        <Stack space={12}>
          <Inline space={8} alignItems="center" wrap verticalSpace={4}>
            {onShowRoute ? (
              <Text2 medium>
                <TextLink
                  style={{ color: skinVars.colors.textPrimary }}
                  aria-label={t("showRoute", { id: label })}
                  onPress={() => onShowRoute(f.id)}
                >
                  {label}
                </TextLink>
              </Text2>
            ) : (
              <Tag type="error" small>{label}</Tag>
            )}
            <FindingId id={f.id} />
            <Tag type="inactive" small>{formatSnakeCase(f.category)}</Tag>
            <SeverityBadge severity={f.severity} small>{tSeverity(f.severity)}</SeverityBadge>
            <Text1 medium color={severityAccentColor(f.severity, isDarkMode)}>{f.score}</Text1>
          </Inline>
          <Text1 regular color={skinVars.colors.textSecondary}>{f.title}</Text1>
          {withRoute && <FindingRoute path={f.path} nodesById={nodesById} />}
          {tags.length > 0 && (
            <Inline space={4} wrap verticalSpace={4}>
              {tags.map((tag) => <Tag key={tag} small type="inactive">{tag}</Tag>)}
            </Inline>
          )}
          {f.evidence && Object.keys(f.evidence).length > 0 && (
            <Stack space={4}>
              <Text1 medium color={skinVars.colors.textSecondary}>{t("evidence")}</Text1>
              {Object.entries(f.evidence).map(([key, value]) => (
                <Inline key={key} space={8}>
                  <Text1 regular color={skinVars.colors.textSecondary}>{formatSnakeCase(key)}:</Text1>
                  <Text1 regular>{formatValue(value)}</Text1>
                </Inline>
              ))}
            </Stack>
          )}
        </Stack>
      </Box>
    </Boxed>
  );
}

interface FindingSectionProps {
  title: string;
  findings: Finding[];
  findingLabelById: Map<string, string>;
  nodesById: Map<string, Pick<GraphNode, "label">>;
  testId: string;
  withRoute: boolean;
  onShowRoute?: (findingId: string) => void;
}

function FindingSection({ title, findings, findingLabelById, nodesById, testId, withRoute, onShowRoute }: FindingSectionProps) {
  if (findings.length === 0) return null;
  return (
    <Stack space={8} dataAttributes={{ testid: testId }}>
      <Inline space={8} alignItems="center">
        <Text1 medium color={skinVars.colors.textSecondary}>{title}</Text1>
        <Tag type="inactive" small dataAttributes={{ testid: "node-findings-count" }}>{`${findings.length}`}</Tag>
      </Inline>
      <Stack space={8}>
        {findings.map((f) => (
          <NodeFindingCard key={f.id} finding={f} label={findingLabelById.get(f.id) ?? f.ruleId} nodesById={nodesById} withRoute={withRoute} onShowRoute={onShowRoute} />
        ))}
      </Stack>
    </Stack>
  );
}

function NodeDetailDrawer({ node, findings, findingLabelById, nodesById, edges, onClose, onShowRoute }: NodeDetailDrawerProps) {
  const t = useTranslations("node");
  const { isDarkMode } = useTheme();

  const properties: NodeProp[] = useMemo(
    () =>
      Object.entries(node.properties ?? {}).map(([key, value]) => ({
        key,
        val: formatProperty(value),
        positive: propPositive(key, value),
      })),
    [node.properties],
  );

  // Findings whose risk path passes through this node.
  const nodeFindings = useMemo(
    () => findings.filter((f) => f.path.includes(node.id)),
    [findings, node.id],
  );
  const [ownFindings, throughFindings] = useMemo(() => {
    const own = nodeFindings.filter((f) => nodeFindingId(f, edges) === node.id).sort(bySeverityThenScore);
    const ownIds = new Set(own.map((f) => f.id));
    return [own, nodeFindings.filter((f) => !ownIds.has(f.id)).sort(bySeverityThenScore)];
  }, [nodeFindings, edges, node.id]);

  // Recommended controls, deduplicated, aggregated across those findings.
  const controls = useMemo(
    () => Array.from(new Set(nodeFindings.flatMap((f) => f.controls ?? []))),
    [nodeFindings],
  );

  return (
    <Drawer title={node.label.replace(/\n/g, " ")} onClose={onClose} onDismiss={onClose} width={480}>
      <Stack space={24}>
        <Inline space={8} alignItems="center" wrap verticalSpace={8}>
          <Tag type="inactive">{node.type}</Tag>
          {node.status && (
            <SeverityBadge severity={node.status === "present" ? "none" : "critical"}>
              {node.status === "present" ? t("present") : t("absent")}
            </SeverityBadge>
          )}
          {typeof node.riskScore === "number" && node.riskScore > 0 && (
            <Text1 medium color={severityAccentColor(node.riskScore >= 9 ? "critical" : node.riskScore >= 7 ? "high" : "medium", isDarkMode)}>
              {t("riskScore")}: {node.riskScore}
            </Text1>
          )}
        </Inline>

        {node.badges && node.badges.length > 0 && (
          <Inline space={4} wrap verticalSpace={4}>
            {node.badges.map((badge) => (
              <Tag
                key={badge}
                type={
                  badge === "blocks" ? "success"
                  : badge === "mitigates" ? "warning"
                  : badge === "detects" ? "promo"
                  : "error"
                }
                small
              >
                {badge}
              </Tag>
            ))}
          </Inline>
        )}

        {properties.length > 0 && (
          <Stack space={8}>
            <Text1 medium color={skinVars.colors.textSecondary}>{t("properties")}</Text1>
            <Boxed>
              <Box paddingX={16} paddingY={8}>
                <Stack space={0}>
                  {properties.map((p) => (
                    <Box key={p.key} paddingY={8}>
                      <Inline space={12} alignItems="flex-start">
                        <Box width={150}>
                          <Text1 regular color={skinVars.colors.textSecondary}>{p.key}</Text1>
                        </Box>
                        <Text1
                          regular
                          color={
                            p.positive === true
                              ? skinVars.colors.success
                              : p.positive === false
                                ? skinVars.colors.error
                                : skinVars.colors.textPrimary
                          }
                        >
                          {p.val}
                        </Text1>
                      </Inline>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Boxed>
          </Stack>
        )}

        <FindingSection
          title={t("ownFindings")}
          findings={ownFindings}
          findingLabelById={findingLabelById}
          nodesById={nodesById}
          testId="node-own-findings"
          withRoute={false}
          onShowRoute={onShowRoute}
        />

        <FindingSection
          title={t("attackPaths")}
          findings={throughFindings}
          findingLabelById={findingLabelById}
          nodesById={nodesById}
          testId="node-through-findings"
          withRoute
          onShowRoute={onShowRoute}
        />

        {controls.length > 0 && (
          <Stack space={8}>
            <Text1 medium color={skinVars.colors.textSecondary}>{t("recommendedControls")}</Text1>
            <Inline space={4} wrap verticalSpace={4}>
              {controls.map((c) => (
                <Tag key={c} type="success" small>{c}</Tag>
              ))}
            </Inline>
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}

export default NodeDetailDrawer;
