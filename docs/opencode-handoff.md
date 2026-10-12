# Handoff: build the Generative Music Studio frontend (Studio screen)

This file is the brief for a coding agent (opencode). It covers the **Studio screen only**. The Track page and the Gallery are not designed yet and are out of scope.

## 0. How to use this (for John)

1. Put these files in the repo:
   - `docs/design/gms-studio-prototype.html` (the approved visual prototype; rename of `gms-studio-pass1.html`)
   - `docs/design/arpeggio-test.html` (working Tone.js + seeded PRNG reference for the arpeggio)
   - `docs/design/opencode-handoff.md` (this file)
2. Open the prototype in a browser. It is the **visual source of truth**. The agent can't "see" it, so tell it to read the HTML/CSS/JS directly.
3. Start opencode at the repo root and paste the prompt in section 11.
4. Work one milestone at a time (section 9). After each one, ask it to explain the diff, run it, and check the acceptance list before moving on.

## 1. Project context

Generative Music Studio is a deterministic procedural music tool. A user picks a generator, tweaks settings and a seed, hears the music in the browser, and saves it as a link. **Only settings are stored, never audio.** Same settings + same seed = same notes and timing, anywhere.

- Monorepo (pnpm): `apps/api` (NestJS + Prisma, already exists), `apps/web` (this task), `packages/shared` (`@gms/shared`, Zod schemas, already exists).
- Generation happens **entirely in the browser**. The backend never makes sound.
- No accounts. `isPublic` is **not** exposed in the UI.

## 2. Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS, in `apps/web`.
- Fonts via `next/font/google`: **Manrope** (all text) and **JetBrains Mono** (labels, numbers).
- `tone` (Tone.js) for sound and scheduling only.
- `@gms/shared` for validation and types. Use `PatternSchema`, `CreatePatternSchema`, and the exported constants (`NOTE_NAMES`, `SCALES`, `WAVEFORMS`, `NOTE_LENGTHS`, `GENERATOR_IDS`, `SEED_MAX`).
- shadcn/ui is optional. If used, restyle it fully to the tokens below. Do not let default shadcn styling change the look. The prototype uses plain custom controls, which is fine.
- **Hard rules:** no `<canvas>`, no WebGL, no Three.js. All visuals are DOM, CSS and SVG. No extra state or animation libraries unless clearly needed (plain `useReducer` + context is enough).

Suggested structure:

```
apps/web/src/
  app/
    layout.tsx, page.tsx (Studio), globals.css
  components/studio/
    Header, Background, GeneratorTabs, Hero, PatternPreview,
    Transport, ParamsPanel, SaveCard, Footer
  lib/
    prng.ts            (mulberry32)
    api.ts             (fetch wrapper + typed errors)
    studio-state.ts    (reducer, defaults, meta per generator)
  audio/
    engine.ts          (Tone setup, play/stop, dispose, effects chain)
    generators/        (arpeggio.ts, melody.ts, bassline.ts, drums.ts, pad.ts, texture.ts)
```

## 3. Design tokens (exact; copy these)

| Token | Value |
|---|---|
| bg | `#07080a` |
| panel | `rgba(10,11,14,.84)` (solid, **no blur, no shadow**) |
| line | `rgba(255,255,255,.09)` |
| fg | `#e6ebf5` |
| muted | `#7f8797` |
| accent | `#7f9cf5` |
| accent-light | `#c3d0f5` |
| wave stroke | `#a9bbe8` |

- **Radii:** cards 12px; inputs, selects, buttons 6px; primary button 8px; tab group 9px, tabs 6px; chips and nav links 6px; "Preview" tag 4px; play button is a circle.
- **Layout:** container max-width 1180px, side padding 24px (16px under 860px). Two columns `minmax(0,1.5fr) minmax(300px,1fr)`, gap 28px, collapsing to one column under 860px. Top padding of main 36px (24px on mobile).
- **Type:**
  - Body Manrope 14px / 1.5.
  - H1 Manrope weight 300, `clamp(34px, 5.6vw, 54px)`, line-height 1.1, letter-spacing `-0.03em`, plain `fg` (**no gradient text**).
  - Logo: 13px, weight 500, letter-spacing `.2em`, uppercase. The word "Music" is `accent-light`, not italic.
  - Small labels (eyebrow, section titles, chips, values, "Pattern preview", footer): JetBrains Mono, 10.5 to 11.5px, uppercase where noted, letter-spacing `.14em` to `.18em`.
- **Never use:** gradients on UI surfaces, glows, drop shadows, backdrop blur on cards, gradient text, reds, pinks, yellows or greens. Blue appears only in data (active cells, playhead, pad blocks, texture bars), thin accents, and the waveform. (The only blur allowed is the sticky header.)

## 4. Background and atmosphere (fixed layer behind everything)

1. Flat `bg` color.
2. Two 1px vertical hairline rails (`line` color) at `calc(50% - 590px)` and `calc(50% + 590px)`, full height.
3. A 1px horizontal light line at the very top: `linear-gradient(90deg, transparent, rgba(200,215,255,.4), transparent)`.
4. Film grain over the whole page: `position:fixed; inset:0; pointer-events:none; opacity:.05; mix-blend-mode:overlay;` background is an inline SVG `feTurbulence` (baseFrequency .8, 2 octaves, stitchTiles, then `feColorMatrix saturate 0`).
5. **Animated line ribbon** at the bottom, height `52vh`, with a vertical mask fade (`linear-gradient(transparent, #000 45%, #000 70%, transparent)`):
   - Two stacked SVGs, each `width:200%`, `viewBox="0 0 2880 400"`, `preserveAspectRatio="none"`, paths with `vector-effect: non-scaling-stroke`.
   - Layer 1: 16 paths; layer 2: 10 paths. Each path is a periodic wave so translating by -50% loops seamlessly.
   - Idle: layer 1 drifts left in 46s linear, layer 2 drifts right in 70s linear. **Playing:** 16s and 26s, and the whole ribbon scales vertically 1.6x with a 1.2s transition (origin bottom).
   - Generator (port exactly from the prototype, search for `function wave` and `const rib`):

```js
function wave(a, c, ph) {            // a = amplitude, c = integer cycles, ph = phase
  let d = "M0 200";
  for (let x = 0; x <= 2880; x += 20)
    d += ` L${x} ${(200 + a * Math.sin(x/1440*c*2*Math.PI + ph) * Math.sin(x/1440*2*Math.PI + ph)).toFixed(1)}`;
  return d;
}
// rib(n, a, c, ph, opacity): n paths, each with amplitude a*(.5+i/n), phase ph+i*.16,
// stroke-opacity opacity*(.35+.65*i/n), stroke-width 1
// layer 1: rib(16, 60, 3, 0, .5)   layer 2: rib(10, 42, 2, 2, .28)
```

6. Respect `prefers-reduced-motion`: disable all animation and transitions.

## 5. Screen anatomy and behavior

**Header** (sticky, `top: env(safe-area-inset-top)`, bg `rgba(7,8,10,.85)`, `backdrop-filter: blur(14px)`, bottom border `line`):
- Left: 5-bar waveform mark (SVG, 22px, stroke `#8fb0ff`, round caps; paths `M4 10v4`, `M8 6v12`, `M12 3v18`, `M16 7v10`, `M20 10v4`) + wordmark "Generative **Music** Studio". While playing, the mark's bars animate (scaleY to .35, alternate, ~.8s, staggered delays).
- Right: nav "Studio" (active, subtle white-7% background) and "Gallery" (links to `/gallery`), then a "PREVIEW" mono tag (hidden under 860px).

**Generator tabs:** a single bordered segmented control (radius 9, padding 4), 6 tabs in this order with these labels: Arpeggio, Ambient pad, Drum pattern, Bassline, Texture, Melody. Active tab: white-7% background, `fg` text. Scrolls horizontally on mobile. Switching generator keeps shared params (tempo, root, scale, density, swing, effects, seed) and uses that generator's own block, kept per generator in state so switching back restores it.

**Hero:**
- Eyebrow (mono, uppercase, accent-light) with a 28px accent line before it: `Generator 01 / 06` (index of the active generator).
- H1: the generator's display name.
- Lede (15px, muted, max 46ch), one line per generator:
  - arpeggio: "Broken chords that step through the scale, one note at a time."
  - ambient-pad: "Slow, wide chords that swell and dissolve into the background."
  - drum-pattern: "Kick, snare and hats laid out on a step grid."
  - bassline: "A low, steady voice that anchors the harmony."
  - texture: "Filtered noise that drifts and shimmers underneath."
  - melody: "A single line that rises, falls and breathes."
- Chips (bordered, mono, no fill): `{root} {scale}`, `{tempo} bpm`, `seed {seed}`.

**Pattern preview card** (height 300px, header bar + body):
- Header bar: left "Pattern preview" (mono uppercase, muted); right a small dot plus "Idle" / "Playing" (dot becomes accent when playing).
- Body, by generator:
  - arpeggio (6 rows), melody (8 rows), bassline (4 rows): step grid, 16 columns.
  - drum-pattern: 4 rows (kick, snare, hat, perc), columns = `steps` (8, 16 or 32).
  - ambient-pad: 8-bar timeline of chord blocks; each block's flex-grow = `chordLengthBars`, containing `chordSize` thin accent bars.
  - texture: 44 vertical bars; heights follow the movement depth; they animate (scaleY alternate) while playing with duration `clamp(2 / movementRate, .6, 6)` seconds and staggered negative delays.
- Grid cells: radius 5, idle `rgba(160,185,235,.07)`, every 4th column slightly brighter (`.13`), active = flat `accent`, no glow.
- Playhead: 2px wide `accent-light` line sweeping left to right, linear, infinite, only visible while playing. Sweep duration: grids `columns * 15 / tempo` seconds; pad `1920 / tempo` seconds; none for texture.
- **Difference from the prototype:** the prototype draws a fake pattern from the seed. In the real app, the cells **must come from the actual generated events** of the active generator (section 7), so the picture matches the sound. Map each event's pitch (or drum voice) to a row and its step to a column.

**Transport card:** circular play button (52px, 1px `fg` border, transparent; while playing it fills `fg` with dark glyph; swaps play and pause glyph, `aria-pressed`, `aria-label`). On the right: label "Seed", number input (0 to 4294967295, integer, clamped), "Shuffle" (random uint32 via `crypto.getRandomValues`), "Copy" (clipboard, wrapped in try/catch).

**Params panel** (right column, card with collapsible sections; mono uppercase headers with an index and a +/- toggle):
1. `01 Sound` (open): tempo (int 40 to 220), root (select, `NOTE_NAMES`), scale (select, `SCALES`), density (0 to 1, step .05), swing (0 to 1, step .05).
2. `02 {Generator name}` (open): that generator's block. **Copy the field list, labels, ranges, steps and defaults from the `G` object in the prototype script** and verify each against `PatternSchema`.
3. `03 Effects` (collapsed by default): 8 sliders (reverb, delay, chorus, phaser, distortion, filter, vibrato, tremolo), 0 to 1 step .05. **A value of 0 removes the key** from `effects` (missing = off).
- Slider: 2px track with an accent fill to the thumb, 12px white round thumb (no glow). Value readout on the right in mono. Selects use a custom chevron, 6px radius.
- Numeric select options (the `steps` field: 8, 16, 32) must be sent as numbers, not strings.

**Save card:** title input ("Title (optional)", placeholder "Untitled pattern", `maxLength` 60, live counter `n/60`, trimmed on send, omit when empty); a "Remixed from {slug}" pill when remixing; primary button (flat `fg` background, dark text) "Save & get link" ("Save remix" when remixing); status area below; a collapsible "Request preview" showing the exact JSON body being sent (keep this, it shows the contract).

**Footer:** hairline top border, mono 11px muted: left "Same settings, same seed, same music." Right: "Preview build" (change to a version label when you like).

**Entrance motion:** left column and cards fade up (opacity 0 and translateY 12px to rest) over .8s `cubic-bezier(.2,.7,.2,1)`, staggered .08s / .16s / .24s by order.

**Remove** the prototype's "Visual preview only..." note.

## 6. State and validation

- One reducer holds: `generatorId`, shared params, a per-generator block map, `title`, `parentSlug`, plus UI state (`playing`, save status).
- Derive the request body `{ title?, parentSlug?, pattern: { generatorId, params } }` where `params = { seed, tempo, root, scale, density, swing, effects, [blockName]: block }`. Block names: arpeggio to `arpeggio`, ambient-pad to `pad`, drum-pattern to `drums`, bassline to `bass`, texture to `texture`, melody to `melody`.
- Validate live with `CreatePatternSchema.safeParse`. Disable Save when invalid and show the first issue's `path` and `message` under the button.
- Add a test asserting that **every generator's default state parses** with `PatternSchema`.

## 7. Audio engine (Tone.js) rules

The one rule that keeps the project honest: **the seeded PRNG decides everything; Tone only plays what it is given.**

1. Each generator is a **pure function** `generate(params) => events[]` in `audio/generators/`, using `mulberry32(params.seed)`. Same params must always produce deep-equal events (add a unit test hashing the JSON output). `arpeggio-test.html` shows this for the arpeggio, including the trick of drawing a fixed number of random values per step so changing density does not reshuffle which notes are chosen. Follow that pattern.
2. **Do not use** Tone's randomness: `Tone.Pattern` random mode, `probability`, `humanize`. Rests, velocities, random patterns and crackle all come from your PRNG.
3. **Swing:** do not use `Transport.swing` (it depends on subdivision). Set it to 0 and apply swing yourself: on odd steps, delay the scheduled time by `swing * stepSeconds / 3`, where `stepSeconds = Tone.Time(stepLength).toSeconds()`.
4. Browsers block audio until a click: call `await Tone.start()` inside the Play handler. The reverb needs `await reverb.ready` before use.
5. Dispose cleanly: on Stop, generator change, and unmount, stop and dispose sequences and synths, and clear the Transport, so nothing leaks or double-plays.
6. Tempo, swing and effect levels must update **live** while playing. Changing the seed, pattern, scale and so on regenerates events and swaps the sequence without restarting audio (a short jump is acceptable).
7. Effects: one small mapping function per effect, turning the 0 to 1 level into that effect's real parameters (for example `wet`, `depth`). `filter` as an effect is the vaguest; treat it as a low-pass whose cutoff falls as the level rises, and flag it.
8. **Drums are synthesized** (`MembraneSynth` kick, `NoiseSynth` snare, `MetalSynth` hats). There are no samples, so the schema's `acoustic` kit has no real implementation. Either map it to a variant of the synthesized kit or **raise it with John** so the schema can change. Do not silently ignore it.
9. Texture `crackle` = short, quiet noise bursts at times chosen by the PRNG.
10. "Same music" means same **notes and timing**, not bit-identical audio (noise grain and reverb differ slightly). Do not claim more in the UI or README.
11. Pitched generators use `root` and `scale`. Drums and texture ignore them (they stay in the shared params).

Build order for generators: arpeggio, melody, bassline, drum-pattern, ambient-pad, texture.

## 8. API integration

Base URL from `NEXT_PUBLIC_API_URL`. The API needs CORS for the web origin (`CORS_ORIGINS` in `apps/api`).

| Call | Request | Success response |
|---|---|---|
| `POST /patterns` | `{ title?, parentSlug?, pattern }` | `{ slug, title, pattern:{generatorId,params}, playCount, remixCount, parentSlug, createdAt }` |
| `GET /patterns/:slug` | n/a | same shape as above |
| `GET /patterns?sort=recent\|popular&limit=&cursor=` | query | `{ items: [...], nextCursor: string \| null }` |

Errors are always `{ statusCode, error, message, issues? }` where `issues` is `[{ path, message }]` and `path` is dotted (for example `pattern.params.arpeggio.octaves`).

- **Save flow:** on click, set status to "Waking the server…" if the request takes over about 1.5s (the free-tier API cold-starts). Retry network failures a couple of times with backoff. On success show the link `${origin}/track/${slug}` with a "Copy link" button. The Track page is not built yet, so that link can 404 for now.
- **Error states** (design in the same flat style, **no red**; use `fg` text with a bordered notice): 400 with `issues` (list the first few, mapped to the field they name), 404 for a missing `parentSlug`, 429 "Slow down, try again in a moment", network failure with a Retry button.
- **Remix entry:** support `/?remix={slug}`: fetch that pattern, load its generator and params into the editor, show the "Remixed from {slug}" pill, and send `parentSlug` on save. (The prototype used `#remix=`.)
- Not built yet on the backend, so **do not call**: `POST /patterns/:slug/plays`, `DELETE /patterns/:slug`, `GET /health`. Leave clear TODOs.
- Never send `isPublic`.

## 9. Milestones and acceptance checks

1. **Static parity.** Header, background, tabs, hero, preview (fake pattern from seed is OK here), transport, params panel, save card, footer, responsive layout. *Check:* side by side with the prototype at 1440px and 390px; tokens match section 3; no shadows, glows or gradients on UI.
2. **State and validation.** Reducer, all six generators' blocks, live `safeParse`, request preview JSON. *Check:* default state of every generator parses; effects at 0 are omitted; `steps` is a number.
3. **Audio: arpeggio.** Seeded generator, Tone playback, custom swing, effects, live updates, clean disposal; preview now drawn from real events. *Check:* same seed gives an identical event hash after reload; swing 1 is clearly audible at 8n and 16n; Play, Stop and generator switches never leave stray sound.
4. **Remaining generators**, one at a time, each with its determinism test and preview mapping.
5. **API.** Save, remix via `?remix=`, all error states, cold-start status. *Check:* create then fetch the same params back; a remix increments the parent's `remixCount` (look at the API); a bad body shows the offending fields.
6. **Polish.** Keyboard access and focus rings, `aria` labels, reduced motion, mobile pass.

## 10. Do not

- Redesign, add sections, or change copy and tokens without asking.
- Add canvas, WebGL, Three.js, accounts, `localStorage`, or analytics.
- Expose `isPublic`.
- Call Tone's random features, or claim bit-identical audio.
- Build the Track page or Gallery in this task.
- Invent schema changes silently. If a field cannot be implemented (for example the `acoustic` kit), stop and report it.

## 11. Prompt to paste into opencode

```
Read docs/design/opencode-handoff.md fully before doing anything. Then read
docs/design/gms-studio-prototype.html (the approved visual prototype, treat it as
the source of truth for markup, CSS and the generator config object G) and
docs/design/arpeggio-test.html (reference for the seeded generator + Tone.js).

Build the Studio screen in apps/web following the milestones in section 9, one at a
time. Start with milestone 1 only. Use the existing @gms/shared package for
validation and types. Follow the "Do not" list strictly. When you finish a
milestone, stop, summarize what changed and which acceptance checks you ran, and
wait for me before starting the next one. If anything in the brief conflicts with
the code or schema, stop and ask instead of guessing.
```
