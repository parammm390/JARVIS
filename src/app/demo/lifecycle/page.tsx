import { permanentRedirect } from "next/navigation";

export default function LifecycleDemoPage() {
  permanentRedirect("/product");
}
