"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PatternResponse } from "@gms/shared";
import { ApiError, describeApiError, getPattern } from "@/lib/api";
import { Studio } from "./Studio";
import { TrackShell } from "./TrackShell";

type ViewState =
  | { status: "loading" }
  | { status: "ready"; response: PatternResponse }
  | { status: "notFound" }
  | { status: "error"; message: string };

export function TrackView({ slug }: { slug: string }) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getPattern(slug)
      .then((response) => {
        if (!active) return;
        setState({ status: "ready", response });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "notFound") {
          setState({ status: "notFound" });
          return;
        }
        const message =
          error instanceof ApiError
            ? describeApiError(error)
            : "Something went wrong.";
        setState({ status: "error", message });
      });
    return () => {
      active = false;
    };
  }, [slug, attempt]);

  if (state.status === "loading") {
    return (
      <TrackShell>
        <h1 className="track-title">Loading track…</h1>
        <p className="track-copy">
          Fetching <b>{slug}</b> from the server.
        </p>
      </TrackShell>
    );
  }

  if (state.status === "notFound") {
    return (
      <TrackShell>
        <h1 className="track-title">This track doesn&apos;t exist.</h1>
        <p className="track-copy">
          No pattern matches <b>{slug}</b>.
        </p>
        <Link className="btn" href="/">
          Back to the studio
        </Link>
      </TrackShell>
    );
  }

  if (state.status === "error") {
    return (
      <TrackShell>
        <h1 className="track-title">We couldn&apos;t load this track.</h1>
        <p className="track-copy">{state.message}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      </TrackShell>
    );
  }

  return <Studio initialPattern={state.response} />;
}
