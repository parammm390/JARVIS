#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function loadEnvFile(filePath, override = false) {
  try {
    const contents = readFileSync(filePath, "utf8")
    for (const line of contents.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const separator = trimmed.indexOf("=")
      if (separator === -1) continue
      const key = trimmed.slice(0, separator).trim()
      let value = trimmed.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      value = value.replace(/\\n/g, "").replace(/\r?\n/g, "").trim()
      if (override || !process.env[key]) process.env[key] = value
    }
  } catch {
    // ignore missing env files
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"))
loadEnvFile(resolve(process.cwd(), ".env.vercel"), true)

function cleanEnv(value) {
  return typeof value === "string"
    ? value.replace(/\\n/g, "").replace(/\r?\n/g, "").trim()
    : ""
}

const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
const testDomain = `migration-check-${Date.now()}.example.com`

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function cleanup(ids) {
  if (!ids.length) return
  await supabase.from("demo_generation_locks").delete().in("id", ids)
}

async function main() {
  const ids = []
  const baseRow = {
    normalized_domain: testDomain,
    normalized_company_name: "migration check",
    website_url: `https://${testDomain}`,
    company_name: "Migration Check Co",
    status: "generating",
  }

  const first = await supabase.from("demo_generation_locks").insert(baseRow).select("id").single()
  if (first.error) {
    console.error("First insert failed:", first.error.message)
    process.exit(1)
  }
  ids.push(first.data.id)

  const second = await supabase.from("demo_generation_locks").insert(baseRow).select("id").single()
  if (second.error) {
    if (second.error.code === "23505" || /duplicate key|unique/i.test(second.error.message || "")) {
      console.error("MIGRATION_REQUIRED: unique index still blocks multiple rows per domain.")
      console.error("Apply supabase/migrations/20260702_raise_demo_limit_to_5.sql in Supabase SQL Editor.")
      await cleanup(ids)
      process.exit(1)
    }

    console.error("Second insert failed unexpectedly:", second.error.message)
    await cleanup(ids)
    process.exit(1)
  }

  ids.push(second.data.id)
  await cleanup(ids)
  console.log("MIGRATION_OK: multiple demo_generation_locks rows per domain are allowed.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
