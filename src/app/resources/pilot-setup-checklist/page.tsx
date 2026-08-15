import { permanentRedirect } from "next/navigation";

export default function LegacyDeploymentChecklistRedirect() {
  permanentRedirect("/resources/deployment-readiness-checklist");
}
