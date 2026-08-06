/**
 * Voice utterances that are conversation rather than work instructions.
 *
 * This intentionally only matches a small set of standalone phrases. A
 * greeting inside a real request (for example, "Hello, show overdue invoices")
 * must still reach the planner.
 */
const REPLIES: Readonly<Record<string, string>> = {
  hello: "Hello. What would you like me to handle?",
  "hello jarvis": "Hello. What would you like me to handle?",
  hi: "Hello. What would you like me to handle?",
  "hi jarvis": "Hello. What would you like me to handle?",
  hey: "Hey. What would you like me to handle?",
  "hey jarvis": "Hey. What would you like me to handle?",
  howdy: "Hello. What would you like me to handle?",
  yo: "Hey. What would you like me to handle?",
  "good morning": "Good morning. What would you like me to handle?",
  "good afternoon": "Good afternoon. What would you like me to handle?",
  "good evening": "Good evening. What would you like me to handle?",
  "are you there": "I’m here and ready. What would you like me to handle?",
  "are you there, jarvis": "I’m here and ready. What would you like me to handle?",
  "are you there jarvis": "I’m here and ready. What would you like me to handle?",
  "are you listening": "I’m listening. What would you like me to handle?",
  "can you hear me": "I can hear you. What would you like me to handle?",
  "can you speak": "Yes. I can speak. What would you like me to handle?",
  "can you talk": "Yes. I can talk. What would you like me to handle?",
  "do you speak": "Yes. I can speak. What would you like me to handle?",
  "don't you speak": "Yes. I can speak. What would you like me to handle?",
  "dont you speak": "Yes. I can speak. What would you like me to handle?",
  "don't you don't you speak": "Yes. I can speak. What would you like me to handle?",
  "dont you dont you speak": "Yes. I can speak. What would you like me to handle?",
}

function normalizeStandaloneUtterance(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
}

/** Returns a spoken reply only for a standalone conversational utterance. */
export function getConversationalVoiceReply(value: string): string | null {
  if (!value.trim()) return null
  return REPLIES[normalizeStandaloneUtterance(value)] ?? null
}
