# P1 rest dead-zone — pre-edit decision

Date: 2026-08-02  
Route: local canonical `/jarvis` public-preview rest branch  
Source checked: `src/components/jarvis/bridge/ThreadBridge.tsx:404-424` (`RestPrompt`), `src/components/jarvis/bridge/ThreadBridge.tsx:541-568` (`ThreadBody`), and `src/components/jarvis/jarvis-theme.css:293-359`.

## Measurement before edit

| CSS viewport | Setup → Presence | Presence Core → invitation | Invitation → fixed Sign in | Document overflow |
|---|---:|---:|---:|---|
| 1440×1000 | 24 px | 202.1015625 px | 399.1015625 px | none |
| 768×1024 | 32 px | 206.65625 px | 410.546875 px | none |
| 390×844 | 32 px | 92.4609375 px | 286.75 px | no horizontal overflow; 877 px document height |

The measured Presence Core → invitation gap exceeds the Plan P1 limit of 96 px at desktop and tablet. The direct source cause is the `RestPrompt` wrapper's Tailwind `min-h-[38vh]` combined with `justify-center`; the prompt is vertically centred inside a 38vh action-spine box. The gap is not caused by the Setup Rail, Presence Core sizing, grid floor, or kernel state.

## Decision

Apply one presentation-only edit: change `RestPrompt`'s minimum height from `min-h-[38vh]` to `min-h-0`. Keep its flex alignment, mobile bottom safe-area/command clearance, copy, data-derived facts, retry action, and all kernel/business behavior unchanged. This brings the invitation directly after the existing 24 px rest-composition gap without inventing a new state or moving `/demo`.

This decision closes only the measured dead-zone defect. Ambient-loop and P1 score gates remain open until separately inventoried and evidenced.
