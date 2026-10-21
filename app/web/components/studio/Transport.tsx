import { SEED_MAX } from "@gms/shared";

type Props = {
  seed: number;
  playing: boolean;
  seedCopied: boolean;
  onTogglePlay: () => void;
  onSeedChange: (seed: number) => void;
  onShuffle: () => void;
  onCopySeed: () => void;
};

export function Transport({
  seed,
  playing,
  seedCopied,
  onTogglePlay,
  onSeedChange,
  onShuffle,
  onCopySeed,
}: Props) {
  return (
    <div className="card tp">
      <button
        type="button"
        id="play"
        aria-pressed={playing}
        aria-label={playing ? "Stop" : "Play"}
        onClick={onTogglePlay}
      >
        <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
      </button>
      <div className="sd">
        <label htmlFor="seed">Seed</label>
        <input
          type="number"
          id="seed"
          min={0}
          max={SEED_MAX}
          step={1}
          inputMode="numeric"
          value={seed}
          onChange={(event) => onSeedChange(Number(event.target.value))}
        />
        <button
          type="button"
          className="btn"
          aria-label="Shuffle seed"
          onClick={onShuffle}
        >
          Shuffle
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Copy seed"
          onClick={onCopySeed}
        >
          Copy
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {seedCopied ? "Seed copied to clipboard" : ""}
        </span>
      </div>
    </div>
  );
}
