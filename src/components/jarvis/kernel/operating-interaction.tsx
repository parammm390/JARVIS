"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useJarvisAuth } from "../lib/jarvis-auth"

export type OperatingEntityType =
  | "household" | "contact" | "user" | "technician" | "equipment" | "service_visit"
  | "maintenance_agreement" | "lead" | "opportunity" | "quote" | "proposal" | "work_order"
  | "appointment" | "invoice" | "payment" | "conversation" | "call" | "message" | "communication"
  | "document" | "task" | "work" | "domain_action" | "workflow_run" | "workflow_step"
  | "business_operation" | "business_operation_target" | "decision_receipt" | "business_event"
  | "org_unit" | "tenant_location" | "external_organization" | "external_contact" | "delegation"
  | "acknowledgement_request" | "communication_delivery" | "internal_event" | "document_share"
  | "inventory_item" | "computer_run"

export interface OperatingEntityRef { entityType: OperatingEntityType; entityId: string }
export interface OperatingInteractionContextValue {
  version: 1
  capturedAt: string
  source: "voice" | "text" | "console"
  activeWork?: { workId: string }
  focusedEntity?: OperatingEntityRef
  selectedEntities: OperatingEntityRef[]
  excludedEntities: OperatingEntityRef[]
  surface: {
    id: "home" | "customers" | "money" | "work" | "schedule" | "agents"
    route?: string
    spatialState?: "canvas" | "detail" | "list" | "map" | "timeline"
  }
  filters: Array<{ field: string; operator: "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "contains"; value: string | number | boolean | string[] }>
  timeContext?: { start?: string; end?: string; timezone?: string }
  cohort?: { kind: "work_query_execution"; executionId: string; entityType: "household"; queryIntent: "customer_cohort"; count: number }
}

type Surface = OperatingInteractionContextValue["surface"]
type Filter = OperatingInteractionContextValue["filters"][number]
type Cohort = NonNullable<OperatingInteractionContextValue["cohort"]>

export interface InteractionState {
  activeWorkId: string | null
  focusedEntity: OperatingEntityRef | null
  selectedEntities: OperatingEntityRef[]
  excludedEntities: OperatingEntityRef[]
  surface: Surface
  filters: Filter[]
  timeContext: OperatingInteractionContextValue["timeContext"]
  cohort: Cohort | null
  labels: Record<string, string>
}

interface OperatingInteractionState extends InteractionState {
  focusEntity: (ref: OperatingEntityRef, label?: string) => void
  toggleEntity: (ref: OperatingEntityRef, label?: string) => void
  excludeEntity: (ref: OperatingEntityRef, excluded?: boolean, label?: string) => void
  setSurface: (surface: Surface) => void
  setFilters: (filters: Filter[]) => void
  setTimeContext: (timeContext: InteractionState["timeContext"]) => void
  setCohort: (cohort: Cohort | null) => void
  clearSelection: () => void
  beginUnrelatedWork: () => void
  bindWork: (workId: string | null) => void
  restore: (context: OperatingInteractionContextValue | null, workId?: string | null) => void
  capture: (source: "voice" | "typed", continuingWorkId?: string | null) => OperatingInteractionContextValue
}

const EMPTY: InteractionState = {
  activeWorkId: null,
  focusedEntity: null,
  selectedEntities: [],
  excludedEntities: [],
  surface: { id: "home", route: "/jarvis", spatialState: "canvas" },
  filters: [],
  timeContext: undefined,
  cohort: null,
  labels: {},
}

const PERSISTED_CONTEXT_VERSION = 1 as const
const PERSISTED_CONTEXT_PREFIX = "finnor.jarvis.operating-context.v1"
const ENTITY_TYPES = new Set<OperatingEntityType>([
  "household", "contact", "user", "technician", "equipment", "service_visit",
  "maintenance_agreement", "lead", "opportunity", "quote", "proposal", "work_order",
  "appointment", "invoice", "payment", "conversation", "call", "message", "communication",
  "document", "task", "work", "domain_action", "workflow_run", "workflow_step",
  "business_operation", "business_operation_target", "decision_receipt", "business_event",
  "org_unit", "tenant_location", "external_organization", "external_contact", "delegation",
  "acknowledgement_request", "communication_delivery", "internal_event", "document_share",
  "inventory_item", "computer_run",
])
const SURFACE_IDS = new Set<Surface["id"]>(["home", "customers", "money", "work", "schedule", "agents"])
const SPATIAL_STATES = new Set<NonNullable<Surface["spatialState"]>>(["canvas", "detail", "list", "map", "timeline"])
const FILTER_OPERATORS = new Set<Filter["operator"]>(["eq", "neq", "in", "not_in", "gte", "lte", "contains"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function boundedString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function parseEntityRef(value: unknown): OperatingEntityRef | null {
  if (!isRecord(value) || !ENTITY_TYPES.has(value.entityType as OperatingEntityType) || !boundedString(value.entityId)) return null
  return { entityType: value.entityType as OperatingEntityType, entityId: value.entityId }
}

function parseEntityRefs(value: unknown): OperatingEntityRef[] | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const parsed = value.map(parseEntityRef)
  return parsed.some((ref) => ref === null) ? null : unique(parsed as OperatingEntityRef[])
}

function parseFilters(value: unknown): Filter[] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const parsed: Filter[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || !boundedString(candidate.field, 128) || !FILTER_OPERATORS.has(candidate.operator as Filter["operator"])) return null
    const filterValue = candidate.value
    const validValue = typeof filterValue === "string" || typeof filterValue === "number" || typeof filterValue === "boolean"
      || (Array.isArray(filterValue) && filterValue.length <= 50 && filterValue.every((item) => typeof item === "string" && item.length <= 256))
    if (!validValue) return null
    parsed.push({ field: candidate.field, operator: candidate.operator as Filter["operator"], value: filterValue as Filter["value"] })
  }
  return parsed
}

/** Browser persistence is presentation continuity, not authority. Parse every
 * field and discard the whole snapshot when it is malformed or over-bounded. */
export function parsePersistedOperatingInteractionState(raw: string | null): InteractionState | null {
  if (!raw || raw.length > 64_000) return null
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!isRecord(envelope) || envelope.version !== PERSISTED_CONTEXT_VERSION || !isRecord(envelope.state)) return null
    const value = envelope.state
    const activeWorkId = value.activeWorkId === null ? null : boundedString(value.activeWorkId) ? value.activeWorkId : undefined
    const focusedEntity = value.focusedEntity === null ? null : parseEntityRef(value.focusedEntity)
    const selectedEntities = parseEntityRefs(value.selectedEntities)
    const excludedEntities = parseEntityRefs(value.excludedEntities)
    const filters = parseFilters(value.filters)
    if (activeWorkId === undefined || focusedEntity === null && value.focusedEntity !== null || selectedEntities === null || excludedEntities === null || filters === null || !isRecord(value.surface)) return null
    if (!SURFACE_IDS.has(value.surface.id as Surface["id"])) return null
    const route = value.surface.route === undefined ? undefined : boundedString(value.surface.route, 512) && value.surface.route.startsWith("/jarvis") ? value.surface.route : null
    const spatialState = value.surface.spatialState === undefined ? undefined : SPATIAL_STATES.has(value.surface.spatialState as NonNullable<Surface["spatialState"]>) ? value.surface.spatialState as NonNullable<Surface["spatialState"]> : null
    if (route === null || spatialState === null) return null
    let timeContext: InteractionState["timeContext"]
    if (value.timeContext !== undefined) {
      if (!isRecord(value.timeContext)) return null
      const entries = [value.timeContext.start, value.timeContext.end, value.timeContext.timezone]
      if (entries.some((entry) => entry !== undefined && (typeof entry !== "string" || entry.length > 128))) return null
      timeContext = { ...(value.timeContext.start ? { start: value.timeContext.start as string } : {}), ...(value.timeContext.end ? { end: value.timeContext.end as string } : {}), ...(value.timeContext.timezone ? { timezone: value.timeContext.timezone as string } : {}) }
    }
    let cohort: Cohort | null = null
    if (value.cohort !== null) {
      if (!isRecord(value.cohort) || value.cohort.kind !== "work_query_execution" || value.cohort.entityType !== "household" || value.cohort.queryIntent !== "customer_cohort" || !boundedString(value.cohort.executionId) || typeof value.cohort.count !== "number" || !Number.isInteger(value.cohort.count) || value.cohort.count < 0) return null
      cohort = { kind: "work_query_execution", entityType: "household", queryIntent: "customer_cohort", executionId: value.cohort.executionId, count: value.cohort.count }
    }
    if (!isRecord(value.labels) || Object.keys(value.labels).length > 100 || Object.entries(value.labels).some(([key, label]) => key.length > 512 || typeof label !== "string" || label.length > 256)) return null
    return {
      activeWorkId,
      focusedEntity,
      selectedEntities,
      excludedEntities,
      surface: { id: value.surface.id as Surface["id"], ...(route ? { route } : {}), ...(spatialState ? { spatialState } : {}) },
      filters,
      timeContext,
      cohort,
      labels: value.labels as Record<string, string>,
    }
  } catch {
    return null
  }
}

export function serializeOperatingInteractionState(state: InteractionState): string {
  return JSON.stringify({ version: PERSISTED_CONTEXT_VERSION, state })
}

export function persistedOperatingInteractionKey(userId: string): string {
  return `${PERSISTED_CONTEXT_PREFIX}:${userId}`
}

export function removePersistedOperatingInteractionState(storage: Pick<Storage, "removeItem">, userId: string): void {
  storage.removeItem(persistedOperatingInteractionKey(userId))
}

const OperatingInteractionContext = createContext<OperatingInteractionState | null>(null)
type OperatingInteractionActions = Omit<OperatingInteractionState, keyof InteractionState>
const OperatingInteractionActionsContext = createContext<OperatingInteractionActions | null>(null)

function refKey(ref: OperatingEntityRef): string { return `${ref.entityType}:${ref.entityId}` }
function unique(refs: OperatingEntityRef[]): OperatingEntityRef[] { return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()] }
function routeSurface(pathname: string): Surface["id"] {
  if (pathname.startsWith("/jarvis/customers")) return "customers"
  if (pathname.startsWith("/jarvis/money")) return "money"
  if (pathname.startsWith("/jarvis/work")) return "work"
  if (pathname.startsWith("/jarvis/schedule")) return "schedule"
  if (pathname.startsWith("/jarvis/agents")) return "agents"
  return "home"
}

export interface OperatingDeepLink {
  focusedEntity: OperatingEntityRef | null
  contextualEntities: OperatingEntityRef[]
  activeWorkId: string | null
}

export function resolveOperatingDeepLink(pathname: string, search: string): OperatingDeepLink {
  const params = new URLSearchParams(search)
  const candidates: Array<[string, OperatingEntityType]> = pathname.startsWith("/jarvis/customers")
    ? [["householdId", "household"]]
    : pathname.startsWith("/jarvis/money")
      ? [["invoiceId", "invoice"]]
      : pathname.startsWith("/jarvis/work")
        ? [["workCaseId", "work"]]
        : pathname.startsWith("/jarvis/schedule")
          ? [["visitId", "service_visit"], ["appointmentId", "appointment"]]
          : []
  let focusedEntity: OperatingEntityRef | null = null
  for (const [name, entityType] of candidates) {
    const entityId = params.get(name)
    if (entityId) { focusedEntity = { entityType, entityId }; break }
  }
  const householdId = params.get("householdId")
  const workCaseId = params.get("workCaseId")
  const contextualEntities = unique([
    ...(householdId ? [{ entityType: "household" as const, entityId: householdId }] : []),
    ...(workCaseId ? [{ entityType: "work" as const, entityId: workCaseId }] : []),
  ])
  return {
    focusedEntity: focusedEntity ?? (householdId ? { entityType: "household", entityId: householdId } : null),
    contextualEntities,
    activeWorkId: workCaseId,
  }
}

function currentDeepLink(pathname: string): OperatingDeepLink {
  return resolveOperatingDeepLink(pathname, typeof window === "undefined" ? "" : window.location.search)
}

export function OperatingInteractionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const auth = useJarvisAuth()
  const [state, setState] = useState<InteractionState>(EMPTY)
  const [persistenceUserId, setPersistenceUserId] = useState<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const deepLink = currentDeepLink(pathname)
    setState((current) => ({
      ...current,
      activeWorkId: deepLink.activeWorkId ?? current.activeWorkId,
      focusedEntity: deepLink.focusedEntity ?? current.focusedEntity,
      selectedEntities: unique([...current.selectedEntities, ...deepLink.contextualEntities]).slice(0, 50),
      surface: { ...current.surface, id: routeSurface(pathname), route: pathname },
    }))
  }, [pathname])

  const authenticatedUserId = auth.session?.user.id ?? null
  useEffect(() => {
    if (auth.loading || persistenceUserId === authenticatedUserId) return
    if (!authenticatedUserId) {
      if (persistenceUserId) {
        try {
          removePersistedOperatingInteractionState(window.sessionStorage, persistenceUserId)
        } catch {
          // The in-memory context is still cleared below when browser storage is
          // unavailable; nothing from the prior principal is reused.
        }
      }
      setState(EMPTY)
      setPersistenceUserId(null)
      return
    }
    let restored: InteractionState | null = null
    try {
      restored = parsePersistedOperatingInteractionState(window.sessionStorage.getItem(persistedOperatingInteractionKey(authenticatedUserId)))
    } catch {
      restored = null
    }
    const deepLink = currentDeepLink(pathname)
    setState((current) => ({
      ...(restored ?? current),
      activeWorkId: deepLink.activeWorkId ?? restored?.activeWorkId ?? current.activeWorkId,
      focusedEntity: deepLink.focusedEntity ?? restored?.focusedEntity ?? current.focusedEntity,
      selectedEntities: unique([...(restored?.selectedEntities ?? current.selectedEntities), ...deepLink.contextualEntities]).slice(0, 50),
      surface: { ...(restored?.surface ?? current.surface), id: routeSurface(pathname), route: pathname },
    }))
    setPersistenceUserId(authenticatedUserId)
  }, [auth.loading, authenticatedUserId, pathname, persistenceUserId])

  useEffect(() => {
    if (!authenticatedUserId || persistenceUserId !== authenticatedUserId) return
    try {
      window.sessionStorage.setItem(persistedOperatingInteractionKey(authenticatedUserId), serializeOperatingInteractionState(state))
    } catch {
      // Storage can be unavailable in privacy-restricted browsers. URL and
      // canonical Work restoration continue to provide truthful continuity.
    }
  }, [authenticatedUserId, persistenceUserId, state])

  const remember = useCallback((labels: Record<string, string>, ref: OperatingEntityRef, label?: string) => label ? { ...labels, [refKey(ref)]: label } : labels, [])
  const focusEntity = useCallback((ref: OperatingEntityRef, label?: string) => setState((current) => ({ ...current, focusedEntity: ref, labels: remember(current.labels, ref, label) })), [remember])
  const toggleEntity = useCallback((ref: OperatingEntityRef, label?: string) => setState((current) => {
    const exists = current.selectedEntities.some((item) => refKey(item) === refKey(ref))
    return {
      ...current,
      focusedEntity: ref,
      selectedEntities: exists ? current.selectedEntities.filter((item) => refKey(item) !== refKey(ref)) : unique([...current.selectedEntities, ref]).slice(0, 50),
      excludedEntities: current.excludedEntities.filter((item) => refKey(item) !== refKey(ref)),
      labels: remember(current.labels, ref, label),
    }
  }), [remember])
  const excludeEntity = useCallback((ref: OperatingEntityRef, excluded = true, label?: string) => setState((current) => ({
    ...current,
    excludedEntities: excluded ? unique([...current.excludedEntities, ref]).slice(0, 50) : current.excludedEntities.filter((item) => refKey(item) !== refKey(ref)),
    focusedEntity: current.focusedEntity && refKey(current.focusedEntity) === refKey(ref) ? null : current.focusedEntity,
    labels: remember(current.labels, ref, label),
  })), [remember])
  const setSurface = useCallback((surface: Surface) => setState((current) => ({ ...current, surface })), [])
  const setFilters = useCallback((filters: Filter[]) => setState((current) => ({ ...current, filters: filters.slice(0, 20) })), [])
  const setTimeContext = useCallback((timeContext: InteractionState["timeContext"]) => setState((current) => ({ ...current, timeContext })), [])
  const setCohort = useCallback((cohort: Cohort | null) => setState((current) => ({ ...current, cohort })), [])
  const clearSelection = useCallback(() => setState((current) => ({ ...current, focusedEntity: null, selectedEntities: [], excludedEntities: [], cohort: null, labels: {} })), [])
  const beginUnrelatedWork = useCallback(() => setState((current) => ({ ...current, activeWorkId: null, focusedEntity: null, selectedEntities: [], excludedEntities: [], filters: [], timeContext: undefined, cohort: null, labels: {} })), [])
  const bindWork = useCallback((workId: string | null) => setState((current) => ({ ...current, activeWorkId: workId })), [])
  const restore = useCallback((context: OperatingInteractionContextValue | null, workId?: string | null) => {
    if (!context || context.version !== 1) return
    const currentPath = typeof window === "undefined" ? null : window.location.pathname
    const deepLink = currentPath ? currentDeepLink(currentPath) : null
    const explicitFocus = deepLink?.focusedEntity ?? null
    const contextRefs = [context.focusedEntity, ...(context.selectedEntities ?? [])].filter((ref): ref is OperatingEntityRef => Boolean(ref))
    const deepLinkMatchesSelection = Boolean(explicitFocus && contextRefs.some((ref) => refKey(ref) === refKey(explicitFocus)))
    const replacesSelection = Boolean(explicitFocus && !deepLinkMatchesSelection)
    setState((current) => ({
      ...current,
      activeWorkId: deepLink?.activeWorkId ?? workId ?? context.activeWork?.workId ?? null,
      focusedEntity: explicitFocus ?? context.focusedEntity ?? null,
      selectedEntities: unique([...(replacesSelection ? [] : context.selectedEntities ?? []), ...(deepLink?.contextualEntities ?? [])]),
      excludedEntities: replacesSelection ? [] : unique(context.excludedEntities ?? []),
      surface: currentPath ? { ...context.surface, id: routeSurface(currentPath), route: currentPath } : context.surface,
      filters: context.filters ?? [],
      timeContext: context.timeContext,
      cohort: replacesSelection ? null : context.cohort ?? null,
    }))
  }, [])
  const capture = useCallback((source: "voice" | "typed", continuingWorkId?: string | null): OperatingInteractionContextValue => ({
    version: 1,
    capturedAt: new Date().toISOString(),
    source: source === "typed" ? "text" : "voice",
    ...(continuingWorkId ? { activeWork: { workId: continuingWorkId } } : {}),
    ...(stateRef.current.focusedEntity ? { focusedEntity: stateRef.current.focusedEntity } : {}),
    selectedEntities: stateRef.current.selectedEntities,
    excludedEntities: stateRef.current.excludedEntities,
    surface: stateRef.current.surface,
    filters: stateRef.current.filters,
    ...(stateRef.current.timeContext ? { timeContext: stateRef.current.timeContext } : {}),
    ...(stateRef.current.cohort ? { cohort: stateRef.current.cohort } : {}),
  }), [])

  const actions = useMemo<OperatingInteractionActions>(() => ({
    focusEntity, toggleEntity, excludeEntity, setSurface, setFilters, setTimeContext, setCohort,
    clearSelection, beginUnrelatedWork, bindWork, restore, capture,
  }), [focusEntity, toggleEntity, excludeEntity, setSurface, setFilters, setTimeContext, setCohort, clearSelection, beginUnrelatedWork, bindWork, restore, capture])
  const value = useMemo<OperatingInteractionState>(() => ({ ...state, ...actions }), [actions, state])
  return <OperatingInteractionActionsContext.Provider value={actions}><OperatingInteractionContext.Provider value={value}>{children}</OperatingInteractionContext.Provider></OperatingInteractionActionsContext.Provider>
}

export function useOperatingInteractionActions(): OperatingInteractionActions {
  const context = useContext(OperatingInteractionActionsContext)
  if (!context) throw new Error("useOperatingInteractionActions() called outside <OperatingInteractionProvider>")
  return context
}

export function useOperatingInteraction(): OperatingInteractionState {
  const context = useContext(OperatingInteractionContext)
  if (!context) throw new Error("useOperatingInteraction() called outside <OperatingInteractionProvider>")
  return context
}

export function operatingInteractionFromWorkAggregate(value: unknown): OperatingInteractionContextValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  const work = root.work && typeof root.work === "object" && !Array.isArray(root.work) ? root.work as Record<string, unknown> : null
  const context = work?.activeContext
  if (!context || typeof context !== "object" || Array.isArray(context) || (context as { version?: unknown }).version !== 1) return null
  return context as OperatingInteractionContextValue
}
