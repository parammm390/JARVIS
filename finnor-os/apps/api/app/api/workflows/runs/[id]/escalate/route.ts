// POST /api/workflows/runs/:id/escalate (§2.7). Body: { expectedVersion: number }.

import { escalateRun } from "@finnor/workflow-runtime";
import { makeRunControlRoute } from "../../../../../../lib/run-control-route";

export const POST = makeRunControlRoute(escalateRun);
