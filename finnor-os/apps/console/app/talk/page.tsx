// Talk to Finnor — real voice through the browser microphone via the Vapi Web SDK.
// No phone number, no carrier, no call forwarding required: the assistant streams
// audio both ways and its server tools hit /api/webhooks/vapi like any phone call.
"use client";

import { useEffect, useRef, useState } from "react";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";

export default function TalkPage() {
  const vapiRef = useRef<{ start: (id: string) => void; stop: () => void; on: (e: string, cb: (m?: unknown) => void) => void } | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    import("@vapi-ai/web").then(({ default: Vapi }) => {
      if (!mounted || !PUBLIC_KEY) return;
      const vapi = new Vapi(PUBLIC_KEY);
      vapi.on("call-start", () => setStatus("live"));
      vapi.on("call-end", () => setStatus("idle"));
      vapi.on("error", (e: unknown) => {
        setStatus("error");
        setErrorMsg(String((e as Error)?.message ?? e));
      });
      vapi.on("message", (m: unknown) => {
        const msg = m as { type?: string; transcript?: string; role?: string };
        if (msg.type === "transcript" && msg.transcript) {
          setLines((prev) => [...prev.slice(-30), `${msg.role === "assistant" ? "FINNOR" : "YOU"}: ${msg.transcript}`]);
        }
      });
      vapiRef.current = vapi as unknown as typeof vapiRef.current;
    });
    return () => {
      mounted = false;
      vapiRef.current?.stop();
    };
  }, []);

  const configured = PUBLIC_KEY && ASSISTANT_ID;

  return (
    <div>
      <h1>Talk to Finnor</h1>
      <p style={{ color: "#9fb0cc" }}>
        Live voice through your microphone — no phone line involved. Ask for anything Finnor
        can do; it reads drafts back and takes your spoken yes/no.
      </p>
      {!configured && (
        <p style={{ color: "#ffd479" }}>
          Set NEXT_PUBLIC_VAPI_PUBLIC_KEY and NEXT_PUBLIC_VAPI_ASSISTANT_ID in .env, and point the
          assistant&apos;s server URL at your deployed /api/webhooks/vapi.
        </p>
      )}
      <button
        disabled={!configured || status === "connecting"}
        onClick={() => {
          if (status === "live") {
            vapiRef.current?.stop();
          } else {
            setStatus("connecting");
            setErrorMsg(null);
            vapiRef.current?.start(ASSISTANT_ID);
          }
        }}
        style={{
          background: status === "live" ? "#7a1d2b" : "#1d7a46",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "14px 34px",
          fontSize: 16,
          fontWeight: 700,
          cursor: configured ? "pointer" : "not-allowed",
        }}
      >
        {status === "live" ? "■ End conversation" : status === "connecting" ? "Connecting…" : "🎙 Start talking"}
      </button>
      {errorMsg && <p style={{ color: "#ff9d9d" }}>{errorMsg}</p>}
      <div style={{ marginTop: 20 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ padding: "4px 0", color: l.startsWith("FINNOR") ? "#8fb4ff" : "#e7ecf5" }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
