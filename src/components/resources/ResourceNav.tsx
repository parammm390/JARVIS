"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { siteConfig } from "@/config/site";
import styles from "./PublicEditorial.module.css";

export function ResourceNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className={styles.nav}>
      <Link className={styles.wordmark} href="/">FINNOR<sup>®</sup></Link>
      <nav aria-label="Public navigation">
        <Link href="/#story">How it works</Link>
        <Link href="/resources">Field notes</Link>
        <Link href="/trust-safety">Trust</Link>
        <Link href="/jarvis/login">Sign in</Link>
      </nav>
      <a className={styles.navAction} href={siteConfig.calendlyLink}>Book an operating review</a>
      <button
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>
      {open ? (
        <div className={styles.mobileNav}>
          <Link href="/#story">How it works</Link>
          <Link href="/resources">Field notes</Link>
          <Link href="/trust-safety">Trust</Link>
          <Link href="/jarvis/login">Sign in</Link>
          <a href={siteConfig.calendlyLink}>Book an operating review</a>
        </div>
      ) : null}
    </header>
  );
}
