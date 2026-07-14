// LangGraph checkpointer — reuses the SAME pg.Pool packages/db/index.ts already caps
// at max:2 in production (Supabase Supavisor connection limit). A second independent
// pool here would silently double that budget. Checkpoint tables live in their own
// finnor_langgraph schema, mirroring why finnor_os itself is a dedicated schema
// (coexistence with a Supabase project's public schema).

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getPool } from "@finnor/db";

let saver: PostgresSaver | null = null;

export function getCheckpointer(): PostgresSaver {
  saver ??= new PostgresSaver(getPool(), undefined, { schema: "finnor_langgraph" });
  return saver;
}
