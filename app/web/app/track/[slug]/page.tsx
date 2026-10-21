import { Suspense } from "react";
import type { Metadata } from "next";
import { TrackShell } from "@/components/studio/TrackShell";
import { TrackView } from "@/components/studio/TrackView";
import { getPattern } from "@/lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { pattern } = await getPattern(slug);
    const title = `Generative Music Studio: ${pattern.generatorId} seed ${pattern.params.seed}`;
    const description = `A ${pattern.generatorId} pattern, seed ${pattern.params.seed}. Open it in Generative Music Studio to listen and remix.`;
    return { title, description, openGraph: { title, description } };
  } catch {
    return { title: `Generative Music Studio: ${slug}` };
  }
}

function LoadingTrack() {
  return (
    <TrackShell>
      <p className="track-title">Loading track…</p>
    </TrackShell>
  );
}

async function TrackRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TrackView slug={slug} />;
}

export default function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<LoadingTrack />}>
      <TrackRoute params={params} />
    </Suspense>
  );
}
