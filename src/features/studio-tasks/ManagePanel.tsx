/**
 * The manager's view of the same data.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * The brief called out studio managers "who manage administration without
 * actively training clients". For them, a board filtered to "today at this
 * studio" is the wrong default: they think in weeks and in people, not in
 * shifts. But they do not need a second feature — they need the same
 * documents answering a different question.
 *
 * So: no new data model, no second board. A toggle, and three panels that ask
 * things the daily list cannot answer.
 *
 *   Compliance    is closing actually getting done on Sundays?
 *   Requests      what has been floating unanswered the longest?
 *   Flagged       which machines are broken and who said so?
 *
 * Sorted worst-first throughout. The value of a review panel is finding what
 * slipped, and a manager should not have to scan a wall of green to find it.
 */

import { AlertTriangle, CalendarCheck, MessageSquare } from "lucide-react";
import { formatStudioDate } from "../../lib/studio-time";
import { useTaskCompliance } from "./useTaskCompliance";
import { useStudioRequests } from "./useStudioRequests";
import { categoryLabel } from "./types";
import type { StudioTaskCategory, TaskRow, TaskTemplate } from "./types";

function ago(v: unknown): string {
  const ms = (v as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (!ms) return "just now";
  const hrs = Math.round((Date.now() - ms) / 3600000);
  if (hrs < 1) return "under an hour";
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function dayLabel(dateKey: string): string {
  return formatStudioDate(`${dateKey}T12:00:00`, { weekday: "narrow" });
}

export interface ManagePanelProps {
  studioId: string | null;
  templates: TaskTemplate[];
  categories?: StudioTaskCategory[];
  /** Today's flagged rows, already computed by the board. */
  flaggedRows: TaskRow[];
}

export function ManagePanel({
  studioId,
  templates,
  categories,
  flaggedRows,
}: ManagePanelProps) {
  const { rows, dateKeys, loading } = useTaskCompliance(studioId, templates, 7);
  const { open: openRequests } = useStudioRequests(studioId);

  // Oldest first here, unlike the board: an unanswered ask from Tuesday is the
  // one a manager needs to chase, not the one posted five minutes ago.
  const stale = [...openRequests].sort((a, b) => {
    const ms = (v: unknown) =>
      (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return ms(a.createdAt) - ms(b.createdAt);
  });

  return (
    <div className="stm">
      <section className="stm__panel">
        <header className="stm__head">
          <CalendarCheck size={14} aria-hidden />
          <h2 className="stm__title">Last 7 days</h2>
          <span className="stm__hint">Worst first</span>
        </header>

        {loading && rows.length === 0 ? (
          <p className="stm__empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="stm__empty">
            No studio templates yet. Add some from Manage to start tracking
            whether they get done.
          </p>
        ) : (
          <div className="stm__scroll">
            <table className="stm__grid">
              <thead>
                <tr>
                  <th scope="col" className="stm__grid-name">
                    Task
                  </th>
                  {dateKeys.map((d) => (
                    <th key={d} scope="col" title={d}>
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th scope="col">Rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.template.id}>
                    <th scope="row" className="stm__grid-name">
                      <span className="stm__grid-title">{r.template.title}</span>
                      <span className="stm__grid-sub">
                        {categoryLabel(r.template.category, categories)}
                      </span>
                    </th>
                    {r.cells.map((c) => {
                      const state =
                        c.planned === 0
                          ? "none"
                          : c.flagged > 0
                            ? "flag"
                            : c.done === c.planned
                              ? "done"
                              : c.done === 0
                                ? "miss"
                                : "part";
                      return (
                        <td key={c.dateKey}>
                          <span
                            className="stm__cell"
                            data-state={state}
                            title={
                              c.planned === 0
                                ? "Not due"
                                : `${c.done} of ${c.planned} done${
                                    c.flagged ? `, ${c.flagged} flagged` : ""
                                  }`
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="stm__rate">
                      {r.dueDays === 0
                        ? "—"
                        : `${Math.round((r.doneDays / r.dueDays) * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stm__panel">
        <header className="stm__head">
          <MessageSquare size={14} aria-hidden />
          <h2 className="stm__title">Unanswered requests</h2>
          <span className="stm__hint">Oldest first</span>
        </header>
        {stale.length === 0 ? (
          <p className="stm__empty">Nothing outstanding.</p>
        ) : (
          <ul className="stm__list">
            {stale.map((r) => (
              <li key={r.id} className="stm__item">
                <span className="stm__item-title">{r.title}</span>
                <span className="stm__item-sub">
                  {r.createdBy.name} · {ago(r.createdAt)} old ·{" "}
                  {r.claimedBy ? `${r.claimedBy.name} has it` : "unclaimed"}
                  {r.replyCount > 0 ? ` · ${r.replyCount} replies` : " · no replies"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stm__panel">
        <header className="stm__head">
          <AlertTriangle size={14} aria-hidden />
          <h2 className="stm__title">Flagged machines</h2>
        </header>
        {flaggedRows.length === 0 ? (
          <p className="stm__empty">Nothing flagged today.</p>
        ) : (
          <ul className="stm__list">
            {flaggedRows.map((r) => (
              <li key={r.id} className="stm__item">
                <span className="stm__item-title">
                  {r.machineName ?? r.title}
                </span>
                <span className="stm__item-sub">
                  {r.instance?.note || "A trainer reported a problem."}
                  {r.instance?.completedBy?.name
                    ? ` — ${r.instance.completedBy.name}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
