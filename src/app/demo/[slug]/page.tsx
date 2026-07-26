import { redirect } from "next/navigation"

// M4.T4, this route used to render a fake, hash-generated "operations dashboard"
// (docs/marketing-demo-merge-contract.md "what gets cut"). Its one real feature, an
// embedded live Vapi call, already lives at /demo (Act 1), not duplicated here.
// Redirecting rather than deleting the route outright so any existing inbound link
// (bookmarked, external) lands somewhere real instead of 404ing.
export default function DemoSlugRedirect() {
  redirect("/demo")
}
