/**
 * Client-side exporters for the results view. Each builds a text artifact from
 * the in-memory {@link AnalysisResult} and triggers a browser download — no
 * server round-trip. Keeping these out of the component keeps `ResultsStep`
 * focused on rendering and makes the serialisers independently testable.
 */

import { stringify } from "yaml";

import type { AnalysisResult } from "@/lib/api/adapters";
import type { CoverageWarning } from "@/lib/api/types";
import { formatValue } from "@/lib/format";
import type { Finding, GraphEdge, GraphNode } from "@/types/ThreatModel";

/** The graph currently shown (Findings tab vs. Proposed Solution tab). */
type GraphView = "findings" | "solution";

/** Trigger a browser download for `content` as a file named `filename`. Uses a
 * Blob object URL so large JSON payloads aren't capped by `data:` URI length
 * limits. */
function triggerDownload(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- YAML ---------------------------------------------------------------------

export function buildYamlExport(mode: "findings" | "solution", result: AnalysisResult): string {
  const doc = {
    analysis: {
      analysis_id: result.analysisId,
      agents: result.counts.agents,
      findings_total: result.counts.findings,
      critical: result.counts.critical,
      max_score: result.counts.maxScore,
    },
    findings: result.findings.map((f) => ({
      id: f.id,
      rule_id: f.ruleId,
      severity: f.severity,
      score: f.score,
      title: f.title,
      ...(mode === "solution" ? { status: "resolved" } : {}),
    })),
    warnings: result.warnings,
  };
  return `# AgentHound Export — ${nowIso()}\n# Mode: ${mode}\n\n${stringify(doc)}`;
}

export function downloadYaml(mode: "findings" | "solution", result: AnalysisResult): void {
  triggerDownload(`agenthound_${mode}.yaml`, "text/yaml", buildYamlExport(mode, result));
}

// --- enriched findings JSON ---------------------------------------------------

/** Export every finding with its full enrichment (OWASP/MITRE references,
 * evidence, path, recommended controls) wrapped in analysis metadata. */
export function downloadFindingsJson(result: AnalysisResult): void {
  const payload = {
    analysisId: result.analysisId,
    name: result.name,
    exportedAt: nowIso(),
    counts: result.counts,
    findings: result.findings,
    warnings: result.warnings,
  };
  triggerDownload("agenthound_findings.json", "application/json", JSON.stringify(payload, null, 2));
}

// --- graph JSON ---------------------------------------------------------------

/** Export the topology of the currently displayed graph (nodes, edges, attack
 * overlays) as JSON. `view` selects the Findings graph or the solved graph. */
export function downloadGraphJson(
  result: AnalysisResult,
  view: GraphView,
  nodes: GraphNode[],
  edges: GraphEdge[],
  attacks: AnalysisResult["attacks"],
): void {
  const payload = {
    analysisId: result.analysisId,
    name: result.name,
    view,
    exportedAt: nowIso(),
    nodes,
    edges,
    attacks,
  };
  triggerDownload(`agenthound_graph_${view}.json`, "application/json", JSON.stringify(payload, null, 2));
}

// --- Markdown report ----------------------------------------------------------

function findingSection(f: Finding): string {
  const lines: string[] = [
    `### ${f.ruleId} — ${f.title}`,
    "",
    `- **Severity:** ${f.severity}`,
    `- **Score:** ${f.score}`,
    `- **Category:** ${f.category}`,
    `- **Class:** ${f.findingClass}`,
  ];
  if (f.desc) lines.push(`- **Description:** ${f.desc}`);
  if (f.path.length > 0) lines.push(`- **Path:** ${f.path.join(" → ")}`);
  if (f.owaspAgentic?.length) lines.push(`- **OWASP Agentic:** ${f.owaspAgentic.join(", ")}`);
  if (f.owaspLlm?.length) lines.push(`- **OWASP LLM:** ${f.owaspLlm.join(", ")}`);
  if (f.mitre?.length) lines.push(`- **MITRE ATLAS:** ${f.mitre.join(", ")}`);
  if (f.controls?.length) lines.push(`- **Recommended controls:** ${f.controls.join(", ")}`);
  if (f.evidence && Object.keys(f.evidence).length > 0) {
    const ev = Object.entries(f.evidence)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(" · ");
    lines.push(`- **Evidence:** ${ev}`);
  }
  lines.push("");
  return lines.join("\n");
}

function warningLine(w: CoverageWarning): string {
  return w.rules.length > 0 ? `- **${w.rules.join(", ")}:** ${w.message}` : `- ${w.message}`;
}

function coverageSections(warnings: CoverageWarning[]): string[] {
  const rules = warnings.filter((w) => w.kind !== "ignored_property");
  const ignored = warnings.filter((w) => w.kind === "ignored_property");
  const out: string[] = [];
  if (rules.length > 0) {
    out.push(
      "## Rule coverage",
      "",
      "This file's format limits which rules can fire, so the findings below don't cover these rules.",
      "",
      ...rules.map(warningLine),
      "",
    );
  }
  if (ignored.length > 0) out.push("## Ignored properties", "", ...ignored.map(warningLine), "");
  return out;
}

/** Build a human-readable Markdown report. On the Proposed Solution tab it also
 * includes the before/after metrics and the remediation timeline. */
export function buildMarkdownReport(result: AnalysisResult, view: GraphView): string {
  const { counts, findings } = result;
  const sol = result.solution;
  const out: string[] = [
    `# AgentHound Report — ${result.name || result.analysisId}`,
    "",
    `_Generated ${nowIso()}_`,
    "",
    "## Summary",
    "",
    `- **Agents:** ${counts.agents}`,
    `- **Tools:** ${counts.tools}`,
    `- **Data assets:** ${counts.dataAssets}`,
    `- **Findings:** ${counts.findings} (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)`,
    `- **Max score:** ${counts.maxScore}`,
    "",
    ...coverageSections(result.warnings),
  ];

  if (view === "solution" && sol) {
    const { before, after } = sol.beforeAfter;
    out.push(
      "## Proposed Solution",
      "",
      `- **Controls applied:** ${sol.appliedControlCount}`,
      `- **Risk reduction:** ${after.riskReductionPct}%`,
      "",
      "| Metric | Before | After |",
      "| --- | --- | --- |",
      `| Findings | ${before.findingCount} | ${after.findingCount} |`,
      `| Critical | ${before.criticalCount} | ${after.criticalCount} |`,
      `| Max score | ${before.maxScore} | ${after.maxScore} |`,
      "",
    );
    if (sol.remediation.length > 0) {
      out.push("### Remediation", "");
      for (const step of sol.remediation) {
        out.push(`- **${step.title}** — ${step.desc.join(" · ")}`);
      }
      out.push("");
    }
  }

  out.push(`## Findings (${findings.length})`, "");
  for (const f of findings) out.push(findingSection(f));

  return out.join("\n");
}

export function downloadMarkdownReport(result: AnalysisResult, view: GraphView): void {
  triggerDownload(`agenthound_report_${view}.md`, "text/markdown", buildMarkdownReport(result, view));
}
