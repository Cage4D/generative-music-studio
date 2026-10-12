"use client";

import { useMemo, useReducer } from "react";
import { CreatePatternSchema, type GeneratorId } from "@gms/shared";
import { GENERATORS, GENERATOR_BY_ID } from "@/lib/generators";
import { buildPreview } from "@/lib/preview";
import { buildRequest } from "@/lib/request";
import {
  createDefaultState,
  studioReducer,
  type EffectId,
  type NoteName,
  type ScaleName,
  type SharedParams,
} from "@/lib/studio-state";
import { Background } from "./Background";
import { Header } from "./Header";
import { GeneratorTabs } from "./GeneratorTabs";
import { Hero } from "./Hero";
import { PatternPreview } from "./PatternPreview";
import { Transport } from "./Transport";
import { ParamsPanel } from "./ParamsPanel";
import { SaveCard } from "./SaveCard";
import { Footer } from "./Footer";

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function Studio() {
  const [state, dispatch] = useReducer(studioReducer, undefined, createDefaultState);

  const preview = useMemo(() => buildPreview(state), [state]);
  const request = useMemo(() => buildRequest(state), [state]);
  const validation = useMemo(
    () => CreatePatternSchema.safeParse(request),
    [request],
  );

  const activeIndex = GENERATORS.findIndex(
    (generator) => generator.id === state.generatorId,
  );
  const activeGenerator = GENERATOR_BY_ID[state.generatorId];

  const firstIssue = validation.success
    ? null
    : formatIssue(validation.error.issues[0]);
  const status =
    firstIssue ??
    (state.saveStatus.kind === "note" ? state.saveStatus.message : null);

  function changeShared(key: keyof SharedParams, value: number | string) {
    if (key === "root") {
      dispatch({ type: "setShared", patch: { root: value as NoteName } });
    } else if (key === "scale") {
      dispatch({ type: "setShared", patch: { scale: value as ScaleName } });
    } else {
      dispatch({
        type: "setShared",
        patch: { [key]: Number(value) } as Partial<SharedParams>,
      });
    }
  }

  function shuffleSeed() {
    const [next] = crypto.getRandomValues(new Uint32Array(1));
    dispatch({ type: "setSeed", value: next });
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(String(state.seed));
    } catch {
      // clipboard access can be denied; nothing to do
    }
  }

  return (
    <div className={state.playing ? "playing" : undefined}>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Header />
      <main>
        <section>
          <GeneratorTabs
            activeId={state.generatorId}
            onSelect={(generatorId: GeneratorId) =>
              dispatch({ type: "selectGenerator", generatorId })
            }
          />
          <Hero
            index={activeIndex + 1}
            total={GENERATORS.length}
            name={activeGenerator.name}
            lede={activeGenerator.lede}
            root={state.root}
            scale={state.scale}
            tempo={state.tempo}
            seed={state.seed}
          />
          <PatternPreview preview={preview} />
          <Transport
            seed={state.seed}
            playing={state.playing}
            onTogglePlay={() => dispatch({ type: "togglePlay" })}
            onSeedChange={(value) => dispatch({ type: "setSeed", value })}
            onShuffle={shuffleSeed}
            onCopySeed={copySeed}
          />
        </section>
        <aside>
          <ParamsPanel
            state={state}
            onSharedChange={changeShared}
            onBlockChange={(key, value) =>
              dispatch({ type: "setBlockField", key, value })
            }
            onEffectChange={(key: EffectId, value: number) =>
              dispatch({ type: "setEffect", key, value })
            }
          />
          <SaveCard
            title={state.title}
            parentSlug={state.parentSlug}
            status={status}
            disabled={!validation.success}
            request={request}
            onTitleChange={(value) => dispatch({ type: "setTitle", value })}
            onSave={() =>
              dispatch({
                type: "setSaveStatus",
                value: {
                  kind: "note",
                  message:
                    "Saving isn't connected yet — the patterns API arrives in a later milestone.",
                },
              })
            }
          />
        </aside>
      </main>
      <Footer />
    </div>
  );
}
