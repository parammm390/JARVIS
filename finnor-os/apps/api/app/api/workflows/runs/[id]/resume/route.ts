// POST /api/workflows/runs/:id/resume (§2.7). Body: { expectedVersion: number }.

import { resumeRun } from "@finnor/workflow-runtime";
import { makeRunControlRoute } from "../../../../../../lib/run-control-route";

export const POST = makeRunControlRoute(resumeRun);
