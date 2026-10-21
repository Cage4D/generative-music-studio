import type { DrumEvent, NoteEvent } from "./types";

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

// The drum event list gets its own hash, so the arpeggio, melody and bassline
// hashes stay exactly as they were. The lane is part of the token, because
// two hits on the same step with the same velocity are different hits when
// they are on different lanes.
export function hashDrumEvents(events: DrumEvent[]): string {
  let hash = 0x811c9dc5;
  for (const event of events) {
    const token = `${event.step}:${event.lane}:${event.velocity.toFixed(4)}:${event.choke}`;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
