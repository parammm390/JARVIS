# Multi-agent collaboration — what this is and isn't

This is an honest scope note, not marketing copy. "Multi-agent collaboration" can mean
anything from "more than one LLM call happens somewhere" to autonomous agents that
negotiate and delegate tasks among themselves. Finnor is the former, not the latter.
Three real things exist under this name:

## 1. A verification layer (the critic)

`packages/orchestration/src/critic.ts` + `apps/worker/src/handlers/critic-review.ts`.

When the planner drafts an action that requires human confirmation, a second,
independently-prompted model call reviews that draft against the original instruction
— while the action is already sitting in the confirmation queue waiting for a human.
It looks for clear misinterpretation (wrong action, wrong amount, a fabricated detail
the instruction never stated) and, if it finds one, escalates the action's status to
`needs_human_review` so the console and pending-actions API surface it distinctly. It
never blocks, never executes anything, and never overrides a human decision — it can
only add a flag for the human to see before they approve.

This runs **after** the gate, not before, on purpose. A synchronous pre-draft critic
call would add a full LLM round trip to every voice instruction, working directly
against this project's voice-latency work. A gated action already pauses for a human
regardless of what the critic does, so reviewing it during that wait costs zero added
latency to the caller.

It degrades gracefully: with no Bedrock key configured, the job no-ops immediately
(logged, not thrown) rather than failing or dead-lettering. Plug-and-play, same as
every other integration in this codebase — nothing to do until a real key lands.

This is a **verification pass**, not a second opinion from a different reasoning
agent with its own goals. It has no memory of its own, no ability to act, and no
say beyond a single flag.

## 2. Specialized voice personas

`packages/tools/src/voice-personas.ts`.

Different call purposes (a payment reminder, a win-back offer, a service reminder, an
install follow-up, general instructions) are placed through different Vapi assistant
IDs — different voices, different scripts, different framing for the situation. This
is "specialized," in the sense that each persona is tuned to one job, but every
persona is still a single independent voice call. They don't talk to each other,
they don't hand off mid-conversation, and none of them has any autonomy the main
orchestration pipeline didn't already grant it.

## 3. Existing parallel multi-action execution

`packages/orchestration/src/index.ts`, `handleInstruction()`.

When a single instruction resolves to multiple actions ("create an invoice for the
Petersons and schedule a water test for the Chens"), each action runs through its own
gated pipeline concurrently (`Promise.all`). This is real concurrency, not sequential
processing — but it's fan-out of independent, already-fully-specified work, not
agents coordinating or negotiating with each other.

## What this isn't

No agent here plans multi-step strategies, delegates sub-tasks to another agent,
negotiates over a shared goal, or maintains its own persistent state across turns
independent of the orchestration pipeline. There is no agent-to-agent protocol. If a
future version adds real delegation (e.g. a planner agent that hands off ambiguous
cases to a specialist agent which does its own multi-turn reasoning before handing
back), that would be a materially different, larger project than what's described
here — worth naming honestly as a new capability, not folded into this one.
