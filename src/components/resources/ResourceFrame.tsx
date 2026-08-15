import Link from "next/link";
import type { ReactNode } from "react";

import { FinnorMark } from "@/components/rebuild/FinnorMark";
import FinnorNavigation from "@/components/rebuild/FinnorNavigation";
import { siteConfig } from "@/config/site";
import styles from "./PublicEditorial.module.css";
import { EditorialMotion } from "./EditorialLiveSystems";

export function ResourceFrame({ children }: { children: ReactNode }) {
  return (
    <main className={styles.frame}>
      <EditorialMotion />
      <FinnorNavigation />
      {children}
      <footer className={styles.footer}>
        <div className={styles.footerLead}>
          <Link href="/" aria-label="FINNOR home"><FinnorMark /><span>FINNOR</span></Link>
          <p>Customized AI operating and execution systems for water treatment companies.</p>
        </div>
        <div className={styles.footerGrid}>
          <div><span>Product</span><Link href="/product">Product</Link><Link href="/capabilities">Capabilities</Link><Link href="/how-it-works">How it works</Link></div>
          <div><span>Explore</span><Link href="/resources">Resources</Link><Link href="/trust-safety">Trust &amp; safety</Link><Link href="/faq">FAQ</Link></div>
          <div><span>Work with FINNOR</span><Link href="/pricing">Pricing</Link><a href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">Plan your deployment</a><Link href="/jarvis/login">JARVIS sign in</Link></div>
          <div><span>Contact</span><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
        <div className={styles.footerBase}><span>© {new Date().getFullYear()} FINNOR</span><span>Built for the work behind clean water.</span></div>
      </footer>
    </main>
  );
}
