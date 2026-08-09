import Link from "next/link";
import type { ReactNode } from "react";

import { siteConfig } from "@/config/site";
import styles from "./PublicEditorial.module.css";
import { ResourceNav } from "./ResourceNav";

export function ResourceFrame({ children }: { children: ReactNode }) {
  return (
    <main className={styles.frame}>
      <ResourceNav />
      {children}
      <footer className={styles.footer}>
        <div className={styles.footerLead}>
          <Link href="/">FINNOR®</Link>
          <p>Governed execution for water treatment companies.</p>
        </div>
        <div className={styles.footerGrid}>
          <div><span>Product</span><Link href="/#story">How it works</Link><Link href="/jarvis/login">JARVIS</Link></div>
          <div><span>Explore</span><Link href="/resources">Field notes</Link><Link href="/demo">Demo</Link><Link href="/trust-safety">Trust &amp; safety</Link></div>
          <div><span>Company</span><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a><a href={siteConfig.calendlyLink}>Book a review</a></div>
          <div><span>Legal</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
        <div className={styles.footerBase}><span>© {new Date().getFullYear()} FINNOR</span><span>Built for the work behind clean water.</span></div>
      </footer>
    </main>
  );
}
