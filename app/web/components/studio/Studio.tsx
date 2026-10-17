"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CreatePatternSchema, type GeneratorId } from "@gms/shared";
import type { ArpeggioEngine, ArpeggioEngineClass } from "@/audio/engine";
import { readDevFlags } from "@/audio/dev-flags";
import { type ArpeggioParams, type MelodyParams } from "@/audio/types";
import { GENERATORS, GENERATOR_BY_ID } from "@/lib/generators";
import { columnOf, PAGE_STEPS, pageOf } from "@/lib/paging";
import { buildPreviewFrom, engineParamsFor } from "@/lib/preview";
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

  const engineRef = useRef<ArpeggioEngine | null>(null);
  const engineCtorRef = useRef<ArpeggioEngineClass | null>(null);
  const toneRef = useRef<typeof import("tone") | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const stepRef = useRef(-1);
  const totalStepsRef = useRef(0);

  const applyPlayhead = useCallback(() => {
    const element = playheadRef.current;
    if (!element) return;
    const step = stepRef.current;
    const currentPage = pageRef.current;
    if (step < 0) {
      element.style.visibility = currentPage === 0 ? "visible" : "hidden";
      element.style.transform = "translateX(0)";
      return;
    }
    if (pageOf(step, totalStepsRef.current) !== currentPage) {
      element.style.visibility = "hidden";
      return;
    }
    const width = element.parentElement?.clientWidth ?? 0;
    const position = ((columnOf(step) + 0.5) / PAGE_STEPS) * width;
    element.style.visibility = "visible";
    element.style.transform = `translateX(${position}px)`;
  }, []);

  const movePlayhead = useCallback(
    (step: number) => {
      stepRef.current = step;
      const next = step < 0 ? 0 : pageOf(step, totalStepsRef.current);
      if (next !== pageRef.current) {
        pageRef.current = next;
        setPage(next);
      }
      applyPlayhead();
    },
    [applyPlayhead],
  );

  // `?draw=off` skips the playhead entirely so audio diagnostics run without
  // React state updates in the scheduling path.
  const drawOff = useMemo(() => readDevFlags().drawOff, []);
  const stepHandler = drawOff ? null : movePlayhead;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        engineRef.current?.dispose();
      } catch (error) {
        console.error("Engine dispose failed", error);
      }
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([import("tone"), import("@/audio/engine")])
      .then(([tone, engineModule]) => {
        if (!active) return;
        toneRef.current = tone;
        engineCtorRef.current = engineModule.ArpeggioEngine;
        engineModule.ensureToneContext();
        if (!engineRef.current) {
          const engine = new engineModule.ArpeggioEngine();
          engine.onStep = stepHandler;
          engineRef.current = engine;
          const initial = engineParamsFor(stateRef.current);
          if (initial) engine.update(initial);
          engine.prepare().catch((error) => {
            console.error("Audio prepare failed", error);
          });
        }
      })
      .catch((error) => {
        console.error("Audio modules failed to load", error);
      });
    return () => {
      active = false;
    };
  }, [movePlayhead, stepHandler]);

  useEffect(() => {
    const params = engineParamsFor(state);
    if (!params) return;
    try {
      engineRef.current?.update(params);
    } catch (error) {
      console.error("Engine update failed", error);
    }
  }, [state]);

  const ensureEngine = useCallback(async (): Promise<ArpeggioEngine> => {
    if (engineRef.current) return engineRef.current;
    const Ctor =
      engineCtorRef.current ?? (await import("@/audio/engine")).ArpeggioEngine;
    const engine = new Ctor();
    engine.onStep = stepHandler;
    engineRef.current = engine;
    return engine;
  }, [stepHandler]);

  async function startPlayback(params: ArpeggioParams | MelodyParams) {
    const tone = toneRef.current ?? (await import("tone"));
    toneRef.current = tone;
    await tone.start();
    if (!mountedRef.current) return;
    const engine = await ensureEngine();
    await engine.start(params);
  }

  async function handleTogglePlay() {
    if (state.playing) {
      try {
        engineRef.current?.stop();
      } catch (error) {
        console.error("Stop failed", error);
      }
      dispatch({ type: "togglePlay" });
      return;
    }
    const params = engineParamsFor(state);
    if (!params) {
      dispatch({ type: "togglePlay" });
      return;
    }
    try {
      await startPlayback(params);
      if (!mountedRef.current) return;
      dispatch({ type: "togglePlay" });
    } catch (error) {
      console.error("Playback failed", error);
    }
  }

  async function handleSelectGenerator(generatorId: GeneratorId) {
    if (generatorId === state.generatorId) return;
    const nextParams = engineParamsFor({ ...state, generatorId });
    if (nextParams) {
      dispatch({ type: "selectGenerator", generatorId });
      if (state.playing) {
        try {
          await startPlayback(nextParams);
        } catch (error) {
          console.error("Playback failed", error);
        }
      }
      return;
    }
    if (engineRef.current?.isRunning()) {
      try {
        engineRef.current.stop();
      } catch (error) {
        console.error("Stop failed", error);
      }
      if (state.playing) dispatch({ type: "togglePlay" });
    }
    dispatch({ type: "selectGenerator", generatorId });
  }

  // The preview only depends on these fields; keeping effect/title/save changes
  // out of the memo avoids regenerating the grid on every unrelated keystroke.
  const preview = useMemo(
    () =>
      buildPreviewFrom({
        generatorId: state.generatorId,
        seed: state.seed,
        tempo: state.tempo,
        density: state.density,
        root: state.root,
        scale: state.scale,
        blocks: state.blocks,
      }),
    [
      state.generatorId,
      state.seed,
      state.tempo,
      state.density,
      state.root,
      state.scale,
      state.blocks,
    ],
  );
  const request = useMemo(() => buildRequest(state), [state]);
  const validation = useMemo(
    () => CreatePatternSchema.safeParse(request),
    [request],
  );

  const totalSteps = preview.kind === "grid" ? preview.totalSteps : 0;
  useEffect(() => {
    totalStepsRef.current = totalSteps;
  }, [totalSteps]);

  function handleSelectPage(next: number) {
    if (state.playing) return;
    pageRef.current = next;
    setPage(next);
    applyPlayhead();
  }

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
            onSelect={handleSelectGenerator}
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
          <PatternPreview
            preview={preview}
            playheadRef={playheadRef}
            manual={
              state.generatorId === "arpeggio" || state.generatorId === "melody"
            }
            page={page}
            onSelectPage={handleSelectPage}
            playing={state.playing}
          />
          <Transport
            seed={state.seed}
            playing={state.playing}
            onTogglePlay={handleTogglePlay}
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
