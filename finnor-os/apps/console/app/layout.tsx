import type { ReactNode } from "react";

export const metadata = { title: "Finnor Console" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0b1220; color: #e7ecf5; }
          a { transition: color .15s ease, opacity .15s ease; }
          a:hover { opacity: .85; }
          button { transition: transform .12s ease, background .15s ease, opacity .15s ease, box-shadow .15s ease; }
          button:not(:disabled):hover { transform: translateY(-1px); }
          button:not(:disabled):active { transform: translateY(0) scale(.98); }
          input, textarea { transition: border-color .15s ease; }
          input:focus, textarea:focus { outline: none; border-color: #4a72c4 !important; }
          .card { border: 1px solid #1e2a44; border-radius: 12px; padding: 18px; margin-bottom: 14px;
                  background: #101a30; transition: opacity .35s ease, transform .35s ease, border-color .2s ease;
                  animation: cardIn .3s ease; }
          .card:hover { border-color: #2b3d63; }
          .card.leaving { opacity: 0; transform: translateX(24px); }
          @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
          @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
          .pulse { animation: pulse 1.6s ease-in-out infinite; }
          .toast { position: fixed; bottom: 24px; right: 24px; background: #14243f; border: 1px solid #2b3d63;
                   border-radius: 10px; padding: 12px 20px; box-shadow: 0 8px 30px rgba(0,0,0,.45);
                   animation: cardIn .25s ease; z-index: 50; }
        `}</style>
      </head>
      <body>
        <nav style={{ display: "flex", gap: 22, padding: "14px 24px", borderBottom: "1px solid #1e2a44", alignItems: "center", position: "sticky", top: 0, background: "rgba(11,18,32,.92)", backdropFilter: "blur(8px)", zIndex: 40 }}>
          <a href="/" style={{ color: "#e7ecf5", textDecoration: "none", fontWeight: 800, letterSpacing: 1 }}>FINNOR</a>
          <a href="/confirm" style={{ color: "#8fb4ff", textDecoration: "none" }}>Confirmation Queue</a>
          <a href="/audit" style={{ color: "#8fb4ff", textDecoration: "none" }}>Audit Log</a>
          <a href="/policy" style={{ color: "#8fb4ff", textDecoration: "none" }}>Policies</a>
          <a href="/comms" style={{ color: "#8fb4ff", textDecoration: "none" }}>Communications</a>
          <a href="/talk" style={{ color: "#9dffb0", textDecoration: "none", fontWeight: 700 }}>🎙 Talk to Finnor</a>
        </nav>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
