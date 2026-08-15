"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Check, ChevronDown, ChevronUp, Settings2, X } from "lucide-react"
import { useJarvisAuth } from "./lib/jarvis-auth"
import { jarvisGet, jarvisPut } from "./lib/api"
import { DEFAULT_TENANT_WORKSPACE_CONFIG, WORKSPACE_SURFACES, normalizeWorkspaceConfig, type TenantWorkspaceConfig, type WorkspaceSurfaceKey } from "./lib/workspace-config"
import "./jarvis-theme.css"

type ConfigStatus = "idle" | "loading" | "ready" | "saving" | "error"
interface WorkspaceConfigState {
  config: TenantWorkspaceConfig
  editable: boolean
  status: ConfigStatus
  error: string | null
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  save: (config: TenantWorkspaceConfig) => Promise<boolean>
}

const WorkspaceConfigContext = createContext<WorkspaceConfigState>({
  config: DEFAULT_TENANT_WORKSPACE_CONFIG, editable: false, status: "idle", error: null, settingsOpen: false,
  openSettings: () => {}, closeSettings: () => {}, save: async () => false,
})

export function useWorkspaceConfig(): WorkspaceConfigState {
  return useContext(WorkspaceConfigContext)
}

export function WorkspaceSettingsButton({ compact = false }: { compact?: boolean }) {
  const workspace = useWorkspaceConfig()
  if (!workspace.editable) return null
  return <button type="button" className="jarvis-workspace-settings-button" data-compact={compact ? "true" : undefined} onClick={workspace.openSettings} aria-label="Open workspace settings" title="Workspace settings"><Settings2 size={15} aria-hidden /><span>{compact ? "" : "Workspace"}</span></button>
}

function move<T>(values: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction
  if (to < 0 || to >= values.length) return values
  const next = [...values]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}

function WorkspaceSettingsDrawer() {
  const { config, settingsOpen, closeSettings, save, status, error } = useWorkspaceConfig()
  const [draft, setDraft] = useState(config)
  const [saved, setSaved] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!settingsOpen) return
    setDraft(config)
    setSaved(false)
  }, [config, settingsOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeSettings() }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [closeSettings, settingsOpen])

  if (!settingsOpen) return null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const ok = await save(draft)
    setSaved(ok)
  }
  const setSurface = (surface: WorkspaceSurfaceKey, enabled: boolean) => setDraft((current) => ({ ...current, enabledSurfaces: enabled ? Array.from(new Set([...current.enabledSurfaces, surface])) : current.enabledSurfaces.filter((item) => item !== surface) }))

  return (
    <div className="jarvis-workspace-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings() }}>
      <aside className="jarvis-workspace-settings" role="dialog" aria-modal="true" aria-labelledby="jarvis-workspace-settings-title">
        <header><div><span>Tenant workspace</span><h2 id="jarvis-workspace-settings-title">Operational presentation</h2><p>Small, tenant-wide controls only. Authority and backend behavior do not change here.</p></div><button ref={closeButtonRef} type="button" onClick={closeSettings} aria-label="Close workspace settings"><X size={17} /></button></header>
        <form onSubmit={submit}>
          <section><div className="jarvis-workspace-settings__heading"><strong>Enabled surfaces</strong><span>Home always stays available</span></div><div className="jarvis-workspace-settings__checks">{WORKSPACE_SURFACES.map((surface) => <label key={surface}><input type="checkbox" checked={draft.enabledSurfaces.includes(surface)} disabled={surface === "home"} onChange={(event) => setSurface(surface, event.target.checked)} /><span>{draft.terminology[surface]}</span></label>)}</div></section>
          <section><div className="jarvis-workspace-settings__heading"><strong>Terminology</strong><span>Navigation language, 24 characters maximum</span></div><div className="jarvis-workspace-settings__terms">{WORKSPACE_SURFACES.map((surface) => <label key={surface}><span>{surface}</span><input value={draft.terminology[surface]} maxLength={24} required onChange={(event) => setDraft((current) => ({ ...current, terminology: { ...current.terminology, [surface]: event.target.value } }))} /></label>)}</div></section>
          <section className="jarvis-workspace-settings__split"><div><div className="jarvis-workspace-settings__heading"><strong>Voice availability</strong></div><label className="jarvis-workspace-settings__toggle"><input type="checkbox" checked={draft.voiceEnabled} onChange={(event) => setDraft((current) => ({ ...current, voiceEnabled: event.target.checked }))} /><span>Voice command input</span></label></div><div><div className="jarvis-workspace-settings__heading"><strong>Inspector visibility</strong></div><label className="jarvis-workspace-settings__toggle"><input type="checkbox" checked={draft.visibility.policy} onChange={(event) => setDraft((current) => ({ ...current, visibility: { ...current.visibility, policy: event.target.checked } }))} /><span>Policy context</span></label><label className="jarvis-workspace-settings__toggle"><input type="checkbox" checked={draft.visibility.authority} onChange={(event) => setDraft((current) => ({ ...current, visibility: { ...current.visibility, authority: event.target.checked } }))} /><span>Authority context</span></label></div></section>
          <section><div className="jarvis-workspace-settings__heading"><strong>Navigation priority</strong><span>Move the most-used surfaces upward</span></div><ol className="jarvis-workspace-settings__priority">{draft.navigationPriority.map((surface, index) => <li key={surface}><span>{String(index + 1).padStart(2, "0")}</span><strong>{draft.terminology[surface]}</strong><button type="button" disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, navigationPriority: move(current.navigationPriority, index, -1) }))} aria-label={`Move ${draft.terminology[surface]} up`}><ChevronUp size={14} /></button><button type="button" disabled={index === draft.navigationPriority.length - 1} onClick={() => setDraft((current) => ({ ...current, navigationPriority: move(current.navigationPriority, index, 1) }))} aria-label={`Move ${draft.terminology[surface]} down`}><ChevronDown size={14} /></button></li>)}</ol></section>
          <section><div className="jarvis-workspace-settings__heading"><strong>Brand tokens</strong><span>Bounded tokens, never arbitrary CSS</span></div><div className="jarvis-workspace-settings__brand"><label><span>Accent</span><select value={draft.brand.accent} onChange={(event) => setDraft((current) => ({ ...current, brand: { ...current.brand, accent: event.target.value as TenantWorkspaceConfig["brand"]["accent"] } }))}><option value="cyan">Cyan</option><option value="teal">Teal</option><option value="amber">Amber</option><option value="violet">Violet</option></select></label><label><span>Corner tone</span><select value={draft.brand.radius} onChange={(event) => setDraft((current) => ({ ...current, brand: { ...current.brand, radius: event.target.value as TenantWorkspaceConfig["brand"]["radius"] } }))}><option value="soft">Soft</option><option value="precise">Precise</option></select></label><label><span>Mark</span><input value={draft.brand.mark} maxLength={3} required onChange={(event) => setDraft((current) => ({ ...current, brand: { ...current.brand, mark: event.target.value } }))} /></label></div></section>
          {error && <p className="jarvis-workspace-settings__error" role="alert">{error}</p>}
          <footer><span>{saved ? <><Check size={13} /> Saved for this tenant</> : "Presentation only · policy remains authoritative"}</span><button type="button" onClick={closeSettings}>Cancel</button><button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save workspace"}</button></footer>
        </form>
      </aside>
    </div>
  )
}

export function WorkspaceConfigProvider({ children }: { children: ReactNode }) {
  const { session, role } = useJarvisAuth()
  const sessionUserId = session?.user.id ?? null
  const [config, setConfig] = useState(DEFAULT_TENANT_WORKSPACE_CONFIG)
  const [editable, setEditable] = useState(false)
  const [status, setStatus] = useState<ConfigStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!sessionUserId || !role) { setConfig(DEFAULT_TENANT_WORKSPACE_CONFIG); setEditable(false); setStatus("idle"); return }
    let cancelled = false
    setStatus("loading")
    setError(null)
    void jarvisGet<{ config: unknown; editable: boolean }>("workspace-config")
      .then((response) => { if (!cancelled) { setConfig(normalizeWorkspaceConfig(response.config)); setEditable(response.editable); setStatus("ready") } })
      .catch(() => { if (!cancelled) { setConfig(DEFAULT_TENANT_WORKSPACE_CONFIG); setEditable(role === "owner"); setStatus("error"); setError("Tenant workspace controls are not available from the current backend.") } })
    return () => { cancelled = true }
  }, [role, sessionUserId])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.jarvisTenantAccent = config.brand.accent
    root.dataset.jarvisWorkspaceRadius = config.brand.radius
    return () => { delete root.dataset.jarvisTenantAccent; delete root.dataset.jarvisWorkspaceRadius }
  }, [config.brand.accent, config.brand.radius])

  const save = useCallback(async (next: TenantWorkspaceConfig) => {
    setStatus("saving"); setError(null)
    try {
      const response = await jarvisPut<{ config: unknown; editable: boolean }>("workspace-config", next)
      setConfig(normalizeWorkspaceConfig(response.config)); setEditable(response.editable); setStatus("ready")
      return true
    } catch (saveError) {
      setStatus("error"); setError(saveError instanceof Error ? saveError.message : "Workspace configuration could not be saved.")
      return false
    }
  }, [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const value = useMemo<WorkspaceConfigState>(() => ({ config, editable, status, error, settingsOpen, openSettings: () => setSettingsOpen(true), closeSettings, save }), [closeSettings, config, editable, error, save, settingsOpen, status])
  return <WorkspaceConfigContext.Provider value={value}>{children}<WorkspaceSettingsDrawer /></WorkspaceConfigContext.Provider>
}
