import type { Metadata } from "next";

import { ResourceFrame } from "@/components/resources/ResourceFrame";
import styles from "@/components/resources/PublicEditorial.module.css";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms overview for the FINNOR website, public demonstrations and separately agreed production deployments.",
  alternates: { canonical: "https://finnorai.com/terms" },
};

export default function TermsPage() {
  return (
    <ResourceFrame>
      <article className={styles.legal}>
        <span className={styles.legalMeta}>FINNOR / Terms overview</span>
        <h1>Terms</h1>
        <div className={styles.legalBody}>
          <section><h2>Website use</h2><p>This website and its materials are provided for evaluation, education and discussion. You may not misuse the site, interfere with its operation or attempt unauthorized access to connected systems.</p></section>
          <section><h2>Public demonstrations</h2><p>Demo profiles, conversations, plans and receipts are illustrative unless explicitly identified as connected production data. Unknown information may remain unknown. Demo artifacts should not be treated as repair, emergency, legal, financial or operational advice.</p></section>
          <section><h2>No production authorization</h2><p>Using the website or public demo does not authorize FINNOR or JARVIS to act in your business. Production execution requires a separately agreed scope, configured access, policies, authority boundaries and certification.</p></section>
          <section><h2>Deployment terms</h2><p>Production agreements may cover integrations, data handling, retention, routing, vendor responsibilities, service levels, escalation, recovery, security and the company’s own operating policies.</p></section>
          <section><h2>Your inputs</h2><p>You are responsible for having the right to provide any website, company or contact information submitted through the site. Do not submit sensitive customer or payment data through a public evaluation flow.</p></section>
          <section><h2>Availability and changes</h2><p>Website and demo capabilities may change, be unavailable or differ from a configured production deployment. Product activation depends on the specific environment and agreements.</p></section>
          <section><h2>Contact</h2><p>To discuss these terms or a production scope, contact <a href="mailto:param@finnorai.com">param@finnorai.com</a>.</p></section>
        </div>
      </article>
    </ResourceFrame>
  );
}
