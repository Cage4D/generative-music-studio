import type { CSSProperties, Ref } from "react";
import type { Preview } from "@/lib/preview";

function Grid({ preview }: { preview: Extract<Preview, { kind: "grid" }> }) {
  const { rows, columns, cells } = preview;
  const barEvery = preview.barEvery ?? 4;
  const dense = columns > 32;
  return (
    <div
      className={`g${dense ? " dense" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells.map((on, index) => {
        const column = index % columns;
        const brighter = column % barEvery === 0;
        return (
          <i
            key={index}
            className={`c${on ? " on" : ""}${brighter ? " b" : ""}`}
          />
        );
      })}
    </div>
  );
}

function Pad({ preview }: { preview: Extract<Preview, { kind: "pad" }> }) {
  return (
    <div className="pad">
      {preview.blocks.map((block, blockIndex) => (
        <div key={blockIndex} className="blk" style={{ flex: block.flex }}>
          {block.bars.map((bar, barIndex) => (
            <i
              key={barIndex}
              style={{
                width: `${bar.width}%`,
                marginLeft: `${bar.marginLeft}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Texture({
  preview,
}: {
  preview: Extract<Preview, { kind: "texture" }>;
}) {
  return (
    <div className="tx">
      {preview.bars.map((bar, index) => (
        <i
          key={index}
          style={
            {
              "--h": `${bar.height}%`,
              "--s": `${bar.duration}s`,
              "--dl": `${bar.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function PatternPreview({
  preview,
  playheadRef,
  manual = false,
}: {
  preview: Preview;
  playheadRef?: Ref<HTMLDivElement>;
  manual?: boolean;
}) {
  return (
    <div className="card" id="vis">
      <div className="vh">
        <span>Pattern preview</span>
        <span className="lv">
          <i />
        </span>
      </div>
      <div className="in">
        {preview.kind === "pad" && <Pad preview={preview} />}
        {preview.kind === "texture" && <Texture preview={preview} />}
        {preview.kind === "grid" && <Grid preview={preview} />}
        <div
          ref={playheadRef}
          className={`head${manual ? " manual" : ""}`}
          style={{ "--d": `${preview.duration}s` } as CSSProperties}
        />
      </div>
    </div>
  );
}
