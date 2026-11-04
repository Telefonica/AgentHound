import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import type { CoverageWarning } from "@/lib/api/types";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { type CoverageT, describeDeclare, describeIgnored, groupCoverageWarnings } from "./coverageWarnings";

// The real messages, untyped the way useTranslations returns them in the app.
function translator(locale: string, messages: typeof en): CoverageT {
  return createTranslator({ locale, messages, namespace: "results.coverage" }) as unknown as CoverageT;
}
const tEn = translator("en", en);
const tEs = translator("es", es);

// As the backend returns them for FH-017 and FH-013.
const fh017 = [
  [
    { node_type: "agent", property: "exposure_boundary", values: ["external"] },
    { node_type: "tool", property: "authentication_scope", values: ["elevated"] },
  ],
];
const fh013 = [[{ node_type: "output", property: "recipient_type", values: ["public_channel", "broadcast"] }]];

describe("describeDeclare", () => {
  it("joins the requirements of an option with 'and', each on its node type", () => {
    expect(describeDeclare(fh017, tEn, "en")).toBe(
      "exposure_boundary: external on the agent and authentication_scope: elevated on the tool",
    );
  });

  it("joins alternative values with 'or'", () => {
    expect(describeDeclare(fh013, tEn, "en")).toBe("recipient_type: public_channel or broadcast on the output");
  });

  it("joins alternative options with 'or'", () => {
    const declare = [
      [{ node_type: "data_asset", property: "boundary", values: ["external"] }],
      [{ node_type: "memory", property: "shared", values: [true] }],
    ];
    expect(describeDeclare(declare, tEn, "en")).toBe(
      "boundary: external on the data asset or shared: true on the memory node",
    );
  });

  it("names the node by its role when the requirement has one", () => {
    const declare = [[
      { node_type: "agent", property: "exposure_boundary", values: ["external"] },
      { node_type: "tool", role: "reachable", property: "authentication_scope", values: ["elevated"] },
    ]];
    expect(describeDeclare(declare, tEn, "en")).toBe(
      "exposure_boundary: external on the agent and authentication_scope: elevated on a tool that agent can reach",
    );
    const fh014 = [[{ node_type: "agent", role: "delegate", property: "trust_level", values: ["trusted_core"] }]];
    expect(describeDeclare(fh014, tEs, "es")).toBe("trust_level: trusted_core en el agente al que delega otro agente");
  });

  it("falls back to the node type for a role it doesn't know", () => {
    const declare = [[{ node_type: "output", role: "future_role", property: "boundary", values: ["external"] }]];
    expect(describeDeclare(declare, tEn, "en")).toBe("boundary: external on the output");
  });

  it("translates the joins and the node types", () => {
    expect(describeDeclare(fh017, tEs, "es")).toBe(
      "exposure_boundary: external en el agente y authentication_scope: elevated en la herramienta",
    );
    expect(describeDeclare(fh013, tEs, "es")).toBe("recipient_type: public_channel o broadcast en la salida");
  });
});

describe("describeIgnored", () => {
  const ignored = (suggestion: string | null): CoverageWarning => ({
    kind: "ignored_property",
    rules: [],
    properties: ["trust_level"],
    message: "",
    node: "Feed",
    node_type: "data_asset",
    suggestion,
  });

  it("offers the property the key resembles", () => {
    expect(describeIgnored({ ...ignored("sensitivity"), properties: ["sensitivty"] }, tEn)).toBe(
      "sensitivty on Feed isn't a known property and was ignored. Did you mean sensitivity?",
    );
  });

  it("says when the property belongs to another node type", () => {
    expect(describeIgnored(ignored(null), tEn)).toBe("trust_level on Feed belongs to another kind of node and was ignored.");
  });
});

describe("groupCoverageWarnings", () => {
  it("splits by kind and counts each rule once", () => {
    const warnings: CoverageWarning[] = [
      { kind: "not_expressible", rules: ["FH-006"], properties: [], message: "" },
      { kind: "not_expressible", rules: ["FH-014", "FH-023"], properties: [], message: "" },
      { kind: "needs_declaration", rules: ["FH-013"], properties: ["recipient_type"], message: "", declare: fh013 },
      { kind: "ignored_property", rules: [], properties: ["x"], message: "", node: "n", suggestion: null },
    ];
    const groups = groupCoverageWarnings(warnings);
    expect(groups.notExpressible).toEqual(["FH-006", "FH-014", "FH-023"]);
    expect(groups.needsDeclaration.map((w) => w.rules)).toEqual([["FH-013"]]);
    expect(groups.ignored).toHaveLength(1);
    expect(groups.ruleCount).toBe(4);
  });

  it("is empty for the generic format", () => {
    expect(groupCoverageWarnings([])).toEqual({ notExpressible: [], needsDeclaration: [], ignored: [], ruleCount: 0 });
  });
});
