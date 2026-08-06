# Authenticated `/jarvis` production evidence

Date: 2026-08-02  
Route: `https://finnorai.com/jarvis`  
Scope: read-only capture from the user-provided signed-in Chrome session. No Connect link, mic, input, or external action was activated.

## Captured artifacts

- [`authenticated-1440x1000.png`](/Users/paramdave/FINNOR/evidence/jarvis-p1-authenticated-production/authenticated-1440x1000.png)
- [`authenticated-768x1024.png`](/Users/paramdave/FINNOR/evidence/jarvis-p1-authenticated-production/authenticated-768x1024.png)
- [`authenticated-390x844.png`](/Users/paramdave/FINNOR/evidence/jarvis-p1-authenticated-production/authenticated-390x844.png)
- Matching `-dom.txt`, `-metrics.json`, and `-console.json` files in this directory.

## Observed owner-session facts

The rendered DOM did not expose `PUBLIC PREVIEW`. It exposed the owner/setup branch with these exact visible facts:

- `First-run setup`
- `Next action: configure schedule water test`
- `water-test reports this action as gated_by_choice. A policy row is present. It requires confirmation.`
- `Not connected — add credentials to activate: meta ads, google ads, quickbooks, ghl, stripe, docusign.`
- `Tell JARVIS what you need.`
- `0 invoices overdue · $0 · 10 approvals waiting`
- `Connect` → `/resources/pilot-setup-checklist`
- `blocked`, `polling`, and `Low power off` in the header/command surfaces

All three captured viewports had no horizontal or vertical document overflow (`scrollWidth`/`scrollHeight` matched the viewport). The setup section measured 348.5390625 px high at 1440/768 and 363.9375 px at 390; the invitation was at y=586.265625, y=590.8203125, and y=544.0234375 respectively. Each page had two canvases: one full-viewport `jarvis-ambient` canvas and a 44 px header Orb canvas. The page DOM had zero `<img>` elements, zero `[data-primary-status]`, zero `role="status"`, zero `[data-jarvis-diagnostics]`, one `[data-jarvis-thread]`, and zero `/demo` links. The robot visible in the supplied full-window screenshot is not an image in the captured page DOM and is not counted as repository chrome.

The captured console files report zero errors. The Chrome page evaluation returned no usable `document.getAnimations()` inventory for this production page scope, so no production animation count is claimed.

## Verdict and boundary

This capture closes the availability question: an authenticated production owner branch can be inspected through the user’s signed-in Chrome session. It does not certify the current dirty worktree’s revised P1 shell, because production is serving the older shell: the observed `blocked`/`polling`/power pills, large setup section, 44 px header Orb, and absent primary-status/Diagnostics contracts do not match the current local `ThreadBridge`/Setup Rail implementation.

No deployment was attempted; the state ledger still records no deployment authorization. A production deployment or an authenticated local/staging surface would be required to visually certify the revised implementation itself. The P1 score gate remains separate and must still use an explicit reviewer/category score artifact or an authoritative Plan scoring rule.
