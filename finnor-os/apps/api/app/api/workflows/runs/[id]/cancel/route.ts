// POST /api/workflows/runs/:id/cancel (§2.7). Body: { expectedVersion: number }.

import { cancelRun } from "@finnor/workflow-runtime";
import { makeRunControlRoute } from "../../../../../../lib/run-control-route";

export const POST = makeRunControlRoute(cancelRun);
