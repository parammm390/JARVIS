import type { EvidenceClass, ExecutionTrace, SupportMetrics, TraceId } from "./contracts";

export function primaryEvidenceClass(trace: ExecutionTrace): EvidenceClass {
  if (trace.provenance.evidenceClasses.includes("SIMULATED_EXECUTION")) return "SIMULATED_EXECUTION";
  if (trace.provenance.evidenceClasses.includes("REPLAY_FIXTURE")) return "REPLAY_FIXTURE";
  return "REAL_EXECUTION";
}

export function isRealTrace(trace: ExecutionTrace): boolean {
  return primaryEvidenceClass(trace) === "REAL_EXECUTION";
}

export function isPositiveRealTrace(trace: ExecutionTrace): boolean {
  return isRealTrace(trace) && (trace.outcome === "SUCCESS" || trace.outcome === "RECOVERED_SUCCESS");
}

export function supportMetrics(
  corpus: ExecutionTrace[],
  supporting: Iterable<TraceId | string>,
  contradicting: Iterable<TraceId | string> = [],
): SupportMetrics {
  const supportingIds = new Set([...supporting]);
  const contradictingIds = new Set([...contradicting]);
  const supported = corpus.filter((trace) => supportingIds.has(trace.traceId));
  const contradicted = corpus.filter((trace) => contradictingIds.has(trace.traceId));
  const allEvidence = [...supported, ...contradicted];
  const times = allEvidence.flatMap((trace) => [trace.startedAt, trace.endedAt ?? trace.startedAt]).sort();
  const classCounts = (kind: EvidenceClass) => ({
    supporting: supported.filter((trace) => primaryEvidenceClass(trace) === kind).length,
    contradicting: contradicted.filter((trace) => primaryEvidenceClass(trace) === kind).length,
  });
  const realSupporting = supported.filter(isRealTrace).length;
  const sampleQuality: SupportMetrics["sampleQuality"] = contradictingIds.size > 0
    ? "CONTRADICTORY"
    : realSupporting <= 1
      ? "SINGLE_TRACE_HYPOTHESIS"
      : realSupporting === 2
        ? "LIMITED"
        : "MULTI_TRACE";
  return {
    supportingTraceCount: supported.length,
    contradictingTraceCount: contradicted.length,
    successTraceCount: allEvidence.filter((trace) => trace.outcome === "SUCCESS" || trace.outcome === "RECOVERED_SUCCESS").length,
    failureTraceCount: allEvidence.filter((trace) => trace.outcome === "FAILURE").length,
    tenantCount: new Set(allEvidence.map((trace) => trace.tenantId)).size,
    timeRange: times.length > 0 ? { start: times[0]!, end: times.at(-1)! } : null,
    coverage: { numerator: supported.length, denominator: corpus.length },
    realExecution: classCounts("REAL_EXECUTION"),
    simulatedExecution: classCounts("SIMULATED_EXECUTION"),
    replayFixture: classCounts("REPLAY_FIXTURE"),
    sampleQuality,
  };
}
