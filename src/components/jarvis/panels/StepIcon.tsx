"use client"

// Shared step-type → icon map for WorkflowTheater, both live and blueprint modes.
import {
  FileText,
  PenLine,
  Box,
  Link2,
  Send,
  PhoneCall,
  CalendarCheck,
  RefreshCw,
  Wrench,
  DollarSign,
  PackageCheck,
  Circle,
} from "lucide-react"

const ICON_MAP: Record<string, typeof FileText> = {
  generate_document: FileText,
  request_signature: PenLine,
  reserve_stock: Box,
  receive_procurement: PackageCheck,
  create_payment_link: Link2,
  send_message: Send,
  send_confirmation_call: PhoneCall,
  hold_appointment: CalendarCheck,
  confirm_appointment: CalendarCheck,
  sync_invoice: RefreshCw,
  create_work_order: Wrench,
  record_deposit_payment: DollarSign,
}

export function StepIcon({ stepType, className = "h-4 w-4" }: { stepType: string; className?: string }) {
  const Icon = ICON_MAP[stepType] ?? Circle
  return <Icon className={className} />
}

export function humanizeStepType(stepType: string): string {
  return stepType.replaceAll("_", " ")
}

export function humanizeWorkflowType(workflowType: string): string {
  return workflowType
    .replaceAll("_", " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}
