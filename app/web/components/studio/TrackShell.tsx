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
      <div className="track">
        <div className="card">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
