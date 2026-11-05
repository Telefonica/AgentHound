"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Box, Boxed, Stack, Text8, skinVars } from "@telefonica/mistica";
import ConfigurationStep from "@/components/threat-model/ConfigurationStep";
import ProcessingStep from "@/components/threat-model/ProcessingStep";
import InferenceStep from "@/components/threat-model/InferenceStep";
import ResultsStep from "@/components/threat-model/ResultsStep";
import WizardFooter from "@/components/threat-model/WizardFooter";
import WizardStepper from "@/components/threat-model/WizardStepper";
import { PROVIDERS, YAML_COUNT } from "@/lib/threatModelData";
import { buildCrewaiUpload } from "@/lib/crewai";
import { analyze, createAnalysis, getGraph } from "@/lib/api/agentHound";
import { loadSolution } from "@/lib/api/loadAnalysis";
import {
  toAnalyzeRequest,
  toAnalyzedResult,
  toGraphEdges,
  toGraphNodes,
  type AnalysisResult,
} from "@/lib/api/adapters";
import { ApiError } from "@/lib/api/client";
import InlineError from "@/components/ui/InlineError";
import { logger } from "@/lib/logger";
import type { GraphEdge, GraphNode, WizardPhase } from "@/types/ThreatModel";

const STEP_INDEX: Record<WizardPhase, number> = {
  configuration: 1,
  processing: 2,
  inference: 3,
  results: 4,
};

// Frameworks the backend has a dedicated adapter for, including the explicit
// generic (nodes/edges) format. Anything else (e.g. n8n) is sent without a hint
// so the backend falls back to auto-detection.
const BACKEND_FRAMEWORKS = new Set(["crewai", "dify", "langgraph", "generic"]);

/**
 * Frame shared by the steps that live inside a single container (Configuration
 * and Analysis): the title (48 above, 40 below), then one container that holds
 * the stepper and the step content, with the footer pinned underneath.
 */
function ContainedStep({
  heading,
  stepper,
  footer,
  children,
}: {
  heading: ReactNode;
  stepper: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, paddingLeft: 32, paddingRight: 32, paddingBottom: 32 }}>
      <Box paddingTop={48} paddingBottom={40}>
        {heading}
      </Box>
      <Box paddingBottom={32}>
        <Boxed width="100%">
          <Box paddingX={32} paddingY={40}>
            <Stack space={56}>
              {stepper}
              {children}
            </Stack>
          </Box>
        </Boxed>
      </Box>
      {footer}
    </div>
  );
}

function NewThreatModelScreen() {
  const router = useRouter();
  const tWizard = useTranslations("wizard");
  const tConfiguration = useTranslations("configuration");
  const tInference = useTranslations("inference");
  const stepLabels = [
    tWizard("steps.configuration"),
    tWizard("steps.analysis"),
    tWizard("steps.capabilities"),
    tWizard("steps.results"),
  ];
  const [phase, setPhase] = useState<WizardPhase>("configuration");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState(PROVIDERS[0]?.value ?? "crewai");
  const [showValidation, setShowValidation] = useState(false);
  // Uploads keyed by field ("workflow" for single-file frameworks; "agents" +
  // "tasks" for CrewAI). Keeping the field association lets us merge the CrewAI
  // pair correctly instead of uploading whichever file happened to be first.
  const [filesByField, setFilesByField] = useState<Record<string, File[]>>({});
  const files = useMemo(() => Object.values(filesByField).flat(), [filesByField]);

  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [requestDone, setRequestDone] = useState(false);
  const [processingComplete, setProcessingComplete] = useState(false);
  const markProcessingComplete = useCallback(() => setProcessingComplete(true), []);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // The Inference step's editable copy of the graph, seeded from the parsed
  // graph. The pipeline is two-stage: `createAnalysis` only PARSES (shows the
  // inferred capabilities for editing); the rule engine runs later in `analyze`.
  const [inferenceNodes, setInferenceNodes] = useState<GraphNode[]>([]);
  const [inferenceEdges, setInferenceEdges] = useState<GraphEdge[]>([]);
  // `dirty`: the capabilities were edited since the last analysis.
  // `analyzed`: the analysis has run at least once for the current parse.
  const [dirty, setDirty] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  const close = () => router.push("/overview");

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: HTMLElement | null = rootRef.current;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollTo(0, 0);
        return;
      }
      el = el.parentElement;
    }
    window.scrollTo(0, 0);
  }, [phase]);

  // Stage 1 (Processing): parse the uploaded YAML into a graph and seed the
  // editable Inference copy. No rules run yet; findings come from `analyze`.
  const parseArchitecture = useCallback(async () => {
    setResult(null);
    setAnalysisId(null);
    setRequestDone(false);
    setProcessingComplete(false);
    setAnalysisError(null);
    setReanalyzeError(null);
    setDirty(false);
    setAnalyzed(false);

    // CrewAI ships two files (agents + tasks); the backend wants them as one
    // `agents:`/`tasks:` document, so merge before upload. Every other
    // framework is a single file.
    let file: File | null;
    if ((YAML_COUNT[provider] ?? 1) > 1) {
      file = await buildCrewaiUpload(filesByField);
    } else {
      file = files[0] ?? null;
    }
    if (!file) {
      setAnalysisError("No file selected.");
      return;
    }
    const framework = BACKEND_FRAMEWORKS.has(provider) ? provider : undefined;
    try {
      const created = await createAnalysis(file, { framework, name });
      const graph = await getGraph(created.analysis_id);
      setAnalysisId(created.analysis_id);
      setInferenceNodes(toGraphNodes(graph.nodes));
      setInferenceEdges(toGraphEdges(graph.edges));
      setRequestDone(true);
    } catch (err) {
      logger.error("Parse request failed", err);
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : "Parsing failed.";
      setAnalysisError(message);
    }
  }, [filesByField, files, provider, name]);

  // Stage 2 (leaving Inference for Results): run the analysis if it has not run
  // yet, or re-run it if the capabilities changed since the last run; otherwise
  // just advance. Edits are sent so findings follow them; the first unedited
  // run sends no body and analyses the parsed graph as-is. On failure we stay on
  // Inference and surface the error.
  const goToResults = useCallback(async () => {
    if (!analysisId) {
      setPhase("results");
      return;
    }
    if (analyzed && !dirty) {
      setPhase("results");
      return;
    }
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const resp = await analyze(
        analysisId,
        dirty ? toAnalyzeRequest(inferenceNodes, inferenceEdges) : undefined,
      );
      const base = toAnalyzedResult(resp);
      setResult({ ...base, solution: await loadSolution(base.analysisId, base) });
      setInferenceNodes(base.nodes);
      setInferenceEdges(base.edges);
      setAnalyzed(true);
      setDirty(false);
      setPhase("results");
    } catch (err) {
      logger.error("Analysis request failed", err);
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : "Analysis failed.";
      setReanalyzeError(message);
    } finally {
      setReanalyzing(false);
    }
  }, [analysisId, analyzed, dirty, inferenceNodes, inferenceEdges]);

  const handleNext = () => {
    if (phase === "configuration") {
      if (!name.trim() || files.length === 0) {
        setShowValidation(true);
        return;
      }
      setPhase("processing");
      void parseArchitecture();
      return;
    }
    if (phase === "processing") {
      if (processingComplete) setPhase("inference");
      return;
    }
    if (phase === "inference") {
      void goToResults();
    }
  };

  const handlePrevious = () => {
    if (phase === "processing" || phase === "inference") setPhase("configuration");
    else if (phase === "results") setPhase("inference");
    else close();
  };

  const stepper = <WizardStepper steps={stepLabels} currentStep={STEP_INDEX[phase]} aria-label={tWizard("progressLabel")} />;

  const heading = (
    <Text8 as="h1" color={skinVars.colors.neutralHigh}>
      {name.trim() || tWizard("untitled")}
    </Text8>
  );

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {phase === "configuration" ? (
        <ContainedStep
          heading={heading}
          stepper={stepper}
          footer={
            <WizardFooter
              onPrevious={handlePrevious}
              onNext={handleNext}
              nextLabel={tConfiguration("analyzeButton")}
              disableNext={!name.trim() || files.length === 0}
            />
          }
        >
          <ConfigurationStep
            name={name}
            onNameChange={setName}
            provider={provider}
            onProviderChange={setProvider}
            showValidation={showValidation}
            onFilesChange={setFilesByField}
          />
        </ContainedStep>
      ) : phase === "processing" ? (
        <ContainedStep
          heading={heading}
          stepper={stepper}
          footer={
            <WizardFooter
              onPrevious={handlePrevious}
              onNext={handleNext}
              disableNext={!processingComplete}
              isNextLoading={!processingComplete && !analysisError}
            />
          }
        >
          <ProcessingStep
            requestDone={requestDone}
            error={analysisError}
            onRetry={() => void parseArchitecture()}
            onComplete={markProcessingComplete}
          />
        </ContainedStep>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, paddingTop: 24, paddingLeft: 32, paddingRight: 32, paddingBottom: 32, gap: 32 }}>
          {heading}
          {stepper}

          {phase === "inference" && (
            <>
              <InferenceStep
                nodes={inferenceNodes}
                edges={inferenceEdges}
                onNodesChange={(ns) => {
                  setInferenceNodes(ns);
                  setDirty(true);
                }}
                onEdgesChange={(es) => {
                  setInferenceEdges(es);
                  setDirty(true);
                }}
              />
              {reanalyzeError && <InlineError message={reanalyzeError} />}
            </>
          )}
          {phase === "results" && <ResultsStep result={result} hideTitle />}

          <WizardFooter
            onPrevious={handlePrevious}
            onNext={handleNext}
            hideNext={phase === "results"}
            nextLabel={phase === "inference" ? tInference("viewResults") : undefined}
            disableNext={phase === "inference" && reanalyzing}
            isNextLoading={phase === "inference" && reanalyzing}
          />
        </div>
      )}
    </div>
  );
}

export default NewThreatModelScreen;
