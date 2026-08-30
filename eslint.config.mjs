import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import legacyTruthRules from "./.eslintrc.cjs"

// Next 16 removed `next lint` and current ESLint uses flat config. Keep the existing
// FINNOR truthfulness ratchets as their reviewed source of policy while adapting
// only the legacy override shape to ESLint's flat configuration.
const truthRuleOverrides = legacyTruthRules.overrides.map(({ excludedFiles, ...override }, index) => ({
  name: `finnor/truth-rule-${index + 1}`,
  ...override,
  ...(excludedFiles ? { ignores: excludedFiles } : {}),
}))

const config = [
  { ignores: ["finnor-os/**", ".next/**"] },
  ...nextCoreWebVitals,
  {
    // These React Compiler readiness rules did not exist in the prior Next 14
    // gate. Keep the established lint contract during the security upgrade;
    // compiler adoption is a separate behavior-changing migration.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
    },
  },
  ...truthRuleOverrides,
]

export default config
