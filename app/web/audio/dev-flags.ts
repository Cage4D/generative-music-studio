import { EFFECT_IDS, type EffectId } from "../lib/studio-state";
import { ALL_FORCED_VOICE_KINDS, type ForcedVoiceKind } from "./types";

export type DevFlags = {
  fxOff: boolean;
  removedFx: EffectId[];
  forcedVoice: ForcedVoiceKind | null;
  drawOff: boolean;
};

const NO_FLAGS: DevFlags = {
  fxOff: false,
  removedFx: [],
  forcedVoice: null,
  drawOff: false,
};

export function parseRemovedFx(raw: string | null): {
  fxOff: boolean;
  removedFx: EffectId[];
} {
  if (!raw) return { fxOff: false, removedFx: [] };
  const removedFx: EffectId[] = [];
  let fxOff = false;
  for (const part of raw.split(",").map((value) => value.trim())) {
    if (!part) continue;
    if (part === "off") {
      fxOff = true;
    } else if ((EFFECT_IDS as readonly string[]).includes(part)) {
      removedFx.push(part as EffectId);
    }
  }
  return { fxOff, removedFx };
}

export function readDevFlags(): DevFlags {
  if (process.env.NODE_ENV === "production") return NO_FLAGS;
  if (typeof window === "undefined") return NO_FLAGS;
  try {
    const params = new URLSearchParams(window.location.search);
    const voice = params.get("voice");
    const { fxOff, removedFx } = parseRemovedFx(params.get("fx"));
    const flags: DevFlags = {
      fxOff,
      removedFx,
      forcedVoice:
        voice && (ALL_FORCED_VOICE_KINDS as readonly string[]).includes(voice)
          ? (voice as ForcedVoiceKind)
          : null,
      drawOff: params.get("draw") === "off",
    };
    if (flags.fxOff || flags.removedFx.length || flags.forcedVoice || flags.drawOff) {
      console.debug(
        `[arpeggio] dev flags fx=${flags.fxOff ? "off" : flags.removedFx.join(",") || "on"} voice=${
          flags.forcedVoice ?? "auto"
        } draw=${flags.drawOff ? "off" : "on"}`,
      );
    }
    return flags;
  } catch {
    return NO_FLAGS;
  }
}
