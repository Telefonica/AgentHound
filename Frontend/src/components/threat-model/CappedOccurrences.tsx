"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Box, ButtonLink } from "@telefonica/mistica";
import { capped, VISIBLE_OCCURRENCES } from "@/lib/results/findingDisplay";

export function useCappedOccurrences<F extends { id: string }>(findings: F[], selectedFindingId: string | null) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? findings : capped(findings, VISIBLE_OCCURRENCES, (f) => f.id === selectedFindingId);
  return { visible, showAll, toggleShowAll: () => setShowAll((v) => !v) };
}

interface ShowMoreOccurrencesProps {
  total: number;
  visibleCount: number;
  showAll: boolean;
  onToggle: () => void;
  controls: string;
  paddingX?: 8;
}

export function ShowMoreOccurrences({ total, visibleCount, showAll, onToggle, controls, paddingX }: ShowMoreOccurrencesProps) {
  const t = useTranslations("results");
  if (total <= VISIBLE_OCCURRENCES) return null;
  return (
    <Box paddingX={paddingX}>
      <ButtonLink small bleedLeft aria-expanded={showAll} aria-controls={controls} onPress={onToggle}>
        {showAll ? t("showTopOccurrences", { count: VISIBLE_OCCURRENCES }) : t("showMoreOccurrences", { count: total - visibleCount })}
      </ButtonLink>
    </Box>
  );
}
