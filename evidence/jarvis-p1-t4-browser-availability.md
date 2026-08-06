# P1.T4 browser evidence availability

Date: 2026-08-02
Route: `http://localhost:3000/jarvis`

## Read-only checks

- Local `/jarvis` returned `HTTP 200`.
- The mandated in-app browser was retried from a clean Node session and failed during bootstrap with `TypeError: Cannot redefine property: process`.
- Google Chrome is running (`pid 20656`; helper processes present).
- Installed browser: Google Chrome `150.0.7871.187` at `/Applications/Google Chrome.app`.
- The Chrome integration selected `Profile 2`, where the Codex extension is not installed or enabled.
- `Profile 5` has the extension installed, registered, and enabled (`1.2.27236.6274_0`), but it is not the selected profile and no Chrome browser handle became available to the control tool.
- The native messaging manifest is present and correct at `/Users/paramdave/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json`.

## Evidence boundary

No P1.T4 rendered screenshot, DOM snapshot, or console capture was recorded because neither the mandated in-app browser nor the permitted Chrome fallback exposed a controllable browser session. The Setup Rail task remains open until its rendered collapsed-height and responsive visual evidence can be captured.
