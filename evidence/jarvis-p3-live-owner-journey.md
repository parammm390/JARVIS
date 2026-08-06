# P3 live owner journey evidence — 2026-08-03

## Scope and provenance

This is a bounded live-owner recording against the canonical current-worktree
deployment at `https://finnorai.com/jarvis`. The Chrome surface had no
`PUBLIC PREVIEW` text and no `Sign in` link. No setup control, approval control,
microphone permission, or external workflow control was used.

The command submissions below did create real instruction activity in the
owner tenant. The record preserves the exact visible outcomes; it does not
reinterpret the UI's `sent` label as proof of an external side effect.

The initial owner snapshot showed `10 approvals waiting`. After the later
clarification refresh, the empty Ready surface showed `9 approvals waiting`.
This count change is recorded as observed UI state only; no causal attribution
is made.

## Live terminal journey

Submitted exactly:

```text
Chase everyone more than thirty days overdue
```

After a bounded 1.2-second observation, the canonical DOM showed:

```text
primary status: Done
Thread blocks: Heard → Understood → Plan (1 action) → Execution (Execution recorded) → Receipt (Complete)
Receipt copy: 1 of 1 action sent.
Receipt action row: Answer business question · sent · No receipt yet
```

The page exposed a real proposed-action/approval section inside the receipt,
but no approval control was clicked. The intermediate state edges were not
captured as separate timestamped observations, so this is live terminal and
causal-order evidence, not a complete live lifecycle recording.

The bounded terminal geometry sample was:

```text
viewport: 1470×835
document: scrollWidth=1470, scrollHeight=3535
LIVEFRAME: resolved
primary status: Done
active block: Receipt (expanded)
```

Capture: [`jarvis-p3-live-journey-1470x835.jpg`](/Users/paramdave/FINNOR/evidence/jarvis-p3-live-journey-1470x835.jpg).

Refreshing this terminal page returned the canonical Ready/setup surface with
no Thread blocks. This is consistent with the source's intentional terminal
pointer clearing, so it is not counted as a terminal-restore failure or as
mid-flight restore proof.

## Live clarification and refresh attempt

Submitted exactly:

```text
Book a water test for the Hendersons this week and give it to whoever's closest
```

After a bounded 1.6-second observation, the canonical DOM showed:

```text
primary status: Needs one detail
Thread blocks: Heard → Understood → Clarify (expanded)
question: Which Hendersons household would you like to book a water test for?
fields: householdId, address, contactPhone
```

The initial snapshot marked the `householdId` control active. A subsequent
snapshot after capture reported document focus on `BODY`, so focus retention
was not treated as proven by this live run. The bounded geometry sample was:

```text
viewport: 1470×835
document: scrollWidth=1470, scrollHeight=1113
LIVEFRAME: decision
```

Capture: [`jarvis-p3-live-clarification-1470x835.jpg`](/Users/paramdave/FINNOR/evidence/jarvis-p3-live-clarification-1470x835.jpg).

The page was then refreshed while the clarification was visible. After a
2.2-second bounded restore window, the canonical DOM showed:

```text
primary status: Needs attention
setup copy: Connection status is unavailable.
Thread blocks: none
```

This does not prove the required live mid-flight refresh/restore behavior. The
source restore path needs the authenticated instruction and event endpoints;
the production migration/route availability remains unverified under blocker
B4-01. No fallback thread or business fact was fabricated from the client
pointer.

## Browser warnings and measurement boundary

The live tab reported no console errors. It reported the existing repeated
warning:

```text
THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
```

This run did not produce a trustworthy live SSE/poll event→pixel measurement or
CLS trace. The browser evaluation surface did not expose the required
performance-entry API, so those fields remain open rather than inferred from
the fixture timings.

## Gate consequence

This recording strengthens live authenticated causal-order and clarification
evidence, but it does not close the complete lifecycle, live CLS, live
event→pixel, or authoritative score gates. It also reopens the canonical
mid-flight refresh/restore gate: the fixture/source proof remains valid as
component support, while the live clarification refresh returned to the empty
surface. P3 is not complete and no score movement is claimed.
