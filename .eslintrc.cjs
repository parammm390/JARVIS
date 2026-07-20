// Converted from .eslintrc.json to .cjs so the Phase 7 override below can carry a
// real comment explaining itself (JSON has no comment syntax).
module.exports = {
  extends: ["next/core-web-vitals"],
  overrides: [
    {
      // Phase 7 §7.8 (JARVIS 95% MAESTRO PACK) — truthfulness enforcement in CI: the
      // authenticated JARVIS views may never fake a metric or activity effect.
      // Math.random() specifically is precise and zero-false-positive to lint; a
      // generic "hardcoded metric literal" rule would false-positive on legitimate
      // constants (thresholds, array indices, etc.) and stays a manual-review
      // convention instead of an automated one.
      files: ["src/components/jarvis/**/*.{ts,tsx}", "src/app/jarvis/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-properties": [
          "error",
          {
            object: "Math",
            property: "random",
            message:
              "No Math.random() in the JARVIS cockpit (Phase 7 §7.8: nothing here may fake a metric or activity effect). If you need a real demo/sample value, it must be clearly labeled as sample data, not presented as live.",
          },
        ],
      },
    },
  ],
}
