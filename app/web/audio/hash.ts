import type { NoteEvent } from "./types";

// FNV-1a over the event list. Moved verbatim out of engine.ts so tests can pin
// the arpeggio event-list hash without importing Tone. The algorithm is
// unchanged, so existing arpeggio hashes are identical.
export function hashEvents(events: (NoteEvent | null)[]): string {
  let hash = 0x811c9dc5;
  for (const event of events) {
    const token = event
      ? `${event.step}:${event.midi}:${event.velocity.toFixed(4)}:${event.gate.toFixed(4)}`
      : "-";
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
