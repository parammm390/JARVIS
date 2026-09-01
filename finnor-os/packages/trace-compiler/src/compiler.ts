import type { CompileProcedureResult, ExecutionTrace, SourceTraceBundle } from "./contracts";
import { antiUnifyExecutionTraces, type AntiUnifyOptions } from "./anti-unification";
import { deepFreeze } from "./immutable";
import { normalizeExecutionTrace } from "./normalize";

/** Public offline entry point. The frozen result can only be stored/reported for
 * evaluation; it is not a planner candidate or executable program. */
export function compileProcedureCandidate(traces: ExecutionTrace[], options: AntiUnifyOptions): Readonly<CompileProcedureResult> {
  return deepFreeze(antiUnifyExecutionTraces(traces, options));
}

/** End-to-end offline entry point for governed evidence adapters. It performs no
 * reads, writes, provider calls, Work transitions, or candidate persistence. */
export function compileProcedureCandidateFromBundles(
  bundles: SourceTraceBundle[],
  options: AntiUnifyOptions,
): Readonly<CompileProcedureResult> {
  return compileProcedureCandidate(bundles.map((bundle) => normalizeExecutionTrace(bundle, options)), options);
}
