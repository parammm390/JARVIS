import type { LucideIcon } from "lucide-react";

import styles from "./PublicEditorial.module.css";

type ResourceHeroProps = {
  kicker: string;
  title: string;
  copy: string;
  icon: LucideIcon;
  aside?: React.ReactNode;
};

export function ResourceHero({ kicker, title, copy, icon: Icon, aside }: ResourceHeroProps) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.kicker}><Icon size={15} />{kicker}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {aside ? <div className={styles.heroAside}>{aside}</div> : null}
    </section>
  );
}
