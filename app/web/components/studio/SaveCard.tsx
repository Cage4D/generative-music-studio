import type { ReactNode } from "react";

type Props = {
  title: string;
  parentSlug: string | null;
  status: ReactNode;
  disabled: boolean;
  request: unknown;
  onTitleChange: (title: string) => void;
  onSave: () => void;
};

export function SaveCard({
  title,
  parentSlug,
  status,
  disabled,
  request,
  onTitleChange,
  onSave,
}: Props) {
  return (
    <div className="card save">
      {parentSlug && (
        <div id="remix">
          Remixed from <b>{parentSlug}</b>
        </div>
      )}
      <label htmlFor="title">
        <span>Title (optional)</span>
        <span id="cnt">{title.length}/60</span>
      </label>
      <input
        type="text"
        id="title"
        maxLength={60}
        placeholder="Untitled pattern"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <button
        type="button"
        className="btn p"
        onClick={onSave}
        disabled={disabled}
      >
        {parentSlug ? "Save remix" : "Save & get link"}
      </button>
      <div id="out" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>
      <details>
        <summary>Request preview</summary>
        <pre>{JSON.stringify(request, null, 1)}</pre>
      </details>
    </div>
  );
}
