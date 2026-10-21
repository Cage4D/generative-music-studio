"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="track">
      <div className="card" role="alert">
        <h1 className="track-title">Something went wrong.</h1>
        <p className="track-copy">
          The studio hit an unexpected error. Reload to try again.
        </p>
        <button type="button" className="btn p" onClick={reset}>
          Reload
        </button>
      </div>
    </main>
  );
}
