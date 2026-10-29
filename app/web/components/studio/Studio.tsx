"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CreatePatternSchema, type GeneratorId, type PatternResponse } from "@gms/shared";
import type { ArpeggioEngine, ArpeggioEngineClass } from "@/audio/engine";
import { readDevFlags } from "@/audio/dev-flags";
import {
  type ArpeggioParams,
  type BasslineParams,
  type DrumParams,
  type MelodyParams,
  type NoteLength,
  type PadParams,
} from "@/audio/types";
import {
  ApiError,
  createPattern,
  describeApiError,
  getPattern,
  isRetryable,
  shareUrl,
} from "@/lib/api";
import {
  GENERATORS,
  GENERATOR_BY_ID,
  isGeneratorSupported,
  saveDisabledFor,
} from "@/lib/generators";
import { hydrateState } from "@/lib/pattern-io";
import { columnOf, PAGE_STEPS, pageOf } from "@/lib/paging";
import {
  bassColumnOfStep,
  buildPreviewFrom,
  engineParamsFor,
} from "@/lib/preview";
import { buildRequest } from "@/lib/request";
import {
  createDefaultState,
  studioReducer,
  type EffectId,
  type NoteName,
  type ScaleName,
  type SharedParams,
  type StudioState,
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

const WAKE_DELAY_MS = 1500;

type StudioProps = {
  initialPattern?: PatternResponse;
};

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function initState(response: PatternResponse | undefined): StudioState {
  if (!response) return createDefaultState();
  return hydrateState(
    createDefaultState(),
    response.pattern,
    response.parentSlug,
    response.title ?? "",
  );
}

export function Studio({ initialPattern }: StudioProps = {}) {
  const [state, dispatch] = useReducer(studioReducer, initialPattern, initState);

  const engineRef = useRef<ArpeggioEngine | null>(null);
  const engineCtorRef = useRef<ArpeggioEngineClass | null>(null);
  const toneRef = useRef<typeof import("tone") | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [page, setPage] = useState(0);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [seedCopied, setSeedCopied] = useState(false);
  const pageRef = useRef(0);
  const stepRef = useRef(-1);
  const totalStepsRef = useRef(0);
  // The bass preview is a single page, so its engine steps are mapped onto the
  // preview columns instead of using the paged layout.
  const columnRef = useRef<(step: number) => number>(columnOf);
  const seedCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchParams = useSearchParams();
  const remixParam = initialPattern ? null : searchParams.get("remix");

  useEffect(() => {
    if (!remixParam) return;
    let active = true;
    getPattern(remixParam)
      .then((response) => {
        if (!active) return;
        dispatch({
          type: "hydrate",
          state: hydrateState(
            createDefaultState(),
            response.pattern,
            response.slug,
            "",
          ),
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("network", "Couldn't load that remix.");
        dispatch({
          type: "setSaveStatus",
          value: {
            kind: "error",
            message: `Couldn't load remix: ${describeApiError(apiError)}`,
            retryable: false,
          },
        });
      });
    return () => {
      active = false;
    };
  }, [remixParam]);

  useEffect(() => {
    if (state.generatorId !== "bassline") {
      columnRef.current = columnOf;
      return;
    }
    const noteLength = String(
      state.blocks.bassline.noteLength ?? "8n",
    ) as NoteLength;
    columnRef.current = (step: number) => bassColumnOfStep(step, noteLength);
  }, [state.generatorId, state.blocks]);

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
    const position = ((columnRef.current(step) + 0.5) / PAGE_STEPS) * width;
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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (seedCopyTimerRef.current) clearTimeout(seedCopyTimerRef.current);
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

  async function startPlayback(
    params: ArpeggioParams | MelodyParams | BasslineParams | DrumParams | PadParams,
  ) {
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

  const supported = isGeneratorSupported(state.generatorId);

  const request = useMemo(() => buildRequest(state), [state]);
  const validation = useMemo(
    () => CreatePatternSchema.safeParse(request),
    [request],
  );
  const validationMessage = validation.success
    ? null
    : formatIssue(validation.error.issues[0]);

  const handleSave = useCallback(async () => {
    if (!validation.success || !supported) return;
    if (
      state.saveStatus.kind === "saving" ||
      state.saveStatus.kind === "waking"
    ) {
      return;
    }

    dispatch({ type: "setSaveStatus", value: { kind: "saving" } });
    const wakeTimer = setTimeout(() => {
      if (mountedRef.current) {
        dispatch({ type: "setSaveStatus", value: { kind: "waking" } });
      }
    }, WAKE_DELAY_MS);

    try {
      const response = await createPattern(validation.data);
      if (!mountedRef.current) return;
      dispatch({
        type: "setSaveStatus",
        value: { kind: "saved", slug: response.slug },
      });
    } catch (error) {
      if (!mountedRef.current) return;
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError("network", "Couldn't save this pattern.");
      dispatch({
        type: "setSaveStatus",
        value: {
          kind: "error",
          message: describeApiError(apiError),
          retryable: isRetryable(apiError),
        },
      });
    } finally {
      clearTimeout(wakeTimer);
    }
  }, [validation, supported, state.saveStatus.kind]);

  async function handleCopyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(
        shareUrl(slug, window.location.origin),
      );
      setCopiedSlug(slug);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedSlug(null), 1500);
    } catch {
      // clipboard access can be denied; nothing to do
    }
  }

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

  const totalSteps = preview.kind === "grid" ? preview.totalSteps : 0;
  useEffect(() => {
    totalStepsRef.current = totalSteps;
  }, [totalSteps]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const activeIndex = GENERATORS.findIndex(
    (generator) => generator.id === state.generatorId,
  );
  const activeGenerator = GENERATOR_BY_ID[state.generatorId];

  function renderSaveStatus(): ReactNode {
    const status = state.saveStatus;
    if (status.kind === "saving" || status.kind === "waking") {
      return (
        <span>
          <span className="dot" aria-hidden="true" />
          {status.kind === "waking" ? "Waking the server…" : "Saving…"}
        </span>
      );
    }
    if (status.kind === "saved") {
      const url = shareUrl(status.slug, origin);
      return (
        <span>
          Saved. <a href={url}>{url}</a>{" "}
          <button
            type="button"
            className="btn"
            onClick={() => handleCopyLink(status.slug)}
          >
            {copiedSlug === status.slug ? "Copied" : "Copy link"}
          </button>
        </span>
      );
    }
    if (status.kind === "error") {
      return (
        <span>
          {status.message}
          {status.retryable && (
            <>
              {" "}
              <button type="button" className="btn" onClick={handleSave}>
                Retry
              </button>
            </>
          )}
        </span>
      );
    }
    if (!supported) {
      return "Coming soon — saving is disabled for this voice.";
    }
    return validationMessage;
  }

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
      setSeedCopied(true);
      if (seedCopyTimerRef.current) clearTimeout(seedCopyTimerRef.current);
      seedCopyTimerRef.current = setTimeout(() => setSeedCopied(false), 1500);
    } catch {
      // clipboard access can be denied; nothing to do
    }
  }

  const saving =
    state.saveStatus.kind === "saving" || state.saveStatus.kind === "waking";

  function handleSelectPage(next: number) {
    if (state.playing) return;
    pageRef.current = next;
    setPage(next);
    applyPlayhead();
  }

  return (
    <div className={state.playing ? "playing" : undefined}>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Header />
      <main id="main" tabIndex={-1}>
        <section
          id="generator-panel"
          role="tabpanel"
          aria-labelledby={`tab-${state.generatorId}`}
          tabIndex={-1}
        >
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
              state.generatorId === "arpeggio" ||
              state.generatorId === "melody" ||
              state.generatorId === "bassline" ||
              state.generatorId === "drum-pattern" ||
              state.generatorId === "ambient-pad"
            }
            page={page}
            onSelectPage={handleSelectPage}
            playing={state.playing}
            alt={`Pattern preview: ${activeGenerator.name}, seed ${state.seed}, ${state.tempo} BPM, root ${state.root}, ${state.scale} scale.`}
          />
          <Transport
            seed={state.seed}
            playing={state.playing}
            seedCopied={seedCopied}
            onTogglePlay={handleTogglePlay}
            onSeedChange={(value) => dispatch({ type: "setSeed", value })}
            onShuffle={shuffleSeed}
            onCopySeed={copySeed}
          />
        </section>
        <aside>
          {initialPattern && (
            <div className="card save">
              <Link className="btn p" href={`/?remix=${initialPattern.slug}`}>
                Remix this pattern
              </Link>
            </div>
          )}
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
            status={renderSaveStatus()}
            disabled={saveDisabledFor(
              state.generatorId,
              validation.success,
              saving,
            )}
            request={request}
            onTitleChange={(value) => dispatch({ type: "setTitle", value })}
            onSave={handleSave}
          />
        </aside>
      </main>
      <Footer />
    </div>
  );
}
