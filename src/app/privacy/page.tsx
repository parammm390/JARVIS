import type { Metadata } from "next";

import { ResourceFrame } from "@/components/resources/ResourceFrame";
import styles from "@/components/resources/PublicEditorial.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How FINNOR handles website inquiries, public demo inputs and separately scoped production data.",
  alternates: { canonical: "https://finnorai.com/privacy" },
};

export default function PrivacyPage() {
  return (
    <ResourceFrame>
      <article className={styles.legal}>
        <span className={styles.legalMeta}>FINNOR / Privacy overview</span>
        <h1>Privacy</h1>
        <div className={styles.legalBody}>
          <section><h2>Information we collect</h2><p>When you contact FINNOR or use the public demo, we may collect the information you submit, including name, work email, company, phone number, website URL, selected scenario and generated demo metadata.</p></section>
          <section><h2>Public demo inputs</h2><p>Demo generation may use public information from a website you provide. Public demos are clearly illustrative and are designed not to require sensitive customer repair or payment data. Do not submit confidential customer records through the public demo.</p></section>
          <section><h2>How information is used</h2><p>We use inquiry and demo information to provide the requested experience, respond to you, understand product interest, operate and secure the website, and improve FINNOR. We do not describe public demo data as production operational truth.</p></section>
          <section><h2>Production deployments</h2><p>A production deployment is separately scoped. Data sources, processors, access controls, retention, routing, audit requirements and vendor terms are reviewed for that company before activation.</p></section>
          <section><h2>Security and retention</h2><p>FINNOR applies access and operational controls appropriate to the relevant environment. Retention depends on the data type, purpose and applicable deployment agreement. No website can promise absolute security.</p></section>
          <section><h2>Questions and requests</h2><p>For privacy questions or requests related to information you provided, contact <a href="mailto:param@finnorai.com">param@finnorai.com</a>.</p></section>
        </div>
      </article>
    </ResourceFrame>
  );
}
