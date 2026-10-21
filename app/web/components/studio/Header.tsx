import Link from "next/link";

export function Header() {
  return (
    <header className="hdr">
      <span className="logo">
        <svg
          className="mk"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <g fill="none" stroke="#8fb0ff" strokeWidth="2" strokeLinecap="round">
            <path d="M4 10v4" />
            <path d="M8 6v12" />
            <path d="M12 3v18" />
            <path d="M16 7v10" />
            <path d="M20 10v4" />
          </g>
        </svg>
        <span>
          Generative <em>Music</em> Studio
        </span>
      </span>
      <nav aria-label="Primary">
        <Link className="on" href="/">
          Studio
        </Link>
        <span className="off" aria-disabled="true">
          Gallery<span className="sr-only"> (coming soon)</span>
        </span>
        <span className="tag">Preview</span>
      </nav>
    </header>
  );
}
