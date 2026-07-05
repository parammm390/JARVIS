export type MemoryGroup = "Contact" | "Water profile" | "System & jobs" | "Relationship"

export type MemoryFieldWrite = {
  group: MemoryGroup
  label: string
  value: string
}

export type MemoryField = MemoryFieldWrite & {
  updatedAtStage: number
}

export type MemoryEvent = {
  time: string
  text: string
  stage: number
}

export type SmsMessage = {
  from: "finnor" | "customer"
  text: string
  chips?: string[]
  chosenChip?: string
}

export type SceneData =
  | {
      kind: "call"
      chips: string[]
      transcript: Array<{ role: "ai" | "caller"; text: string }>
    }
  | {
      kind: "water"
      source: string
      note: string
      badge: { label: string; live: boolean }
      provenance: string[]
      rows: Array<{ label: string; value: string; detail: string; flag: "high" | "ok" }>
    }
  | {
      kind: "sizing"
      diagnosis: string
      steps: Array<{ label: string; value: string }>
      verdict: string
      quote: string
      guess: { title: string; lines: string[] }
    }
  | {
      kind: "messages"
      thread: SmsMessage[]
      interactive?: boolean
    }
  | {
      kind: "job"
      jobLabel: string
      results: Array<{ label: string; before: string; after: string }>
      invoice: Array<{ label: string; amount: string }>
      invoiceTotal: string
      onFile: string[]
      plan: { title: string; detail: string } | null
    }
  | {
      kind: "review"
      thread: SmsMessage[]
      review: { stars: number; quote: string; name: string; meta: string }
    }
  | {
      kind: "checkin"
      thread: SmsMessage[]
      order: { title: string; detail: string; amount: string }
    }
  | {
      kind: "referral"
      callerName: string
      callerLine: string
      sourceNote: string
      jobLabel: string
      amount: string
    }
  | {
      kind: "upsell"
      signals: string[]
      thread: SmsMessage[]
    }
  | {
      kind: "ledger"
      entries: Array<{ when: string; label: string; amount: string; kind: string }>
      directTotal: string
      referralTotal: string
      grandTotal: string
      noMemoryTotal: string
    }

export type LifecycleStage = {
  id: string
  railLabel: string
  timeLabel: string
  title: string
  narration: string
  autoMs: number
  scene: SceneData
  writes: {
    fields?: MemoryFieldWrite[]
    events: string[]
    nextAction: string
    ltv?: number
    tag?: string
  }
}

export type LifecycleScenario = {
  dealer: {
    name: string
    tierLabel: string
    location: string
  }
  customer: {
    name: string
    initials: string
    address: string
    phone: string
    since: string
  }
  live: boolean
  stages: LifecycleStage[]
}

export type CustomerRecord = {
  fields: MemoryField[]
  events: MemoryEvent[]
  nextAction: string
  ltv: number | null
  tag: string
  fieldsKnown: number
}

export const MEMORY_GROUP_ORDER: MemoryGroup[] = [
  "Contact",
  "Water profile",
  "System & jobs",
  "Relationship",
]

export function recordAtStage(
  scenario: LifecycleScenario,
  stageIndex: number,
  slot?: string
): CustomerRecord {
  const fieldMap = new Map<string, MemoryField>()
  const events: MemoryEvent[] = []
  let nextAction = ""
  let ltv: number | null = null
  let tag = ""

  scenario.stages.slice(0, stageIndex + 1).forEach((stage, index) => {
    stage.writes.fields?.forEach((field) => {
      fieldMap.set(`${field.group}:${field.label}`, {
        ...field,
        value: applySlot(field.value, slot),
        updatedAtStage: index,
      })
    })
    stage.writes.events.forEach((text) => {
      events.push({ time: stage.railLabel, text: applySlot(text, slot), stage: index })
    })
    nextAction = applySlot(stage.writes.nextAction, slot)
    if (typeof stage.writes.ltv === "number") ltv = stage.writes.ltv
    if (stage.writes.tag) tag = stage.writes.tag
  })

  return {
    fields: [...fieldMap.values()],
    events: events.reverse(),
    nextAction,
    ltv,
    tag,
    fieldsKnown: fieldMap.size,
  }
}

export function applySlot(text: string, slot?: string) {
  return slot ? text.replace(/\{\{slot\}\}/g, slot) : text.replace(/\{\{slot\}\}/g, "Thu 10:00 AM")
}

export function formatLtv(value: number | null) {
  if (value === null) return "—"
  return `$${value.toLocaleString("en-US")}`
}
