import { SEED_MAX } from "@gms/shared";

type Props = {
  seed: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeedChange: (seed: number) => void;
  onShuffle: () => void;
  onCopySeed: () => void;
};

export function Transport({
  seed,
  playing,
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
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="sd">
        <label htmlFor="seed">Seed</label>
        <input
          type="number"
          id="seed"
          min={0}
          max={SEED_MAX}
          step={1}
          value={seed}
          onChange={(event) => onSeedChange(Number(event.target.value))}
        />
        <button type="button" className="btn" onClick={onShuffle}>
          Shuffle
        </button>
        <button type="button" className="btn" onClick={onCopySeed}>
          Copy
        </button>
      </div>
    </div>
  );
}
