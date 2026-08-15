import type { Metadata } from "next";
import { PilotSetupChecklist } from "@/components/resources/PilotSetupChecklist";

export const metadata: Metadata = {
  title: "FINNOR Deployment Readiness Checklist",
  description: "Map and certify a FINNOR company deployment across workflows, sources, systems, authority, workspaces, recovery, activation and support.",
  alternates: { canonical: "https://finnorai.com/resources/deployment-readiness-checklist" },
  openGraph: {
    title: "FINNOR Deployment Readiness Checklist",
    description: "The decisions required to configure, test and activate a company-specific FINNOR operating system.",
    url: "https://finnorai.com/resources/deployment-readiness-checklist",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR deployment readiness checklist" }],
  },
};

export default function DeploymentReadinessChecklistPage() {
  return <PilotSetupChecklist />;
}
