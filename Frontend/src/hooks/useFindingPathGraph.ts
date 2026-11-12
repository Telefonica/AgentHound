"use client";

import { useCallback, useEffect, useState } from "react";
import { getFinding } from "@/lib/api/agentHound";
import { toFindingPathGraph, type FindingPathGraph } from "@/lib/api/adapters";
import { logger } from "@/lib/logger";

type Entry = { status: "ready"; graph: FindingPathGraph } | { status: "error" };

export type FindingPathGraphState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; graph: FindingPathGraph };

interface Cache {
  source: unknown;
  entries: ReadonlyMap<string, Entry>;
}

const IDLE: FindingPathGraphState = { status: "idle" };
const LOADING: FindingPathGraphState = { status: "loading" };

export function useFindingPathGraph(
  analysisId: string,
  findingId: string | null,
  source: unknown,
): FindingPathGraphState {
  const [cache, setCache] = useState<Cache>(() => ({ source, entries: new Map() }));
  if (cache.source !== source) setCache({ source, entries: new Map() });
  const entries = cache.source === source ? cache.entries : undefined;

  const entry = findingId ? entries?.get(findingId) : undefined;
  const pending = findingId !== null && entry === undefined;

  const store = useCallback(
    (forSource: unknown, id: string, next: Entry | null) =>
      setCache((c) => {
        if (c.source !== forSource) return c;
        const updated = new Map(c.entries);
        if (next) updated.set(id, next);
        else updated.delete(id);
        return { source: c.source, entries: updated };
      }),
    [],
  );

  useEffect(() => {
    if (!pending || !findingId) return;
    const controller = new AbortController();
    getFinding(analysisId, findingId, { signal: controller.signal })
      .then(toFindingPathGraph)
      .then(
        (graph) => store(source, findingId, { status: "ready", graph }),
        (err) => {
          if (controller.signal.aborted) return;
          logger.error("Finding path graph failed", err);
          store(source, findingId, { status: "error" });
        },
      );
    return () => controller.abort();
  }, [analysisId, findingId, pending, source, store]);

  const retry = useCallback(() => {
    if (findingId) store(source, findingId, null);
  }, [findingId, source, store]);

  if (!findingId) return IDLE;
  if (!entry) return LOADING;
  return entry.status === "ready" ? entry : { status: "error", retry };
}
