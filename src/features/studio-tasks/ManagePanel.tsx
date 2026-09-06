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

import { useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  ClipboardList,
  Clock,
  MessageSquare,
  Plus,
} from "lucide-react";
import { formatStudioDate } from "../../lib/studio-time";
import { useToast } from "../../contexts/ToastContext";
import { useTaskCompliance } from "./useTaskCompliance";
import { useStudioRequests } from "./useStudioRequests";
import { newTemplateId, saveTaskTemplate, type TaskAuthor } from "./mutations";
import { categoryLabel } from "./types";
import type { StudioTaskCategory, TaskRow, TaskTemplate } from "./types";

/**
 * STARTER LISTS.
 *
 * Round: Sep 6 2026.
 *
 * The empty-list problem is not that authoring one task is hard - it is that
 * the first one requires a manager to answer six questions (kind, category,
 * recurrence, shift, target, note-required) before anything exists to look
 * at. So the four shapes a studio actually runs are one tap each, and land as
 * ordinary editable templates. Nothing here is a special kind of task; each
 * preset is just a filled-in draft of the same document the full form writes.
 *
 * They are DAILY and Anytime by default. A studio that wants closing-only
 * trash duty edits one field afterwards, which is a smaller ask than getting
 * the shift right before seeing the list exist at all.
 */
const STARTERS: {
  id: string;
  label: string;
  build: (studioId: string) => Omit<TaskTemplate, "id">;
}[] = [
  {
    id: "wipe-machines",
    label: "Wipe down every machine",
    build: (studioId) => ({
      studioId,
      scope: "studio",
      title: "Wipe down every machine",
      detail: "Pads, handles and any contact surface.",
      kind: "machine",
      category: "cleaning",
      target: { kind: "machine", machineIds: "all" },
      recurrence: { type: "daily", shifts: ["pm"] },
      active: true,
    }),
  },
  {
    id: "open-close",
    label: "Opening & closing duties",
    build: (studioId) => ({
      studioId,
      scope: "studio",
      title: "Opening and closing walk-through",
      detail: "Lights, music, front desk, restrooms, water.",
      kind: "facility",
      category: "ops",
      target: { kind: "facility" },
      // Both shifts, which generates a SEPARATE instance for each - closing is
      // not satisfied by having opened. See TaskShift in types.ts.
      recurrence: { type: "daily", shifts: ["am", "pm"] },
      active: true,
    }),
  },
  {
    id: "machine-check",
    label: "Weekly machine check",
    build: (studioId) => ({
      studioId,
      scope: "studio",
      title: "Weekly machine check",
      detail: "Cables, pins, pads, unusual noise. Flag anything off.",
      kind: "machine",
      category: "maintenance",
      target: { kind: "machine", machineIds: "all" },
      recurrence: { type: "weekly", daysOfWeek: [1], shifts: ["any"] },
      // Maintenance without a note is a tick box that proves nothing.
      requiresNote: true,
      active: true,
    }),
  },
  {
    id: "client-followups",
    label: "Client follow-ups",
    build: (studioId) => ({
      studioId,
      scope: "studio",
      title: "Client follow-ups",
      detail: "Anyone who missed last week, and any outstanding InBody scans.",
      kind: "client",
      category: "client-service",
      target: { kind: "client" },
      recurrence: { type: "weekly", daysOfWeek: [1], shifts: ["any"] },
      active: true,
    }),
  },
];

function ago(v: unknown): string {
  const ms = (v as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (!ms) return "just now";
  const hrs = Math.round((Date.now() - ms) / 3600000);
  if (hrs < 1) return "under an hour";
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(dateKey: string): string {
  return formatStudioDate(`${dateKey}T12:00:00`, { weekday: "narrow" });
}

export interface ManagePanelProps {
  studioId: string | null;
  templates: TaskTemplate[];
  categories?: StudioTaskCategory[];
  /** Today's flagged rows, already computed by the board. */
  flaggedRows: TaskRow[];
  author?: TaskAuthor | null;
  /** Opens the full form on a blank studio template. */
  onNewTask?: () => void;
  /** Opens the full form on an existing one. */
  onEditTask?: (template: TaskTemplate) => void;
}

export function ManagePanel({
  studioId,
  templates,
  categories,
  flaggedRows,
  author,
  onNewTask,
  onEditTask,
}: ManagePanelProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const { rows, dateKeys, loading } = useTaskCompliance(studioId, templates, 7);
  const { open: openRequests, expired } = useStudioRequests(studioId);
  const [busy, setBusy] = useState<string | null>(null);

  const studioTemplates = [...templates]
    .filter((t) => (t.scope ?? "studio") === "studio")
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.order ?? 999) - (b.order ?? 999) ||
        a.title.localeCompare(b.title),
    );

  const addStarter = async (starter: (typeof STARTERS)[number]) => {
    if (!studioId) return;
    setBusy(starter.id);
    try {
      const body = starter.build(studioId);
      await saveTaskTemplate({
        location: { scope: "studio", studioId },
        template: { ...body, id: newTemplateId(body.title) },
        author: author ?? null,
        isNew: true,
      });
      toastSuccess(`Added "${body.title}".`);
    } catch (err) {
      console.error("Starter task failed:", err);
      toastError("Could not add that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  // Oldest first here, unlike the board: an unanswered ask from Tuesday is the
  // one a manager needs to chase, not the one posted five minutes ago.
  const stale = [...openRequests].sort((a, b) => {
    const ms = (v: unknown) =>
      (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return ms(a.createdAt) - ms(b.createdAt);
  });

  return (
    <div className="stm">
      {/* FIRST, because this is the thing a manager came here to do. The
          authoring surface used to live only behind a dialog opened from the
          board's own header - the screen built for the opposite job, closing
          things off on the floor. Same documents, same dialog for the detail;
          it is simply reachable from where the decision is made. */}
      <section className="stm__panel">
        <header className="stm__head">
          <ClipboardList size={14} aria-hidden />
          <h2 className="stm__title">Studio task list</h2>
          <span className="stm__hint">
            {studioTemplates.length === 0
              ? "Nothing yet"
              : `${studioTemplates.filter((t) => t.active).length} active`}
          </span>
        </header>

        {studioTemplates.length === 0 ? (
          <p className="stm__empty">
            Nothing standing yet. These are the duties this studio is held to -
            cleaning, opening and closing, equipment checks, client follow-ups.
            Trainers see them on the board on the days they fall due, and tick
            them off there.
          </p>
        ) : (
          <ul className="stm__templates">
            {studioTemplates.map((t) => (
              <li
                key={t.id}
                className="stm__template"
                data-retired={!t.active || undefined}
              >
                <button
                  type="button"
                  className="stm__template-open"
                  onClick={() => onEditTask?.(t)}
                >
                  <span className="stm__item-title">{t.title}</span>
                  <span className="stm__item-sub">
                    {categoryLabel(t.category, categories)} ·{" "}
                    {t.recurrence.type === "weekly"
                      ? (t.recurrence.daysOfWeek ?? []).length === 0
                        ? "Every day"
                        : (t.recurrence.daysOfWeek ?? [])
                            .map((d) => DAY_NAMES[d])
                            .join(", ")
                      : t.recurrence.type === "monthly"
                        ? `Day ${t.recurrence.dayOfMonth} each month`
                        : t.recurrence.type === "once"
                          ? t.recurrence.onDate
                          : "Every day"}
                    {(t.recurrence.shifts ?? ["any"]).includes("am") &&
                      " · opening"}
                    {(t.recurrence.shifts ?? ["any"]).includes("pm") &&
                      " · closing"}
                    {!t.active && " · retired"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="stm__actions">
          <button
            type="button"
            className="stm__preset"
            onClick={() => onNewTask?.()}
            disabled={!studioId}
          >
            <Plus size={13} aria-hidden /> New studio task
          </button>
          {/* One tap each. Six questions before anything exists to look at is
              why an empty list stays empty. */}
          {STARTERS.filter(
            (st) => !studioTemplates.some((t) => t.id === st.id),
          ).map((st) => (
            <button
              key={st.id}
              type="button"
              className="stm__preset"
              onClick={() => void addStarter(st)}
              disabled={!studioId || busy !== null}
            >
              <Plus size={13} aria-hidden /> {st.label}
            </button>
          ))}
        </div>
      </section>

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

      {expired.length > 0 && (
        <section className="stm__panel">
          <header className="stm__head">
            <Clock size={14} aria-hidden />
            <h2 className="stm__title">Aged out</h2>
            <span className="stm__hint">Nobody got to these</span>
          </header>
          {/* Off the board, not out of the record. The difference between an
              ask that was answered and one that simply ran out of time is the
              only interesting thing when somebody asks why nobody covered
              Thursday, and it is invisible from the floor by design. */}
          <ul className="stm__list">
            {expired.map((r) => (
              <li key={r.id} className="stm__item">
                <span className="stm__item-title">{r.title}</span>
                <span className="stm__item-sub">
                  {r.createdBy.name} · posted {ago(r.createdAt)} ago ·{" "}
                  {r.claimedBy ? `${r.claimedBy.name} had it` : "never claimed"}
                  {r.replyCount > 0
                    ? ` · ${r.replyCount} replies`
                    : " · no replies"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
