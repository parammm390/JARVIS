import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit-test runner for the JARVIS kernel (plan v3 P1.T1).
//
// environment: "node" — deliberate, not a default. @testing-library/react@16 needs
// BOTH an @testing-library/dom@^10 peer and a DOM environment (jsdom / happy-dom).
// Neither is an authorised dependency in this plan (P1.T1 permits exactly vitest and
// @testing-library/react), so no DOM environment can be installed. Recorded under
// ## BLOCKERS in JARVIS-FRONTEND-MAESTRO-STATE-v3.md. Until that is resolved, every
// unit test in this plan targets pure logic (kernel selectors, derivations), which is
// where the truth rules actually live.
//
// e2e/ is excluded: those are Playwright specs and are run by `npm run test:e2e`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**", "finnor-os/**"],
    // The plan fixes the script string as exactly `vitest run`, and also requires it to
    // exit 0 before any test exists (P1.T1). That lives here rather than as a CLI flag.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
