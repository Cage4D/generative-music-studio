import { GENERATORS, isGeneratorSupported } from "@/lib/generators";
import type { GeneratorId } from "@gms/shared";

type Props = {
  activeId: GeneratorId;
  onSelect: (id: GeneratorId) => void;
};

export function GeneratorTabs({ activeId, onSelect }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label="Generators">
      {GENERATORS.map((generator) => (
        <button
          key={generator.id}
          type="button"
          role="tab"
          aria-selected={generator.id === activeId}
          className={generator.id === activeId ? "tab on" : "tab"}
          onClick={() => onSelect(generator.id)}
        >
          {generator.name}
          {!isGeneratorSupported(generator.id) && (
            <span className="soon">Soon</span>
          )}
        </button>
      ))}
    </div>
  );
}
