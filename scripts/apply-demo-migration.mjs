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

function cleanEnv(value) {
  return typeof value === "string"
    ? value.replace(/\\n/g, "").replace(/\r?\n/g, "").trim()
    : ""
}

loadEnvFile(resolve(process.cwd(), ".env.local"))
loadEnvFile(resolve(process.cwd(), ".env.vercel"), true)

const accessToken = cleanEnv(process.env.SUPABASE_ACCESS_TOKEN)
const projectRef =
  cleanEnv(process.env.SUPABASE_PROJECT_REF) ||
  (() => {
    try {
      const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
      return new URL(url).hostname.split(".")[0]
    } catch {
      return ""
    }
  })()

const migrationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260702_raise_demo_limit_to_5.sql"),
  "utf8"
)

if (!accessToken) {
  console.error("Missing SUPABASE_ACCESS_TOKEN for management API migration apply.")
  process.exit(1)
}

if (!projectRef) {
  console.error("Could not resolve Supabase project ref.")
  process.exit(1)
}

async function main() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: migrationSql }),
  })

  const body = await response.text()
  if (!response.ok) {
    console.error("Migration apply failed:", response.status, body)
    process.exit(1)
  }

  console.log("Migration applied successfully.")
  console.log(body)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
