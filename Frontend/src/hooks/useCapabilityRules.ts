"use client";

import { useEffect, useState } from "react";
import { getCapabilities } from "@/lib/api/agentHound";
import { logger } from "@/lib/logger";

export type RulesByVerb = ReadonlyMap<string, readonly string[]>;

let request: Promise<RulesByVerb> | null = null;
let loaded: RulesByVerb | null = null;

export function preloadCapabilityRules(): Promise<RulesByVerb> {
  request ??= getCapabilities().then(
    ({ capabilities }) => (loaded = new Map(capabilities.map((c) => [c.verb, c.evaluated_by]))),
    (err) => {
      request = null;
      throw err;
    },
  );
  return request;
}

export function resetCapabilityRules() {
  request = null;
  loaded = null;
}

export function useCapabilityRules(): RulesByVerb | null {
  const [rules, setRules] = useState(loaded);
  useEffect(() => {
    if (rules) return;
    preloadCapabilityRules().then(setRules, (err) => logger.error("Capability catalog failed", err));
  }, [rules]);
  return rules;
}
