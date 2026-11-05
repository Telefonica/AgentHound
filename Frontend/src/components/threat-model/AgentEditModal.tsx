import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Avatar,
  Box,
  Boxed,
  ButtonLink,
  ButtonPrimary,
  Chip,
  Divider,
  Drawer,
  Grid,
  IconAddMoreRegular,
  IconInformationRegular,
  IconPuzzleRegular,
  IconRobotRegular,
  Inline,
  Select,
  Stack,
  Tag,
  Text1,
  Text2,
  TextField,
  Tooltip,
  skinVars,
  useScreenSize,
} from "@telefonica/mistica";
import {
  CAPABILITY_CATALOG,
  EDITABLE_ROWS,
  groupByAgent,
  ROW_CONFIG,
  type CapabilityLink,
  type EditableCapabilityRow,
} from "@/lib/agentCapabilities";
import { useCapabilityRules } from "@/hooks/useCapabilityRules";
import type { GraphEdge, GraphNode } from "@/types/ThreatModel";

const DND_MIME = "application/x-agenthound-capability";

function makeId(): string {
  return "n" + Math.random().toString(36).slice(2, 9);
}

interface PendingEntry {
  row: EditableCapabilityRow;
  capability: string;
}

interface AgentEditModalProps {
  agentId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Commit the edited draft graph back to the caller (only on Save). */
  onSave: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  /** Close/dismiss without committing (Cancel, X, ESC, overlay). */
  onClose: () => void;
}

/** A catalog capability the user can either click or drag onto the agent. */
function CatalogChip({
  row,
  capability,
  rules,
  disabled,
  onAdd,
}: {
  row: EditableCapabilityRow;
  capability: string;
  rules?: readonly string[];
  disabled?: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations("inference");
  if (disabled) {
    return <Tag small type="inactive">{capability}</Tag>;
  }
  const chip = (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, JSON.stringify({ row, capability }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      style={{ display: "inline-flex", cursor: "grab" }}
    >
      <Chip small Icon={IconAddMoreRegular} onPress={onAdd}>
        {capability}
      </Chip>
    </span>
  );
  return rules?.length ? (
    <Tooltip description={t("checkedBy", { count: rules.length, rules: rules.join(", ") })} target={chip} />
  ) : (
    chip
  );
}

function AgentEditModal({ agentId, nodes, edges, onSave, onClose }: AgentEditModalProps) {
  const t = useTranslations("inference");
  const { isDesktopOrBigger } = useScreenSize();

  // All edits happen on a local draft copy of the graph; the caller only sees
  // them if the user presses Save. Cancel/dismiss simply discards this draft.
  const [draftNodes, setDraftNodes] = useState(nodes);
  const [draftEdges, setDraftEdges] = useState(edges);
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const [pendingTarget, setPendingTarget] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [hasFinePointer] = useState(() => !window.matchMedia("(pointer: coarse)").matches);
  const rulesByVerb = useCapabilityRules();
  const isUnchecked = (verb: string) => rulesByVerb != null && !rulesByVerb.get(verb)?.length;
  const pendingRules = pending ? rulesByVerb?.get(pending.capability) : undefined;

  const group = useMemo(
    () => groupByAgent(draftNodes, draftEdges).agents.find((a) => a.agent.id === agentId) ?? null,
    [draftNodes, draftEdges, agentId],
  );

  const delegateOptions = useMemo(
    () =>
      draftNodes
        .filter((n) => n.type === "agent" && n.id !== agentId)
        .map((n) => ({ value: n.id, text: n.label })),
    [draftNodes, agentId],
  );
  const canDelegate = delegateOptions.length > 0;

  const renameAgent = (value: string) =>
    setDraftNodes((ns) => ns.map((n) => (n.id === agentId ? { ...n, label: value } : n)));

  const removeLink = (edgeId: string) =>
    setDraftEdges((es) => es.filter((e) => e.id !== edgeId));

  const addCapability = (row: EditableCapabilityRow, capability: string, target: string) => {
    const config = ROW_CONFIG[row];
    const cap = capability || config.defaultCapability;

    // delegatesTo links two existing agents — `target` is the other agent's id.
    if (row === "delegatesTo") {
      setDraftEdges((es) => [...es, { id: makeId(), f: agentId, t: target, capability: cap }]);
      return;
    }

    // Every other row creates a fresh target node (`target` is its optional
    // label) plus the edge connecting it to the agent, mirroring the Results
    // graph model. When no name is given, the node is labelled with the
    // capability verb so it never shows up blank in Results.
    //
    // The node carries no backend swimlane layout, so seed it near its agent
    // (with a little jitter so repeated additions do not stack) instead of at
    // the origin, which would pile every new node in the graph's top-left
    // corner in Results. Falls back to the graph centre if the agent lacks
    // coordinates.
    const agentNode = draftNodes.find((n) => n.id === agentId);
    const x = (agentNode?.x ?? 700) + (Math.random() - 0.5) * 160;
    const y = (agentNode?.y ?? 300) + (Math.random() - 0.5) * 160;
    const newNode: GraphNode = { id: makeId(), type: config.nodeType, label: target || cap, x, y, properties: {} };
    const newEdge: GraphEdge =
      config.direction === "in"
        ? { id: makeId(), f: newNode.id, t: agentId, capability: cap }
        : { id: makeId(), f: agentId, t: newNode.id, capability: cap };
    setDraftNodes((ns) => [...ns, newNode]);
    setDraftEdges((es) => [...es, newEdge]);
  };

  const handleSave = () => {
    // Only propagate (which marks the graph dirty and triggers a re-analysis)
    // when something actually changed. draftNodes/draftEdges start as the prop
    // arrays and are replaced only by an edit, so a reference change is a
    // reliable "was edited" signal -- opening and saving without edits is a no-op.
    if (draftNodes !== nodes || draftEdges !== edges) {
      onSave(draftNodes, draftEdges);
    }
    onClose();
  };

  const startAdd = (row: EditableCapabilityRow, capability: string) => {
    if (row === "delegatesTo") {
      if (!canDelegate) return;
      setPendingTarget(delegateOptions[0]?.value ?? "");
    } else {
      setPendingTarget("");
    }
    setPending({ row, capability });
  };

  const cancelPending = () => {
    setPending(null);
    setPendingTarget("");
  };

  const confirmPending = () => {
    if (!pending) return;
    // delegatesTo must reference an existing agent; for every other row the
    // target name is optional extra info, so an empty value is allowed.
    if (pending.row === "delegatesTo") {
      if (!pendingTarget) return;
      addCapability(pending.row, pending.capability, pendingTarget);
    } else {
      addCapability(pending.row, pending.capability, pendingTarget.trim());
    }
    cancelPending();
  };

  // The agent always exists while this modal is mounted, but guard for types.
  if (!group) return null;
  const { agent } = group;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    try {
      const { row, capability } = JSON.parse(raw) as PendingEntry;
      startAdd(row, capability);
    } catch {
      /* ignore malformed payloads */
    }
  };

  // Rows (plus the read-only "other" bucket) that currently have entries.
  const rowsWithLinks: { row: EditableCapabilityRow | "other"; links: CapabilityLink[] }[] = [
    ...EDITABLE_ROWS.map((row) => ({ row, links: group[row] })),
    { row: "other" as const, links: group.other },
  ].filter(({ links }) => links.length > 0);

  // ---- Left panel: the capability catalog --------------------------------
  // Rendered on its own alternative-background surface so it reads clearly as
  // the source palette, visually distinct from the white agent panel.
  const catalog = (
    <Boxed variant="alternative" height="100%">
      <Box padding={16}>
        <Stack space={12}>
          <Stack space={2}>
            <Inline space={8} alignItems="center">
              <IconPuzzleRegular size={20} color={skinVars.colors.neutralHigh} />
              <Text2 medium>{t("catalogTitle")}</Text2>
            </Inline>
            <Text1 regular color={skinVars.colors.textSecondary}>{t("catalogHint")}</Text1>
          </Stack>
          {EDITABLE_ROWS.map((row) => {
            const chips = (verbs: string[]) => (
              <Inline space={4} wrap verticalSpace={4}>
                {verbs.map((capability) => (
                  <CatalogChip
                    key={capability}
                    row={row}
                    capability={capability}
                    rules={hasFinePointer ? rulesByVerb?.get(capability) : undefined}
                    disabled={row === "delegatesTo" && !canDelegate}
                    onAdd={() => startAdd(row, capability)}
                  />
                ))}
              </Inline>
            );
            const checked = CAPABILITY_CATALOG[row].filter((verb) => !isUnchecked(verb));
            const unchecked = CAPABILITY_CATALOG[row].filter(isUnchecked);
            return (
              <Stack space={4} key={row} dataAttributes={{ testid: `catalog-row-${row}` }}>
                <Text1 regular color={skinVars.colors.textSecondary} transform="uppercase">
                  {t(row)}
                </Text1>
                {checked.length > 0 && chips(checked)}
                {unchecked.length > 0 && (
                  <Stack space={4} dataAttributes={{ testid: "unchecked-verbs" }}>
                    <Text1 regular color={skinVars.colors.textSecondary}>{t("uncheckedVerbs")}</Text1>
                    {chips(unchecked)}
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Box>
    </Boxed>
  );

  // ---- Right panel: the agent and its detected capabilities --------------
  // The whole surface is the drop target and gets a dashed brand outline while
  // dragging, so it's obvious this side is where capabilities land.
  const agentPanel = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        height: "100%",
        borderRadius: skinVars.borderRadii.container,
        outline: `2px dashed ${dragOver ? skinVars.colors.brand : "transparent"}`,
        outlineOffset: 4,
        transition: "outline-color 0.15s ease",
      }}
    >
      <Boxed height="100%">
        <Box padding={16}>
          <Stack space={16}>
            <Inline space={12} alignItems="center" expand={1}>
              <Avatar
                size={48}
                Icon={IconRobotRegular}
                backgroundColor={skinVars.colors.brandLow}
                textColor={skinVars.colors.brand}
              />
              <TextField
                name="agent-name"
                label={t("agentNameField")}
                value={agent.label}
                onChangeValue={renameAgent}
                fullWidth
              />
            </Inline>

            {pending && (
              <Boxed variant="alternative">
                <Box padding={16}>
                  <Stack space={12}>
                    <Text1 regular color={skinVars.colors.textSecondary}>
                      {t("addingCapability", { capability: pending.capability, row: t(pending.row) })}
                    </Text1>
                    {pendingRules?.length ? (
                      <Text1 regular color={skinVars.colors.textSecondary}>
                        {t("checkedBy", { count: pendingRules.length, rules: pendingRules.join(", ") })}
                      </Text1>
                    ) : null}
                    {isUnchecked(pending.capability) && (
                      <Inline space={8}>
                        <IconInformationRegular size={16} color={skinVars.colors.neutralHigh} />
                        <Text1 regular color={skinVars.colors.textSecondary}>
                          {t("uncheckedVerbNote", { capability: pending.capability })}
                        </Text1>
                      </Inline>
                    )}
                    {pending.row === "delegatesTo" ? (
                      <Select
                        name="delegate-target"
                        label={t("delegateTargetField")}
                        options={delegateOptions}
                        value={pendingTarget}
                        onChangeValue={setPendingTarget}
                        fullWidth
                      />
                    ) : (
                      <TextField
                        name="capability-target"
                        label={t("targetLabelField")}
                        placeholder={t("targetLabelPlaceholder")}
                        value={pendingTarget}
                        onChangeValue={setPendingTarget}
                        fullWidth
                        autoFocus
                        optional
                      />
                    )}
                    <Inline space={16} alignItems="center">
                      <ButtonPrimary small onPress={confirmPending}>{t("addButton")}</ButtonPrimary>
                      <ButtonLink small onPress={cancelPending}>{t("cancelButton")}</ButtonLink>
                    </Inline>
                  </Stack>
                </Box>
              </Boxed>
            )}

            <Divider />

            <Stack space={12}>
              <Text1 regular color={skinVars.colors.textSecondary} transform="uppercase">
                {t("detectedCapabilities")}
              </Text1>
              {rowsWithLinks.length === 0 ? (
                <Text1 regular color={skinVars.colors.textSecondary}>{t("dropHint")}</Text1>
              ) : (
                <Stack space={16}>
                  {rowsWithLinks.map(({ row, links }, index) => (
                    <Stack space={8} key={row}>
                      {index > 0 && <Divider />}
                      <Text1 regular color={skinVars.colors.textSecondary} transform="uppercase">
                        {row === "other" ? t("otherConnections") : t(row)}
                      </Text1>
                      <Inline space={8} wrap verticalSpace={8}>
                        {links.map(({ edge, node }) => {
                          const chipLabel = Array.from(new Set([edge.capability, node.label].filter(Boolean))).join(" · ");
                          // `other` links are owned by another agent (e.g. an
                          // incoming delegation) and are read-only here; every
                          // editable row gets a remove affordance.
                          return row === "other" ? (
                            <Chip key={edge.id}>{chipLabel}</Chip>
                          ) : (
                            <Chip key={edge.id} onClose={() => removeLink(edge.id)} closeButtonLabel={t("removeLink")}>
                              {chipLabel}
                            </Chip>
                          );
                        })}
                      </Inline>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          </Stack>
        </Box>
      </Boxed>
    </div>
  );

  return (
    <Drawer
      title={t("editAgentTitle")}
      width={880}
      onClose={onClose}
      onDismiss={onClose}
      dismissLabel={t("cancelButton")}
      button={{ text: t("saveButton"), onPress: handleSave }}
      secondaryButton={{ text: t("cancelButton"), onPress: onClose }}
    >
      <Stack space={16}>
        <Text1 regular color={skinVars.colors.textSecondary}>{t("editAgentDesc")}</Text1>
        {isDesktopOrBigger ? (
          <Grid columns={2} gap={24}>
            {catalog}
            {agentPanel}
          </Grid>
        ) : (
          <Stack space={16}>
            {agentPanel}
            {catalog}
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}

export default AgentEditModal;
