import { permanentRedirect } from "next/navigation";

export default function LegacyOperationalDragRedirect() {
  permanentRedirect("/resources/operational-drag-estimator");
}
