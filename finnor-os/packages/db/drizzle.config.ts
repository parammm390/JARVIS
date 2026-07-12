import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/db/schema.ts",
  out: "./packages/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // eslint-disable-next-line no-restricted-syntax
    url: process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor",
  },
});
