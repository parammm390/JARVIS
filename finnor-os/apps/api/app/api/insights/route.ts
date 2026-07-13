// GET /api/insights — real observability over what the system has actually done:
// which action types fail or get rejected most often, and what the async critic pass
// (packages/orchestration/src/critic.ts) has flagged. This is a feedback report a
// human reads and acts on, e.g. by editing a domain_policies row — nothing here
// changes system behavior on its own. API-only for now, same as /api/stats; a console
// page can surface this later.

import { computeLearningDigest } from "@finnor/orchestration";
import { requireContext, errorResponse } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const digest = await computeLearningDigest(ctx.tenantId);
    return Response.json(digest, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
