import { permanentRedirect } from "next/navigation"

export default function LegacyGlossaryRedirect() {
  permanentRedirect("/resources/dispatch-ai-glossary")
}
