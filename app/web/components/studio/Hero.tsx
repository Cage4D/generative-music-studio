type Props = {
  index: number;
  total: number;
  name: string;
  lede: string;
  root: string;
  scale: string;
  tempo: number;
  seed: number;
};

const pad = (value: number) => String(value).padStart(2, "0");

export function Hero({ index, total, name, lede, root, scale, tempo, seed }: Props) {
  return (
    <>
      <p className="eye">Generator {pad(index)} / {pad(total)}</p>
      <h1>{name}</h1>
      <p className="lede">{lede}</p>
      <div className="chips">
        <span className="chip">
          {root} {scale}
        </span>
        <span className="chip">{tempo} bpm</span>
        <span className="chip">seed {seed}</span>
      </div>
    </>
  );
}
