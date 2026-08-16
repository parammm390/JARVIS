import { permanentRedirect } from "next/navigation"

// M4.T4, this route rendered the same fake "operations dashboard" as
// /demo/[slug] (identical component, confirmed in M0/M1 source review). Cut per
// docs/marketing-demo-merge-contract.md; redirecting rather than deleting the route
// outright so any existing inbound link lands somewhere real instead of 404ing.
export default function DashboardDemoPage() {
  permanentRedirect("/product")
}
