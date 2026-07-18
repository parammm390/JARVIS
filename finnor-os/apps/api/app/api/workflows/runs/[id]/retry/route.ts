// POST /api/workflows/runs/:id/retry (§2.7). Body: { expectedVersion: number }.

import { retryRun } from "@finnor/workflow-runtime";
import { makeRunControlRoute } from "../../../../../../lib/run-control-route";

export const POST = makeRunControlRoute(retryRun);
