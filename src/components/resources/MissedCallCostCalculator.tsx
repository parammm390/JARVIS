"use client";

import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function EstimatorInstrument() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Workflow observation</span><span>before FINNOR</span></div>
      <div className={styles.instrumentBody}>
        <span>Common pattern</span>
        <strong>Work waits while people reconcile systems.</strong>
        <p>This estimator makes that coordination load visible without pretending every delayed dollar is lost revenue.</p>
        <div className={styles.instrumentRows}>
          <div><i style={{ background: "#d86e35" }} /><span>Find the exact record</span><small>manual</small></div>
          <div><i style={{ background: "#d86e35" }} /><span>Check dependent systems</span><small>manual</small></div>
          <div><i /><span>Approve and move work</span><small>measured</small></div>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, output, onChange }: { label: string; value: number; min: number; max: number; step: number; output: string; onChange: (value: number) => void }) {
  return (
    <label className={styles.slider}>
      <span>{label}<output>{output}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function MissedCallCostCalculator() {
  const [cases, setCases] = useState(18);
  const [minutes, setMinutes] = useState(42);
  const [hourlyCost, setHourlyCost] = useState(38);
  const [workValue, setWorkValue] = useState(2400);
  const [delayDays, setDelayDays] = useState(1.5);

  const result = useMemo(() => {
    const weeklyHours = (cases * minutes) / 60;
    return {
      weeklyHours,
      annualCoordinationCost: weeklyHours * hourlyCost * 52,
      staffWeeks: (weeklyHours * 52) / 40,
      weeklyValueInMotion: cases * workValue,
      monthlyValueDays: cases * workValue * delayDays * 4.33,
    };
  }, [cases, minutes, hourlyCost, workValue, delayDays]);

  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Operational drag estimator"
        title="Measure the cost of work between systems."
        copy="Model the labor and throughput tied up when customer work requires manual record-finding, cross-system checks, coordination and reconciliation before it can move."
        icon={Calculator}
        aside={<EstimatorInstrument />}
      />

      <section className={styles.content}>
        <span className={styles.sectionLabel}>Directional planning model</span>
        <h2 className={styles.sectionTitle}>Count coordination, not imaginary recovered revenue.</h2>
        <p className={styles.sectionCopy}>Use conservative observed inputs. “Value in motion” means work delayed by coordination; it is not a claim that the value will be lost or automatically recovered.</p>

        <div className={styles.calculatorGrid}>
          <div className={styles.calculatorInputs}>
            <Slider label="Work cases needing manual reconciliation each week" value={cases} min={1} max={100} step={1} output={`${cases} cases`} onChange={setCases} />
            <Slider label="Coordination time per case" value={minutes} min={5} max={180} step={5} output={`${minutes} min`} onChange={setMinutes} />
            <Slider label="Loaded hourly team cost" value={hourlyCost} min={20} max={120} step={2} output={money.format(hourlyCost)} onChange={setHourlyCost} />
            <Slider label="Average value attached to each work case" value={workValue} min={250} max={20000} step={250} output={money.format(workValue)} onChange={setWorkValue} />
            <Slider label="Average delay introduced by coordination" value={delayDays} min={0.5} max={14} step={0.5} output={`${decimal.format(delayDays)} days`} onChange={setDelayDays} />
          </div>

          <aside className={styles.calculatorResult}>
            <span>Annual coordination cost</span>
            <strong>{money.format(result.annualCoordinationCost)}</strong>
            <p>Direct loaded labor spent reconciling and coordinating this workflow under the selected assumptions.</p>
            <div className={styles.resultRows}>
              <div><span>Coordination load</span><b>{decimal.format(result.weeklyHours)} hr / week</b></div>
              <div><span>Team capacity</span><b>{decimal.format(result.staffWeeks)} staff-weeks / year</b></div>
              <div><span>Value in motion</span><b>{money.format(result.weeklyValueInMotion)} / week</b></div>
              <div><span>Value-days delayed</span><b>{money.format(result.monthlyValueDays)} / month</b></div>
            </div>
          </aside>
        </div>
      </section>
    </ResourceFrame>
  );
}
