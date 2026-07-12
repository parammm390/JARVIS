// Orchestrator service (§3 blueprint): a thin long-running host over the shared
// @finnor/orchestration package, exposing an internal HTTP surface for the API and
// worker to call when deployed as a separate service (Railway/Render-class, §24).
// In the default single-deploy topology, apps/api calls the package in-process and
// this service is optional — the interfaces are identical either way.

import "dotenv/config";
import { createServer } from "node:http";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { z } from "zod";

const BodySchema = z.object({
  instruction: z.string().min(1),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["owner", "dispatcher", "technician"]),
  sessionId: z.string().optional(),
});

const orchestrator = new FinnorOrchestrator();
const port = Number(process.env.ORCHESTRATOR_PORT ?? 3200);

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, plugins: orchestrator.plugins.actionTypes() });
  if (req.method === "POST" && req.url === "/plan") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const body = BodySchema.safeParse(JSON.parse(raw || "{}"));
        if (!body.success) return send(400, { error: body.error.issues.map((i) => i.message).join("; ") });
        const { instruction, sessionId, ...ctx } = body.data;
        const actions = await orchestrator.handleInstruction(instruction, ctx, { sessionId });
        return send(200, { planned: actions });
      } catch (err) {
        console.error(err);
        return send(500, { error: "Planning failed. Check orchestrator logs." });
      }
    });
    return;
  }
  send(404, { error: "Not found" });
});

const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  server.listen(port, () => console.log(`[orchestrator] listening on :${port}`));
}

export { server, orchestrator };
