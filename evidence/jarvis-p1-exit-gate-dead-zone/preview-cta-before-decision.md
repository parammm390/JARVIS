# Public-preview CTA — pre-edit decision

Date: 2026-08-02  
Scope: canonical `/jarvis` public-preview branch only.

After removing the rest prompt's 38vh minimum, the measured invitation → fixed `Sign in` gap remained:

| CSS viewport | Invitation → fixed `Sign in` |
|---|---:|
| 1440×1000 | 577.203125 px |
| 768×1024 | 593.203125 px |
| 390×844 | 368.109375 px |

Source confirms that `PreviewThread` calls `ThreadBody` with `showRail={false}` and then renders `Sign in` as a separate fixed bottom control. The preview branch therefore has no Command Dock whose reserved space would explain this gap. The authenticated owner branch continues to use `showRail` and its existing command-rail clearance.

## Decision

Move only the preview fallback CTA into the `ThreadBody` preview composition, where it follows the invitation, and apply preview-only canvas bottom padding of 32 px plus safe-area inset instead of the owner Command Dock reservation. Remove the separate fixed preview anchor. Preserve the same `/jarvis/login` destination, copy, minimum touch height, owner `CommandRail`, setup rail, kernel truth, and `/demo` scope.

The first recapture showed the desktop/tablet invitation → CTA gap at 56 px, but mobile remained 216 px because `RestPrompt` still carried its mobile-only `pb-[calc(10rem+safe-area)]`. That padding is required only when the owner `CommandRail` is mounted. The follow-up edit therefore scopes `padding-bottom: 0` to `.jarvis-canvas--preview .jarvis-rest-prompt`; the owner path remains unchanged.
