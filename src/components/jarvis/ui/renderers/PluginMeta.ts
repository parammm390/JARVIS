// D3.T1 — plugin family -> icon/accent, the generalized form of StepIcon.tsx's
// ICON_MAP precedent (that file keys on workflow *step* types like generate_document;
// this keys on the 21 domain *plugins* that own the 41 action types — a distinct,
// wider taxonomy, not a rename of the same map).

import {
  Droplets,
  RefreshCw,
  Users,
  Boxes,
  CalendarClock,
  FileText,
  DollarSign,
  Megaphone,
  MessageCircle,
  BookOpen,
  Send,
  Radio,
  ClipboardList,
  BellRing,
  ShieldCheck,
  Search,
  LayoutDashboard,
  Waves,
  PenLine,
  HardHat,
  Landmark,
  type LucideIcon,
} from "lucide-react"

export interface PluginStyle {
  label: string
  icon: LucideIcon
  accent: string // tailwind color token family, e.g. "cyan" | "teal" | "violet" | "amber"
}

export const PLUGIN_META: Record<string, PluginStyle> = {
  "water-test": { label: "Water Test", icon: Droplets, accent: "cyan" },
  "maintenance-agreement": { label: "Maintenance Agreement", icon: RefreshCw, accent: "teal" },
  crm: { label: "CRM", icon: Users, accent: "violet" },
  inventory: { label: "Inventory", icon: Boxes, accent: "amber" },
  scheduling: { label: "Scheduling", icon: CalendarClock, accent: "cyan" },
  quotation: { label: "Quotation", icon: FileText, accent: "teal" },
  accounting: { label: "Accounting", icon: DollarSign, accent: "amber" },
  marketing: { label: "Marketing", icon: Megaphone, accent: "violet" },
  "customer-comm": { label: "Customer Comms", icon: MessageCircle, accent: "cyan" },
  "water-domain-knowledge": { label: "Water Knowledge", icon: BookOpen, accent: "teal" },
  "proposal-batch": { label: "Proposal Batch", icon: Send, accent: "violet" },
  "bulk-notify": { label: "Bulk Notify", icon: Radio, accent: "amber" },
  "technician-reports": { label: "Technician Reports", icon: ClipboardList, accent: "cyan" },
  "service-reminders": { label: "Service Reminders", icon: BellRing, accent: "teal" },
  "compliance-documentation": { label: "Compliance", icon: ShieldCheck, accent: "amber" },
  "web-research": { label: "Web Research", icon: Search, accent: "violet" },
  "ops-overview": { label: "Ops Overview", icon: LayoutDashboard, accent: "cyan" },
  "lead-to-water-test": { label: "Lead → Water Test", icon: Waves, accent: "teal" },
  "proposal-signature": { label: "Proposal Signature", icon: PenLine, accent: "violet" },
  "proposal-to-installation": { label: "Installation", icon: HardHat, accent: "amber" },
  "invoice-to-cash": { label: "Invoice → Cash", icon: Landmark, accent: "cyan" },
}

export const ACCENT_CLASS: Record<string, { bg: string; text: string; border: string }> = {
  cyan: { bg: "bg-cyan-400/10", text: "text-cyan-300", border: "border-cyan-400/25" },
  teal: { bg: "bg-teal-300/10", text: "text-teal-200", border: "border-teal-300/25" },
  violet: { bg: "bg-violet-400/10", text: "text-violet-300", border: "border-violet-400/25" },
  amber: { bg: "bg-amber-300/10", text: "text-amber-200", border: "border-amber-300/25" },
}
