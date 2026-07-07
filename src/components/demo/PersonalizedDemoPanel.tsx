"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import Vapi from "@vapi-ai/web"
import {
  Bot,
  CheckCircle2,
  Clock3,
  Ear,
  Mic,
  PhoneCall,
  PhoneOff,
  Radio,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { DemoGenerationStage, DemoIntakeHandoff, GenerateDemoResponse } from "@/lib/demo/types"
import { missingVapiVariableKeys, toVapiVariableValues } from "@/lib/demo/voice-profile"
import { voiceConfig } from "@/lib/voice/config"
import { buildDemoPreviewHandoff } from "@/lib/demo/intake-extraction"
import { getWorkflowDefinition, type DemoWorkflowType } from "@/lib/demo/workflows"
import { Button } from "@/components/ui/button"
import {
  buildIntakeSnapshot,
  MemoPostCallHandoff,
  type DemoTranscriptItem,
} from "@/components/demo/PostCallHandoff"

type CallState =
  | "ready"
  | "preparing"
  | "connected"
  | "listening"
  | "responding"
  | "extracting_handoff"
  | "ended"
  | "error"
type MicState = "unknown" | "requesting" | "granted" | "denied"

type TranscriptItem = DemoTranscriptItem

type PersonalizedDemoPanelProps = {
  result: GenerateDemoResponse
  onActiveStepChange: (step: number) => void
  onCallActivity: () => void
  onCallStatusChange: (stage: DemoGenerationStage) => void
}

const CALL_MAX_DURATION_SECONDS = 210
const CALL_SAFETY_TIMEOUT_MS = CALL_MAX_DURATION_SECONDS * 1000

function mockTranscriptFor(
  companyName: string,
  workflowType: DemoWorkflowType
): TranscriptItem[] {
  const timestamp = new Date().toISOString()
  if (workflowType === "water_treatment") {
    return [
      {
        role: "assistant",
        text: `Thanks for calling ${companyName}. This is Sarah. How can I help with your water today?`,
        timestamp,
      },
      {
        role: "user",
        text: "My name is Jennifer. We are at 142 Millbrook Road in Harrisonburg, and my callback number is 555-123-4567.",
        timestamp,
      },
      {
        role: "assistant",
        text: "What water source and water quality concern are you calling about?",
        timestamp,
      },
      {
        role: "user",
        text: "We are on well water. There is a sulfur smell and hard water.",
        timestamp,
      },
      {
        role: "assistant",
        text: "What treatment options are you interested in, and what timeline are you considering?",
        timestamp,
      },
      {
        role: "user",
        text: "A water softener and whole-house filtration, ideally within the next few weeks. An afternoon callback is best.",
        timestamp,
      },
      {
        role: "assistant",
        text: "Got it. I captured the water source, concern, system interest, timeline, and callback preference for the CSR team. Do you need help with anything else?",
        timestamp,
      },
      {
        role: "user",
        text: "No thanks.",
        timestamp,
      },
      {
        role: "assistant",
        text: "Understood. I will end the call and send the handoff now.",
        timestamp,
      },
    ]
  }

  return [
    {
      role: "assistant",
      text: `Thanks for calling ${companyName} emergency dispatch. This is Sarah. What's happening with your water?`,
      timestamp,
    },
    {
      role: "user",
      text: "My name is Sarah. We are at 142 Millbrook Road in Harrisonburg. My family of 4 has had no water since 11pm, and the submersible well pump stopped working around midnight.",
      timestamp,
    },
    {
      role: "assistant",
      text: "Is the pressure tank showing a pressure reading, and do you know the pump type?",
      timestamp,
    },
    {
      role: "user",
      text: "It is a submersible well pump with a pressure tank, and the tank is showing zero pressure.",
      timestamp,
    },
    {
      role: "assistant",
      text: "Is anyone in immediate danger, and what is the best callback path?",
      timestamp,
    },
    {
      role: "user",
      text: "No immediate danger. Call me directly.",
      timestamp,
    },
    {
      role: "assistant",
      text: "What callback number should the on-call tech use?",
      timestamp,
    },
    {
      role: "user",
      text: "The best callback number is 555-123-4567.",
      timestamp,
    },
      {
        role: "assistant",
        text: "Got it. I have structured the job details and alerted the on-call team. Do you need help with anything else?",
        timestamp,
      },
      {
        role: "user",
        text: "No thanks.",
        timestamp,
      },
      {
        role: "assistant",
        text: "Understood. I will end the call and send the handoff now.",
        timestamp,
      },
  ]
}

function shouldAutoEndCall(transcript: TranscriptItem[]) {
  const latest = transcript[transcript.length - 1]
  if (!latest || latest.role !== "user") return false

  const latestText = latest.text.toLowerCase()
  const userDeclinedMoreHelp =
    /\b(no thanks|no thank you|nope|nah|nothing else|that'?s all|that is all|all good|i'?m good|im good)\b/.test(
      latestText
    ) || /^no[.! ]*$/.test(latestText.trim())

  if (!userDeclinedMoreHelp) return false

  return transcript.slice(-6, -1).some((item) => {
    if (item.role !== "assistant") return false
    const text = item.text.toLowerCase()
    return (
      text.includes("anything else") ||
      text.includes("something else") ||
      /help with .+ else/.test(text) ||
      /need .+ else/.test(text)
    )
  })
}

function buildSuggestedCallerPrompt(
  workflowType: DemoWorkflowType,
  onWell?: boolean
): string {
  if (workflowType === "well_pump_emergency") {
    return "Hi, our whole house has had no water since 11 PM. The pressure tank reads zero, and I think the submersible well pump may have stopped working."
  }

  const waterSource = onWell ?? true
  const waterConcern = waterSource
    ? "sulfur smell and hard water"
    : "chlorine taste and hard water"

  return `Hi, I am looking into a water softener and maybe a whole-house filter. We are on ${
    waterSource ? "well water" : "city water"
  }, there is a ${waterConcern}, and I would like to understand the options.`
}

export function PersonalizedDemoPanel({
  result,
  onActiveStepChange,
  onCallActivity,
  onCallStatusChange,
}: PersonalizedDemoPanelProps) {
  const workflow = getWorkflowDefinition(result.profile.workflowType)
  const suggestedPrompt = buildSuggestedCallerPrompt(
    result.profile.workflowType,
    result.qualification?.onWell
  )
  const [callState, setCallState] = useState<CallState>("ready")
  const [micState, setMicState] = useState<MicState>("unknown")
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isMockCall, setIsMockCall] = useState(false)
  const [callError, setCallError] = useState("")
  const [handoffIntake, setHandoffIntake] = useState<DemoIntakeHandoff | null>(null)

  const vapiRef = useRef<Vapi | null>(null)
  const postCallRef = useRef<HTMLDivElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callTimeoutRef = useRef<number | null>(null)
  const autoEndTimerRef = useRef<number | null>(null)
  const callIdRef = useRef<string | null>(null)
  const callStartedAtRef = useRef<number | null>(null)
  const transcriptRef = useRef<TranscriptItem[]>([])
  const extractionStartedRef = useRef(false)
  const autoEndQueuedRef = useRef(false)
  const seenTranscriptRef = useRef<Set<string>>(new Set())

  const hasVapiConfig = Boolean(
    voiceConfig.vapiPublicKey && voiceConfig.vapiAssistantId && !voiceConfig.mockMode
  )
  const isCallActive =
    callState === "preparing" ||
    callState === "connected" ||
    callState === "listening" ||
    callState === "responding"
  const callFinished = callState === "extracting_handoff" || callState === "ended"

  const vapiVariables = useMemo(
    () => ({
      ...toVapiVariableValues(result.voiceProfile),
      // Quoting context from the live area water data + the dealer's pricing
      // tier. New assistant prompts reference these; older prompts ignore them.
      ...(result.quoting?.variables ?? {}),
    }),
    [result.voiceProfile, result.quoting]
  )
  const missingContextKeys = useMemo(() => missingVapiVariableKeys(vapiVariables), [vapiVariables])
  const hasDemoContext = missingContextKeys.length === 0
  const intakeSnapshot = useMemo(
    () =>
      handoffIntake ||
      buildIntakeSnapshot(
        transcript,
        result.profile.company_name,
        result.profile.workflowType
      ),
    [handoffIntake, result.profile.company_name, result.profile.workflowType, transcript]
  )

  useEffect(() => {
    console.info("[FINNOR demo voice config]", {
      publicKeyPresent: Boolean(voiceConfig.vapiPublicKey),
      assistantIdPresent: Boolean(voiceConfig.vapiAssistantId),
      mockMode: voiceConfig.mockMode,
    })

    if (hasVapiConfig && !vapiRef.current) {
      vapiRef.current = new Vapi(voiceConfig.vapiPublicKey.trim())
    }
  }, [hasVapiConfig])

  useEffect(() => {
    if (!isCallActive || callState === "preparing") return
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [callState, isCallActive])

  useEffect(() => {
    if (!isCallActive) return
    let step = 0
    onActiveStepChange(step)
    const timer = setInterval(() => {
      step = Math.min(step + 1, 4)
      onActiveStepChange(step)
    }, 1450)

    return () => clearInterval(timer)
  }, [isCallActive, onActiveStepChange])

  useEffect(() => {
    return () => {
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current)
      }
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current)
      }
      if (autoEndTimerRef.current) {
        clearTimeout(autoEndTimerRef.current)
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (vapiRef.current) {
        vapiRef.current.removeAllListeners()
        void vapiRef.current.stop()
      }
    }
  }, [])

  useEffect(() => {
    if (callState !== "ended") return
    const timer = window.setTimeout(() => {
      postCallRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [callState])

  async function startCall() {
    if (isCallActive || callFinished) return

    setIsMockCall(false)
    setTranscript([])
    transcriptRef.current = []
    setHandoffIntake(null)
    extractionStartedRef.current = false
    autoEndQueuedRef.current = false
    seenTranscriptRef.current.clear()
    setElapsedSeconds(0)
    setCallError("")
    setCallState("preparing")
    callStartedAtRef.current = performance.now()
    onCallStatusChange("connecting")
    onActiveStepChange(0)

    if (!hasDemoContext) {
      setCallState("error")
      onCallStatusChange("error")
      setCallError("Demo context is missing. Please generate the demo again.")
      return
    }

    if (hasVapiConfig) {
      const preflightError = browserPreflightError()
      if (preflightError) {
        console.info("[FINNOR demo mic preflight]", {
          mediaDevicesPresent: Boolean(navigator.mediaDevices),
          getUserMediaPresent: Boolean(navigator.mediaDevices?.getUserMedia),
          secureContext: window.isSecureContext,
        })
        setCallState("error")
        onCallStatusChange("error")
        setCallError(preflightError)
        return
      }

      await startVapiCall()
      return
    }

    setIsMockCall(true)
    setMicState("granted")
    await startMockCall()
  }

  async function startVapiCall() {
    try {
      const publicKey = voiceConfig.vapiPublicKey.trim()
      const assistantId = voiceConfig.vapiAssistantId.trim()
      if (!publicKey) {
        setCallState("error")
        onCallStatusChange("error")
        setCallError("Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY")
        return
      }
      if (!assistantId) {
        setCallState("error")
        onCallStatusChange("error")
        setCallError("Missing NEXT_PUBLIC_VAPI_ASSISTANT_ID")
        return
      }

      const vapi = vapiRef.current || new Vapi(publicKey)
      vapiRef.current = vapi
      vapi.removeAllListeners()

      vapi.on("call-start", () => {
        const startupMs = callStartedAtRef.current
          ? Math.round(performance.now() - callStartedAtRef.current)
          : null
        console.info("[FINNOR Vapi call-start]", { startupMs })
        setMicState("granted")
        setCallState("listening")
        onCallStatusChange("live")
        onCallActivity()
        void updateLead({
          call_started: true,
          status: "call_started",
          vapi_call_id: callIdRef.current,
        })
        callTimeoutRef.current = window.setTimeout(() => {
          console.info("Call auto-ended by safety timer")
          void endCall()
        }, CALL_SAFETY_TIMEOUT_MS)
        console.info("Call safety timer started")
      })

      vapi.on("call-end", () => {
        console.info("[FINNOR Vapi call-end]")
        void finishCallAndExtract("call_ended")
      })

      vapi.on("speech-start", () => setCallState("responding"))
      vapi.on("speech-end", () => setCallState("listening"))

      vapi.on("call-start-success", (event) => {
        callIdRef.current = event.callId && event.callId !== "unknown" ? event.callId : callIdRef.current
      })

      vapi.on("call-start-progress", (event) => {
        console.info("[FINNOR Vapi call-start-progress]", event)
      })

      vapi.on("call-start-failed", (event) => {
        console.error("[FINNOR Vapi call-start-failed]", event)
        clearCallTimeout()
        setCallState("error")
        onCallStatusChange("error")
        setCallError("The live voice call could not start. Please check the Vapi configuration.")
      })

      vapi.on("message", (message: unknown) => {
        const speechState = speechStateFromVapiMessage(message)
        if (speechState) {
          setCallState(speechState)
        }
        const transcriptItems = transcriptItemsFromVapiMessage(message)
        logTranscriptItems(transcriptItems)
        appendTranscript(transcriptItems)
      })

      vapi.on("error", (error) => {
        console.error("[FINNOR Vapi error]", error)
        clearCallTimeout()
        if (voiceConfig.mockMode) {
          setIsMockCall(true)
          void startMockCall()
          return
        }

        setCallState("error")
        onCallStatusChange("error")
        setCallError("The live voice call could not start. Please check the Vapi configuration.")
      })

      const call = (await vapi.start(
        assistantId,
        {
          firstMessage: workflow.firstMessage.replace(
            "{{company}}",
            result.voiceProfile.companyName
          ),
          firstMessageMode: "assistant-speaks-first",
          maxDurationSeconds: CALL_MAX_DURATION_SECONDS,
          variableValues: vapiVariables,
        },
        undefined,
        undefined,
        undefined,
        { roomDeleteOnUserLeaveEnabled: true }
      )) as { id?: string } | null

      callIdRef.current = call?.id || null
      void updateLead({
        call_started: true,
        status: "call_started",
        vapi_call_id: callIdRef.current,
      })
    } catch (error) {
      console.error("[FINNOR Vapi start error]", error)
      clearCallTimeout()
      if (voiceConfig.mockMode) {
        setIsMockCall(true)
        await startMockCall()
        return
      }

      setCallState("error")
      onCallStatusChange("error")
      setCallError("The live voice call could not start. Please check the Vapi configuration.")
    }
  }

  async function startMockCall() {
    clearMockTimer()
    setMicState((current) => (current === "denied" ? "denied" : "granted"))
    setCallState("connected")
    onCallStatusChange("live")
    onCallActivity()
    void updateLead({ call_started: true, status: "mock_call_started" })
    setCallState("listening")

    let index = 0
    const mockTranscript = mockTranscriptFor(
      result.voiceProfile.companyName,
      result.profile.workflowType
    )
    mockTimerRef.current = setInterval(() => {
      const item = mockTranscript[index]
      if (!item) {
        clearMockTimer()
        clearCallTimeout()
        window.setTimeout(() => {
          void finishCallAndExtract("mock_call_ended")
        }, 2600)
        return
      }

      setCallState(item.role === "assistant" ? "responding" : "listening")
      appendTranscript([item])
      index += 1
    }, 1750)
  }

  async function endCall() {
    if (callState === "ended" || callState === "extracting_handoff") return
    onCallStatusChange("ending")
    clearCallTimeout()
    clearAutoEndTimer()
    clearMockTimer()
    cleanupLocalMedia()

    if (vapiRef.current) {
      await vapiRef.current.stop()
      vapiRef.current = null
    }

    await finishCallAndExtract(isMockCall ? "mock_call_ended" : "call_ended")
  }

  async function finishCallAndExtract(status: string) {
    if (extractionStartedRef.current) return
    extractionStartedRef.current = true
    clearCallTimeout()
    clearAutoEndTimer()
    clearMockTimer()
    cleanupLocalMedia()
    setCallState("extracting_handoff")
    onCallStatusChange("extracting_handoff")
    onActiveStepChange(4)
    await updateLead({ call_ended: true, status })

    try {
      const response = await fetch("/api/demo/extract-intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptRef.current,
          companyProfile: result.profile,
          safeDemoScenario: result.voiceProfile.safeDemoScenario,
          workflowType: result.profile.workflowType,
          householdId: result.household_id ?? null,
          household: result.household ?? null,
        }),
      })
      const intake = (await response.json()) as DemoIntakeHandoff
      setHandoffIntake(intake)
    } catch {
      setHandoffIntake(
        buildDemoPreviewHandoff(
          result.profile.company_name,
          result.voiceProfile.safeDemoScenario,
          result.profile.workflowType
        )
      )
    } finally {
      setCallState("ended")
      onCallStatusChange("ended")
    }
  }

  function browserPreflightError() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return "Microphone permission blocked. Please allow mic access and try again."
    }
    if (!window.isSecureContext) {
      return "Microphone permission blocked. Please allow mic access and try again."
    }
    return ""
  }

  function clearMockTimer() {
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current)
      mockTimerRef.current = null
    }
  }

  function clearCallTimeout() {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current)
      callTimeoutRef.current = null
      console.info("Call safety timer cleared")
    }
  }

  function cleanupLocalMedia() {
    clearMockTimer()
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  async function updateLead(payload: {
    call_started?: boolean
    call_ended?: boolean
    status?: string
    vapi_call_id?: string | null
  }) {
    if (!result.lead_id) return

    try {
      await fetch("/api/demo-leads/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead_id: result.lead_id,
          ...payload,
        }),
      })
    } catch {
      // Lead capture should never interrupt the demo.
    }
  }

  function appendTranscript(items: TranscriptItem[]) {
    if (!items.length) return
    const nextItems = items.filter((item) => {
      if (!item.text.trim()) return false
      const key = `${item.role}:${item.text}`
      if (seenTranscriptRef.current.has(key)) return false
      seenTranscriptRef.current.add(key)
      return true
    })
    if (!nextItems.length) return
    transcriptRef.current = [...transcriptRef.current, ...nextItems]
    setTranscript(transcriptRef.current)
    queueAutoEndIfCallIsComplete(transcriptRef.current)
  }

  function queueAutoEndIfCallIsComplete(nextTranscript: TranscriptItem[]) {
    if (autoEndQueuedRef.current || extractionStartedRef.current) return
    if (!shouldAutoEndCall(nextTranscript)) return

    autoEndQueuedRef.current = true
    autoEndTimerRef.current = window.setTimeout(() => {
      autoEndTimerRef.current = null
      void endCall()
    }, 900)
  }

  function clearAutoEndTimer() {
    if (autoEndTimerRef.current) {
      clearTimeout(autoEndTimerRef.current)
      autoEndTimerRef.current = null
    }
  }

  function logTranscriptItems(items: TranscriptItem[]) {
    items.forEach((item) => {
      console.info("[FINNOR Vapi transcript]", {
        role: item.role,
        text: item.text,
      })
    })
  }

  const statusLabel = statusCopy(callState)

  return (
    <section className="relative border-t border-white/5 py-20 md:py-28">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
      <div className="container relative z-10 px-4 md:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card overflow-hidden rounded-3xl border-white/10 bg-black/70 shadow-2xl"
        >
          <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
            <div className="relative p-6 md:p-8 lg:p-10">
              <div className="absolute right-8 top-8 h-44 w-44 rounded-full bg-cyan-200/[0.08] blur-[80px]" />
              <div className="relative z-10">
                <div className="mb-8 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-cyan-50">
                    <span
                      className={`mr-2 h-1.5 w-1.5 rounded-full ${
                        isCallActive ? "animate-pulse bg-cyan-200" : "bg-cyan-200"
                      }`}
                    />
                    {statusLabel}
                  </span>
                  {isMockCall || !hasVapiConfig ? (
                    <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.06] px-4 py-1.5 text-xs font-bold text-slate-200">
                      {voiceConfig.mockMode ? "Mock demo mode" : "Voice not configured"}
                    </span>
                  ) : null}
                </div>

                <div className="max-w-3xl">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-slate-300">
                    Personalized agent
                  </p>
                  <h2 className="text-3xl font-black tracking-tighter text-white md:text-5xl">
                    {result.profile.company_name} • {workflow.agentTitle}
                  </h2>
                  <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-slate-300 md:text-lg">
                    {workflow.consoleDescription}
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  {workflow.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-white/12 bg-white/[0.055] px-4 py-2 text-sm font-semibold text-slate-200"
                    >
                      {chip}
                    </span>
                  ))}
                </div>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
                    <Sparkles className="h-4 w-4 text-cyan-100" />
                    Suggested caller prompt
                  </div>
                  <p className="text-base font-semibold leading-relaxed text-white/82">
                    &quot;{suggestedPrompt}&quot;
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-300">
                    {workflow.formDescription}
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                  <Button
                    onClick={startCall}
                    disabled={isCallActive || callFinished || !hasDemoContext}
                    className="h-14 rounded-full bg-white px-8 text-base font-black text-black shadow-[0_0_36px_rgba(255,255,255,0.2)] hover:bg-white/90"
                  >
                    <PhoneCall className="h-5 w-5" />
                    {callFinished ? "Call Complete" : "Start Demo Call"}
                  </Button>
                  <Button
                    onClick={() => void endCall()}
                    disabled={!isCallActive}
                    variant="outline"
                    className="h-14 rounded-full border-white/15 bg-white/[0.04] px-8 text-base font-black text-white hover:border-white/30 hover:bg-white/[0.08] hover:text-white"
                  >
                    <PhoneOff className="h-5 w-5" />
                    End Call
                  </Button>
                </div>
                <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-300">
                  For best quality, use Chrome and allow microphone access.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <ConsoleMetric icon={Mic} label="Mic" value={micCopy(micState)} />
                  <ConsoleMetric icon={Clock3} label="Timer" value={formatTimer(elapsedSeconds)} />
                  <ConsoleMetric
                    icon={ShieldCheck}
                    label="Mode"
                    value={hasVapiConfig && !isMockCall ? "Vapi live" : voiceConfig.mockMode ? "Mock safe" : "Not configured"}
                  />
                </div>
                {!hasDemoContext ? (
                  <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-sm font-semibold leading-relaxed text-white">
                    Demo context is missing. Please generate the demo again.
                  </div>
                ) : null}
                {!hasVapiConfig && !voiceConfig.mockMode ? (
                  <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-sm font-semibold leading-relaxed text-white">
                    Live voice is not configured in this environment, so this run uses the safe preview call path.
                  </div>
                ) : null}
                {callError ? (
                  <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-sm font-semibold leading-relaxed text-white">
                    {callError}
                  </div>
                ) : null}
                {callFinished ? (
                  <div className="mt-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.045] p-4 text-sm font-semibold leading-relaxed text-white">
                    Call complete. The lead handoff is ready below.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/10 bg-white/[0.025] p-6 md:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-300">
                    Live call console
                  </p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight text-white">
                    Sarah is {callState === "responding" ? "responding" : "listening"}
                  </h3>
                </div>
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/60">
                  {isCallActive ? (
                    <span className="absolute h-full w-full animate-ping rounded-2xl border border-cyan-200/30" />
                  ) : null}
                  {callState === "responding" ? (
                    <Waves className="h-7 w-7 text-cyan-50" />
                  ) : (
                    <Bot className="h-7 w-7 text-cyan-50" />
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <StateIndicator
                  active={callState === "listening" || callState === "connected"}
                  icon={Ear}
                  label="AI is listening"
                />
                <StateIndicator
                  active={callState === "responding"}
                  icon={Radio}
                  label="AI is responding"
                />
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-black/55 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
                    <Radio className="h-4 w-4 text-cyan-100" />
                    Waveform
                  </span>
                  <span className="text-xs font-bold text-slate-300">
                    {isCallActive ? statusLabel : "Standby"}
                  </span>
                </div>
                <div className="flex h-24 items-end justify-center gap-2">
                  {Array.from({ length: 24 }).map((_, index) => (
                    <motion.span
                      key={index}
                      animate={
                        isCallActive
                          ? { scaleY: [0.35 + (index % 5) * 0.12, 0.92 + (index % 6) * 0.08] }
                          : { scaleY: 0.28 }
                      }
                      transition={{
                        duration: callState === "responding" ? 0.52 : 0.82,
                        repeat: isCallActive ? Infinity : 0,
                        repeatType: "reverse",
                        delay: index * 0.025,
                      }}
                      className="h-16 w-1.5 origin-bottom rounded-full bg-gradient-to-t from-cyan-200/20 via-cyan-100/65 to-white/90 will-change-transform"
                    />
                  ))}
                </div>
              </div>

              <IntakeChecklist
                intake={intakeSnapshot}
                active={isCallActive || callState === "ended"}
                workflowType={result.profile.workflowType}
              />

              <div className="mt-6 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {transcript.length ? (
                  transcript.slice(-10).map((item, index) => (
                    <motion.div
                      key={`${item.role}-${index}-${item.text}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-2xl border p-4 ${
                        item.role === "assistant"
                          ? "border-cyan-200/15 bg-cyan-200/[0.045]"
                          : "border-white/10 bg-white/[0.035]"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
                        <CheckCircle2 className="h-3.5 w-3.5 text-cyan-100" />
                        {transcriptRoleLabel(item.role)}
                      </div>
                      <p className="text-sm leading-relaxed text-white/70">{item.text}</p>
                    </motion.div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 text-sm font-semibold leading-relaxed text-slate-300">
                    Demo ready. Start the call to see transcript events, intake capture, and
                    handoff signals.
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
        {callState === "extracting_handoff" ? (
          <div ref={postCallRef} className="mt-8 rounded-3xl border border-cyan-200/15 bg-cyan-200/[0.045] p-6 text-sm font-black uppercase tracking-widest text-cyan-50">
            Extracting {workflow.shortLabel.toLowerCase()} handoff...
          </div>
        ) : null}
        {callState === "ended" && handoffIntake ? (
          <div ref={postCallRef}>
            <MemoPostCallHandoff
              companyName={result.profile.company_name}
              transcript={transcript}
              artifacts={result.artifacts}
              intake={handoffIntake}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ConsoleMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <Icon className="mb-3 h-4 w-4 text-cyan-100" />
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">{label}</p>
      <p className="mt-1 text-sm font-bold text-white">{value}</p>
    </div>
  )
}

function StateIndicator({
  active,
  icon: Icon,
  label,
}: {
  active: boolean
  icon: LucideIcon
  label: string
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-all duration-500 ${
        active
          ? "border-cyan-200/35 bg-cyan-200/[0.07] text-cyan-50"
          : "border-white/10 bg-white/[0.04] text-slate-300"
      }`}
    >
      <Icon className="mb-3 h-5 w-5" />
      <p className="text-xs font-black uppercase tracking-widest">{label}</p>
    </div>
  )
}

function speechStateFromVapiMessage(message: unknown): CallState | null {
  if (!message || typeof message !== "object") return null
  const record = message as { type?: string; role?: string; status?: string }

  if (record.type !== "speech-update") return null
  if (record.status === "started") {
    return record.role === "assistant" ? "responding" : "listening"
  }
  if (record.status === "stopped") return "listening"
  return null
}

function transcriptItemsFromVapiMessage(message: unknown): TranscriptItem[] {
  if (!message || typeof message !== "object") return []
  const record = message as {
    type?: string
    role?: string
    transcript?: string
    transcriptType?: string
    message?: { role?: string; content?: string }
    messages?: Array<{ role?: string; message?: string; content?: string }>
    messagesOpenAIFormatted?: Array<{ role?: string; content?: unknown }>
  }
  const timestamp = new Date().toISOString()

  if (
    (record.type === "transcript" || record.type === "transcript[transcriptType='final']") &&
    record.transcript &&
    record.transcriptType !== "partial"
  ) {
    const role = normalizeTranscriptRole(record.role)
    if (!role) return []
    return [{
      role,
      text: record.transcript,
      timestamp,
    }]
  }

  if (record.message?.content && record.message.role !== "system") {
    const role = normalizeTranscriptRole(record.message.role)
    if (!role) return []
    return [{
      role,
      text: record.message.content,
      timestamp,
    }]
  }

  if (record.type === "conversation-update") {
    const messages: Array<{ role?: string; content: string }> = record.messages?.length
      ? record.messages.map((item) => ({
          role: item.role,
          content: item.message || item.content || "",
        }))
      : record.messagesOpenAIFormatted?.map((item) => ({
          role: item.role,
          content: extractTextContent(item.content),
        })) || []

    return messages
      .filter((item) => item.role !== "system")
      .map<TranscriptItem>((item) => ({
        role: normalizeTranscriptRole(item.role) || "assistant",
        text: item.content || "",
        timestamp,
      }))
      .filter((item) => item.text.trim().length > 0 && Boolean(item.role))
  }

  return []
}

function normalizeTranscriptRole(role: unknown): TranscriptItem["role"] | null {
  if (role === "user" || role === "human" || role === "customer") return "user"
  if (role === "assistant" || role === "bot" || role === "ai") return "assistant"
  return null
}

function transcriptRoleLabel(role: TranscriptItem["role"]) {
  return role === "assistant" ? "AI" : "Caller"
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && "text" in part) {
        const textPart = part as { text?: unknown }
        return typeof textPart.text === "string" ? textPart.text : ""
      }
      return ""
    })
    .filter(Boolean)
    .join(" ")
}

function statusCopy(state: CallState) {
  switch (state) {
    case "preparing":
      return "Preparing"
    case "connected":
      return "Connected"
    case "listening":
      return "Listening"
    case "responding":
      return "AI responding"
    case "extracting_handoff":
      return "Extracting handoff"
    case "ended":
      return "Ended"
    case "error":
      return "Error"
    default:
      return "Ready"
  }
}

function IntakeChecklist({
  intake,
  active,
  workflowType,
}: {
  intake: ReturnType<typeof buildIntakeSnapshot>
  active: boolean
  workflowType: DemoWorkflowType
}) {
  const captured = (value: string) =>
    Boolean(
      value &&
        value !== "Needs confirmation" &&
        value !== "Not captured during call" &&
        value !== "Not captured yet" &&
        value !== "Waiting for caller"
    )
  const items: Array<[string, boolean]> =
    workflowType === "water_treatment"
      ? [
          ["Caller name", intake.completedFields.callerName],
          ["Callback number", intake.completedFields.callbackNumber],
          ["Address / service area", intake.completedFields.facilityName],
          ["Water source", captured(intake.waterSource)],
          ["Water concern", intake.completedFields.mainConcern],
          ["System interest", captured(intake.systemInterest)],
          ["Timeline", captured(intake.timeline)],
          ["Callback preference", captured(intake.callbackPreference)],
        ]
      : [
          ["Caller name", intake.completedFields.callerName],
          ["Callback number", intake.completedFields.callbackNumber],
          ["Service address", intake.completedFields.facilityName],
          ["No-water / low-pressure issue", intake.completedFields.mainConcern],
          ["Whole-house or partial", captured(intake.wholeHouseOrPartial)],
          ["Since when", captured(intake.sinceWhen)],
          ["People affected", captured(intake.peopleAffected)],
          ["Safety screen", captured(intake.safetyScreen)],
        ]

  return (
    <div className="mt-6 rounded-3xl border border-white/10 bg-black/45 p-5">
      <p className="mb-4 text-xs font-black uppercase tracking-widest text-slate-300">
        Intake checklist
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(([label, complete]) => (
          <div
            key={label}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
              complete && active
                ? "border-cyan-200/25 bg-cyan-200/[0.055] text-cyan-50"
                : "border-white/10 bg-white/[0.04] text-slate-300"
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

function micCopy(state: MicState) {
  switch (state) {
    case "requesting":
      return "Requesting"
    case "granted":
      return "Allowed"
    case "denied":
      return "Mock only"
    default:
      return "Ready"
  }
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}
