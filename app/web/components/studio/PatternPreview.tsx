import type { CSSProperties, Ref } from "react";
import { PAGE_STEPS, pageCount } from "@/lib/paging";
import type { GridNote, Preview } from "@/lib/preview";

// A note is drawn a little smaller than its cell, so its size can carry the
// duration and the velocity. The width is capped at the cell, so a long note
// never spills into the next step.
const NOTE_MIN_WIDTH = 0.7;
const NOTE_MIN_HEIGHT = 0.8;

function noteStyle(note: GridNote | undefined): CSSProperties | undefined {
  if (!note) return undefined;
  return {
    justifySelf: "center",
    alignSelf: "center",
    width: `${(NOTE_MIN_WIDTH + (1 - NOTE_MIN_WIDTH) * note.duration) * 100}%`,
    height: `${(NOTE_MIN_HEIGHT + (1 - NOTE_MIN_HEIGHT) * note.velocity) * 100}%`,
  };
}

function Grid({
  preview,
  page,
}: {
  preview: Extract<Preview, { kind: "grid" }>;
  page: number;
}) {
  const { rows, totalSteps, cells, notes } = preview;
  const barEvery = preview.barEvery ?? 4;
  const pages = pageCount(totalSteps);
  const activePage = Math.max(0, Math.min(page, pages - 1));
  const start = activePage * PAGE_STEPS;

  const visible: boolean[] = [];
  const dim: boolean[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < PAGE_STEPS; column++) {
      const step = start + column;
      const beyond = step >= totalSteps;
      visible.push(!beyond && cells[row * totalSteps + step]);
      dim.push(beyond);
    }
  }

  return (
    <div
      className="g"
      style={{
        gridTemplateColumns: `repeat(${PAGE_STEPS}, 1fr)`,
        // The cell size comes from the shared --cell token, so a grid with
        // four rows has the same cells as one with eight.
        gridTemplateRows: `repeat(${rows}, minmax(0, var(--cell)))`,
      }}
    >
      {visible.map((on, index) => {
        const column = index % PAGE_STEPS;
        const brighter = column % barEvery === 0;
        const classes = `c${on ? " on" : ""}${brighter ? " b" : ""}${
          dim[index] ? " dim" : ""
        }`;
        return (
          <i
            key={index}
            className={classes}
            style={on ? noteStyle(notes?.[index]) : undefined}
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
  page = 0,
  onSelectPage,
  playing = false,
  alt,
}: {
  preview: Preview;
  playheadRef?: Ref<HTMLDivElement>;
  manual?: boolean;
  page?: number;
  onSelectPage?: (page: number) => void;
  playing?: boolean;
  alt?: string;
}) {
  const pages = preview.kind === "grid" ? pageCount(preview.totalSteps) : 1;
  const activePage = Math.max(0, Math.min(page, pages - 1));

  return (
    <div className="card" id="vis">
      <div className="vh">
        <span>Pattern preview</span>
        {pages > 1 && (
          <div className="pages">
            {Array.from({ length: pages }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Show page ${index + 1} of ${pages}`}
                aria-current={index === activePage ? "true" : undefined}
                className={index === activePage ? "on" : undefined}
                onClick={() => onSelectPage?.(index)}
                disabled={playing}
              >
                {index + 1}
              </button>
            ))}
          </div>
        )}
        <span className="lv" aria-hidden="true">
          <i />
        </span>
      </div>
      <div className="in" role="img" aria-label={alt}>
        {preview.kind === "pad" && <Pad preview={preview} />}
        {preview.kind === "texture" && <Texture preview={preview} />}
        {preview.kind === "grid" && (
          <Grid preview={preview} page={activePage} />
        )}
        <div
          ref={playheadRef}
          className={`head${manual ? " manual" : ""}`}
          style={{ "--d": `${preview.duration}s` } as CSSProperties}
        />
      </div>
    </div>
  );
}
