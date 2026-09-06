/**
 * Add a machine — grouped by Academy category, searchable, one tap.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Grouped by the five programming categories rather than by movement pattern
 * or anatomical region, because the question being answered at the moment the
 * picker opens is usually "what is this routine missing", and the coverage
 * strip states that answer in exactly these five buckets. Grouping the picker
 * the same way means the trainer looks in the place the warning pointed at.
 *
 * Categories the routine has nothing from sort to the top, so the missing
 * bucket is the one under the thumb.
 *
 * The search box appears at 12 machines. Below that it costs a row of screen
 * to save nothing — the studios that run 20 machines need it, the ones
 * running eight do not.
 */

import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { ACADEMY_CATEGORIES, CATEGORY_LABEL, MACHINE_ABBR, MACHINE_CATEGORY } from "./academy";
import type { AcademyCategory } from "./academy";
import type { CategoryCoverage } from "./engine";

const SEARCH_THRESHOLD = 12;

export interface PickerMachine {
  id: string;
  name: string;
}

export interface MachinePickerProps {
  machines: PickerMachine[];
  /** Already in the sequence — shown dimmed rather than hidden, so the
   *  trainer can see the whole floor and does not wonder what is absent. */
  selectedIds: string[];
  coverage: CategoryCoverage[];
  onAdd: (machineId: string) => void;
  onRemove?: (machineId: string) => void;
  onPreview?: (machineId: string | null) => void;
  autoFocus?: boolean;
}

export function MachinePicker({
  machines,
  selectedIds,
  coverage,
  onAdd,
  onRemove,
  onPreview,
  autoFocus = false,
}: MachinePickerProps) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const showSearch = machines.length >= SEARCH_THRESHOLD;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: PickerMachine) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (MACHINE_ABBR[m.id] ?? "").toLowerCase().includes(q);

    const uncategorised: PickerMachine[] = [];
    const byCategory = new Map<AcademyCategory, PickerMachine[]>();
    for (const c of ACADEMY_CATEGORIES) byCategory.set(c, []);

    for (const m of machines) {
      if (!matches(m)) continue;
      const cat = MACHINE_CATEGORY[m.id];
      if (cat) byCategory.get(cat)!.push(m);
      else uncategorised.push(m);
    }

    const covered = new Map(coverage.map((c) => [c.category, c]));
    const ordered = ACADEMY_CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      machines: byCategory.get(category)!,
      missing: !covered.get(category)?.covered,
      foundational: !!covered.get(category)?.foundational,
    }))
      .filter((g) => g.machines.length > 0)
      // Missing foundational first, then missing, then the rest.
      .sort((a, b) => {
        const rank = (g: typeof a) => (g.missing && g.foundational ? 0 : g.missing ? 1 : 2);
        return rank(a) - rank(b);
      });

    if (uncategorised.length > 0) {
      ordered.push({
        category: "trunk" as AcademyCategory, // key only; label overridden below
        label: "Studio machines",
        machines: uncategorised,
        missing: false,
        foundational: false,
      });
    }
    return ordered;
  }, [machines, query, coverage]);

  const total = groups.reduce((n, g) => n + g.machines.length, 0);

  return (
    <div className="rb-pick">
      {showSearch && (
        <div className="rb-pick__search" style={{ position: "relative" }}>
          <Search
            size={14}
            aria-hidden
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--rb-ink-faint)",
              pointerEvents: "none",
            }}
          />
          <input
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search machines"
            aria-label="Search machines"
            style={{
              width: "100%",
              minHeight: "2.5rem",
              paddingLeft: "1.9rem",
              paddingRight: "0.6rem",
              borderRadius: "var(--rb-radius-sm)",
              border: "1px solid var(--rb-border-strong)",
              background: "var(--rb-surface)",
              color: "var(--rb-ink)",
              fontSize: "0.82rem",
            }}
          />
        </div>
      )}

      <div className="rb-pick__list">
        {total === 0 && (
          <p className="rb-note rb-note--muted" style={{ padding: "0.75rem 0.25rem" }}>
            No machine matches “{query}”.
          </p>
        )}

        {groups.map((g) => (
          <div className="rb-pick__group" key={`${g.category}-${g.label}`}>
            <div className="rb-pick__grouplabel">
              {g.label}
              {g.missing && (
                <span
                  className={`rb-tag ${g.foundational ? "rb-tag--gap" : "rb-tag--freq"}`}
                  style={{ marginLeft: "0.35rem" }}
                >
                  {g.foundational ? "missing" : "none yet"}
                </span>
              )}
            </div>

            {g.machines.map((m) => {
              const isIn = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className="rb-pick__item"
                  data-in={isIn}
                  onClick={() => (isIn ? onRemove?.(m.id) : onAdd(m.id))}
                  onMouseEnter={() => onPreview?.(m.id)}
                  onMouseLeave={() => onPreview?.(null)}
                  onFocus={() => onPreview?.(m.id)}
                  onBlur={() => onPreview?.(null)}
                  aria-pressed={isIn}
                >
                  {isIn ? (
                    <Check size={14} aria-hidden style={{ color: "var(--rb-ok)" }} />
                  ) : (
                    <Plus size={14} aria-hidden style={{ color: "var(--rb-live-text)" }} />
                  )}
                  <span className="rb-pick__name">{m.name}</span>
                  {MACHINE_ABBR[m.id] && (
                    <span
                      style={{
                        fontSize: "0.62rem",
                        fontWeight: 800,
                        color: "var(--rb-ink-faint)",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {MACHINE_ABBR[m.id]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
