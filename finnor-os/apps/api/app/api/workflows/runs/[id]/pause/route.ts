// POST /api/workflows/runs/:id/pause (§2.7). Body: { expectedVersion: number }.

import { pauseRun } from "@finnor/workflow-runtime";
import { makeRunControlRoute } from "../../../../../../lib/run-control-route";

export const POST = makeRunControlRoute(pauseRun);
