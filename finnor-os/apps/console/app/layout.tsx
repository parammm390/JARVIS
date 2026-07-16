import type { ReactNode } from "react";
import "./globals.css";
import Nav from "../components/Nav";
import CommandPalette from "../components/CommandPalette";

export const metadata = { title: "Finnor Console" };

// Inline, blocking script so the stored theme applies before first paint — avoids a
// dark→light (or vice versa) flash on load.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("finnor_theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Nav />
        <CommandPalette />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
