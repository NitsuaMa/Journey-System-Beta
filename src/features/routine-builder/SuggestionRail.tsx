/**
 * Ranked machine suggestions, each carrying the reason it was ranked.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * A recommendation with no reason is a recommendation a trainer either
 * follows blindly or ignores entirely, and both are worse than no
 * recommendation. So every chip shows its strongest reason in the Academy's
 * own terms, and the tag on the right says what KIND of reason it is —
 * "GAP" (a foundational category is missing) carries a different weight to
 * "PAIR" (this goes well with something already there), and a trainer
 * deciding under time pressure needs that difference at a glance.
 *
 * Hovering or focusing a suggestion previews it on the figure, so the answer
 * to "what would this add" is visible before the tap, not after.
 */

import { Plus } from "lucide-react";
import type { ReasonKind, Suggestion } from "./engine";

const TAG: Partial<Record<ReasonKind, { text: string; cls: string }>> = {
  "foundational-gap": { text: "gap", cls: "rb-tag--gap" },
  "frequency-gap": { text: "2×/wk", cls: "rb-tag--freq" },
  template: { text: "goal", cls: "rb-tag--goal" },
  "category-gap": { text: "gap", cls: "rb-tag--gap" },
  pair: { text: "pairs", cls: "rb-tag--pair" },
  "big-five": { text: "big 5", cls: "rb-tag--pair" },
};

export interface SuggestionRailProps {
  suggestions: Suggestion[];
  machineName: (id: string) => string;
  onAdd: (machineId: string) => void;
  onPreview?: (machineId: string | null) => void;
  emptyText?: string;
}

export function SuggestionRail({
  suggestions,
  machineName,
  onAdd,
  onPreview,
  emptyText = "Nothing to suggest — this routine covers what the Academy asks for.",
}: SuggestionRailProps) {
  if (suggestions.length === 0) {
    return <p className="rb-note rb-note--muted">{emptyText}</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {suggestions.map((s) => {
        const lead = s.reasons[0];
        const tag = lead ? TAG[lead.kind] : undefined;
        return (
          <button
            key={s.machineId}
            type="button"
            className="rb-sug"
            onClick={() => onAdd(s.machineId)}
            onMouseEnter={() => onPreview?.(s.machineId)}
            onMouseLeave={() => onPreview?.(null)}
            onFocus={() => onPreview?.(s.machineId)}
            onBlur={() => onPreview?.(null)}
          >
            <Plus size={14} className="rb-sug__plus" aria-hidden />
            <span className="rb-sug__body">
              <span className="rb-sug__name">
                {machineName(s.machineId)}
                {tag && <span className={`rb-tag ${tag.cls}`}>{tag.text}</span>}
                {s.conflictsAtEnd && <span className="rb-tag rb-tag--clash">order</span>}
              </span>
              <span className="rb-sug__why">{s.headline}</span>
              {lead?.source && <span className="rb-sug__src">{lead.source}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
