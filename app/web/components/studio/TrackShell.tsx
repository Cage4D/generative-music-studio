import type { ReactNode } from "react";
import { Background } from "./Background";
import { Header } from "./Header";
import { Footer } from "./Footer";

export function TrackShell({ children }: { children: ReactNode }) {
  return (
    <div>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Header />
      <main className="track" id="main" tabIndex={-1}>
        <div className="card">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
