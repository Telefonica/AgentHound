import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Callout,
  EmptyState,
  Grid,
  IconInformationRegular,
  IconRobotRegular,
  Stack,
  skinVars,
} from "@telefonica/mistica";
import AgentCapabilityCard from "@/components/threat-model/AgentCapabilityCard";
import AgentEditModal from "@/components/threat-model/AgentEditModal";
import CoverageWarnings from "@/components/threat-model/CoverageWarnings";
import StepSection from "@/components/threat-model/StepSection";
import { groupByAgent } from "@/lib/agentCapabilities";
import { preloadCapabilityRules } from "@/hooks/useCapabilityRules";
import type { CoverageWarning } from "@/lib/api/types";
import type { GraphEdge, GraphNode } from "@/types/ThreatModel";

interface InferenceStepProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: CoverageWarning[];
  framework: string;
  onNodesChange: (nodes: GraphNode[]) => void;
  onEdgesChange: (edges: GraphEdge[]) => void;
}

function InferenceStep({ nodes, edges, warnings, framework, onNodesChange, onEdgesChange }: InferenceStepProps) {
  const t = useTranslations("inference");
  const { agents } = useMemo(() => groupByAgent(nodes, edges), [nodes, edges]);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  useEffect(() => {
    preloadCapabilityRules().catch(() => {});
  }, []);

  const agentCount = agents.length;
  const isEditing = editingAgentId != null && agents.some((g) => g.agent.id === editingAgentId);

  return (
    <>
      <StepSection title={t("heading")} description={t("subtitle")}>
        <Stack space={16}>
          <Callout
            title={t("calloutTitle")}
            description={t("calloutDesc")}
            asset={<IconInformationRegular color={skinVars.colors.brand} />}
          />

          <CoverageWarnings warnings={warnings} framework={framework} />

          {agentCount === 0 ? (
            <EmptyState
              asset={<IconRobotRegular size={32} color={skinVars.colors.brand} />}
              title={t("emptyTitle")}
              description={t("emptyDesc")}
            />
          ) : (
            <Grid columns={{ minSize: 320 }} gap={16}>
              {agents.map((group) => (
                <AgentCapabilityCard
                  key={group.agent.id}
                  group={group}
                  onEditAgent={setEditingAgentId}
                />
              ))}
            </Grid>
          )}
        </Stack>
      </StepSection>

      {isEditing && editingAgentId && (
        <AgentEditModal
          key={editingAgentId}
          agentId={editingAgentId}
          nodes={nodes}
          edges={edges}
          onSave={(newNodes, newEdges) => {
            onNodesChange(newNodes);
            onEdgesChange(newEdges);
          }}
          onClose={() => setEditingAgentId(null)}
        />
      )}
    </>
  );
}

export default InferenceStep;
