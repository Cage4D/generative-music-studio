"use client";

import { useRef, type KeyboardEvent } from "react";
import { GENERATORS, isGeneratorSupported } from "@/lib/generators";
import type { GeneratorId } from "@gms/shared";

type Props = {
  activeId: GeneratorId;
  onSelect: (id: GeneratorId) => void;
  panelId?: string;
};

export function GeneratorTabs({
  activeId,
  onSelect,
  panelId = "generator-panel",
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  function moveTo(index: number) {
    const count = GENERATORS.length;
    if (count === 0) return;
    const clamped = ((index % count) + count) % count;
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[clamped]?.focus();
    onSelect(GENERATORS[clamped].id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = GENERATORS.findIndex((generator) => generator.id === activeId);
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveTo(current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveTo(current - 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(GENERATORS.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Generators"
      ref={listRef}
      onKeyDown={handleKeyDown}
    >
      {GENERATORS.map((generator) => {
        const selected = generator.id === activeId;
        return (
          <button
            key={generator.id}
            type="button"
            role="tab"
            id={`tab-${generator.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={selected ? "tab on" : "tab"}
            onClick={() => onSelect(generator.id)}
          >
            {generator.name}
            {!isGeneratorSupported(generator.id) && (
              <span className="soon">Soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
