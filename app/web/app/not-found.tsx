import { TrackShell } from "@/components/studio/TrackShell";
import Link from "next/link";

export default function NotFound() {
  return (
    <TrackShell>
      <h1 className="track-title">Page not found.</h1>
      <p className="track-copy">
        The page you were looking for doesn&apos;t exist.
      </p>
      <Link className="btn" href="/">
        Back to the studio
      </Link>
    </TrackShell>
  );
}
