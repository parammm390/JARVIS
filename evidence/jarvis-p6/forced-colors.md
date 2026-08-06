# P6.T2 — forced-colours and reduced-motion runtime evidence

Date: 2026-08-04

This is a **source-labelled local fixture** result. It is evidence about the
shared JARVIS Thread component tree, not authenticated tenant data, live
workflow state, or an external action.

## Implementation

- [`src/components/jarvis/jarvis-theme.css`](/Users/paramdave/FINNOR/src/components/jarvis/jarvis-theme.css:1195) adds an `@media (forced-colors: active)` layer.
- The layer maps the JARVIS tokens to system colours (`Canvas`, `CanvasText`,
  `ButtonFace`, `ButtonText`, and `Highlight`), removes decorative grid/field
  layers, suppresses glow/text shadow, preserves panel/dialog borders, and
  gives focused controls a solid 3px system-colour outline.
- The reduced-motion behavior remains source-backed by the existing choreography
  variants and CSS `prefers-reduced-motion` rules.

## Runtime command and result

Command:

```text
npx playwright test e2e/jarvis-p6-forced-colors.spec.ts --project=desktop-chromium
```

Result: **1 passed (26.6s)**.

The test used Chromium at 1440×900 with `forcedColors: "active"` and
`reducedMotion: "reduce"`, then exercised the real labelled fixture tree for
`rest`, `heard`, `plan`, `clarify`, `flagship-c-approval-known`, `execution`,
`verifying`, and `receipt`. For each fixture it observed the visible `FIXTURE`
label, a plan-defined LIVEFRAME mode, `matchMedia("(forced-colors: active)")`,
and no horizontal overflow. The approval fixture additionally exposed one
approval dialog, a focused `Select` control with a solid outline at least 3px,
and panels with `box-shadow: none` under forced colours.

Screenshot: [`forced-colors-approval-1440.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P6/forced-colors-approval-1440.png)

## Warnings and boundary

The command completed with the existing non-fatal Sentry ESM warning from the
Next dev server. No new assertion failure occurred. This run does not close
the P6 blind state-recognition review, the full eight critical paths, or the
production voice/device/console sweep; those remain separate open gates.
