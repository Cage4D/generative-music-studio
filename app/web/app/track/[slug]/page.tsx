import { Suspense } from "react";
import { TrackShell } from "@/components/studio/TrackShell";
import { TrackView } from "@/components/studio/TrackView";

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
