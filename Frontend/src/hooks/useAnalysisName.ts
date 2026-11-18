"use client";

import { useCallback, useRef, useState } from "react";
import { renameAnalysis } from "@/lib/api/agentHound";
import { logger } from "@/lib/logger";

export interface AnalysisName {
  /** The name to show. Changes at once on a rename, before the backend has it. */
  name: string;
  /** The latest name, for code that started in an earlier render (a parse in flight). */
  getName: () => string;
  /** Change the name locally only: the Configuration field, before any analysis exists. */
  setName: (next: string) => void;
  /** Rename from the wizard header: show the name now, and save it once there is an analysis. */
  rename: (next: string) => void;
  /** The parse created `analysisId`, stored as `storedName`. A rename made while it ran is saved now. */
  attach: (analysisId: string, storedName: string) => void;
  /** A new parse is starting: forget the analysis, ignore its pending saves and clear the error. */
  detach: () => void;
  /** The last save failed and the name went back to the last one the backend confirmed. */
  saveFailed: boolean;
}

/**
 * The wizard's test name and its saving to the backend.
 *
 * Everything reads refs rather than render state, because the callers are
 * often stale: Mistica's rename dialog keeps the callback from the render that
 * opened it, and the parse awaits the backend. Saves run one at a time, and
 * each sends whatever name is current when its turn comes, so quick renames
 * (A, then B, then C) reach the backend in order and end on C. A failed save
 * goes back to the last name the backend confirmed, unless the user has
 * renamed again since.
 */
export function useAnalysisName(): AnalysisName {
  const [name, setNameState] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const nameRef = useRef("");
  const analysisIdRef = useRef<string | null>(null);
  // The last name the backend confirmed for the current analysis.
  const savedNameRef = useRef("");
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const show = useCallback((next: string) => {
    nameRef.current = next;
    setNameState(next);
  }, []);

  const save = useCallback(
    (id: string) => {
      queueRef.current = queueRef.current.then(async () => {
        const target = nameRef.current.trim();
        if (analysisIdRef.current !== id || !target || target === savedNameRef.current) return;
        try {
          const updated = await renameAnalysis(id, target);
          if (analysisIdRef.current !== id) return;
          savedNameRef.current = updated.name;
          if (nameRef.current.trim() === target) show(updated.name);
        } catch (err) {
          logger.error("Rename request failed", err);
          if (analysisIdRef.current !== id || nameRef.current.trim() !== target) return;
          show(savedNameRef.current);
          setSaveFailed(true);
        }
      });
    },
    [show],
  );

  const getName = useCallback(() => nameRef.current, []);

  const rename = useCallback(
    (next: string) => {
      show(next);
      setSaveFailed(false);
      const id = analysisIdRef.current;
      if (id) save(id);
    },
    [save, show],
  );

  const attach = useCallback(
    (analysisId: string, storedName: string) => {
      analysisIdRef.current = analysisId;
      savedNameRef.current = storedName;
      save(analysisId);
    },
    [save],
  );

  const detach = useCallback(() => {
    analysisIdRef.current = null;
    savedNameRef.current = "";
    setSaveFailed(false);
  }, []);

  return { name, getName, setName: show, rename, attach, detach, saveFailed };
}
