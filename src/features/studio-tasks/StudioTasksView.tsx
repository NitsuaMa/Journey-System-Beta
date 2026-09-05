import { useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Sparkles,
  Settings2,
  Minus,
  ExternalLink,
  MessageSquarePlus,
  TriangleAlert,
} from "lucide-react";
import type { Client, Trainer } from "../../types";
import { useActiveStudio } from "../../ActiveStudioContext";
import { useToast } from "../../contexts/ToastContext";
import { formatStudioDate, studioDateKey } from "../../lib/studio-time";
import { setManyTaskStatuses, setTaskClaim, setTaskStatus } from "./mutations";
import { taskLocationOf, taskScopeOf } from "./types";
import type { TaskLocation } from "./types";
import { auth } from "../../firebase";
import { TaskManager } from "./TaskManager";
import { TaskNoteDialog } from "./TaskNoteDialog";
import { useStudioTasks } from "./useStudioTasks";
import { RequestsLane } from "./RequestsLane";
import { notifyTaskCompletion } from "./notify";
import {
  SHIFT_LABEL,
  type ClientTaskAction,
  type TaskRow,
  type TaskShift,
} from "./types";

/**
 * THE STUDIO TO-DO.
 *
 * Round: Studio To-Do, Sep 2026.
 *
 * Grouped by TEMPLATE, not flattened. "Wipe down every machine" across a
 * 22-machine roster is 22 rows; as a flat list it buries the four facility
 * tasks that also have to happen, and gives no way to close the whole set at
 * once. As a card with its own count and its own "mark all", it is one line of
 * scanning and one tap.
 *
 * Multi-select is deliberately secondary. The common case at close is "all of
 * them", so that is a single always-visible button; selecting a subset is for
 * the case where three machines are still in use.
 */
export interface StudioTasksViewProps {
  authTrainer?: Trainer | null;
  /** For naming client tasks and opening them. */
  clients?: Client[];
  /**
   * Open the real flow a client task refers to.
   *
   * A client task is not a checkbox that claims an InBody scan happened — it
   * is a pointer at the screen where the work is actually done. Ticking it is
   * still possible (someone has to close the loop), but the primary action is
   * to go and do the thing.
   */
  onOpenClientTask?: (clientId: string, action?: ClientTaskAction) => void;
}

type ShiftFilter = TaskShift | "all";

export function StudioTasksView({
  authTrainer,
  clients,
  onOpenClientTask,
}: StudioTasksViewProps) {
  const { activeStudioId, activeStudio, hasPermission } = useActiveStudio();
  const { success: toastSuccess, error: toastError } = useToast();

  const clientNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients ?? []) {
      if (c.id) map[c.id] = `${c.firstName} ${c.lastName}`.trim();
    }
    return map;
  }, [clients]);

  // The Firebase Auth uid, NOT authTrainer.id: personal tasks live at
  // trainers/{uid}/task* and the rule is request.auth.uid == trainerId. The
  // two ids coincide for trainers created through Auth but not for every
  // older document, and getting it wrong here means a silent permission
  // denial on somebody else's account.
  const ownerId = auth.currentUser?.uid ?? null;

  const { rows, templates, dateKey, loading, counts, machineCount } =
    useStudioTasks(activeStudioId, { ownerId, clientNames });

  /**
   * A selection can span both tiers, and they are different collections, so
   * one batch cannot cover both. Group by where each row actually lives and
   * write each group. Returns the total written so callers can report it.
   */
  const writeMany = async (
    chosen: TaskRow[],
    status: "done" | "open",
  ): Promise<number> => {
    const groups = new Map<
      string,
      { location: TaskLocation; planned: TaskRow[] }
    >();
    for (const r of chosen) {
      const location = taskLocationOf(r.template ?? {}, activeStudioId!);
      const key =
        location.scope === "personal" ? `personal:${location.ownerId}` : "studio";
      const g = groups.get(key) ?? { location, planned: [] };
      g.planned.push(r);
      groups.set(key, g);
    }
    let written = 0;
    for (const g of groups.values()) {
      written += await setManyTaskStatuses({
        location: g.location,
        planned: g.planned,
        status,
        author,
      });
    }
    return written;
  };
  const [filter, setFilter] = useState<ShiftFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteRow, setNoteRow] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);

  // Authoring the list sets the standard the floor is held to. Completing a
  // task is not gated — any trainer closes one, which is the whole screen.
  const canManage = hasPermission("manage_studio_tasks", {
    studioId: activeStudioId ?? undefined,
  });

  const author = authTrainer?.id
    ? { id: authTrainer.id, name: authTrainer.fullName ?? "" }
    : null;

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.shift === filter)),
    [rows, filter],
  );

  /** Template + shift, so opening and closing stay separate cards. */
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; rows: TaskRow[] }>();
    for (const r of visible) {
      const key = `${r.templateId}__${r.shift}`;
      const g = map.get(key);
      if (g) g.rows.push(r);
      else map.set(key, { key, rows: [r] });
    }
    return [...map.values()];
  }, [visible]);

  const flaggedRows = useMemo(
    () => rows.filter((r) => r.instance?.flagged),
    [rows],
  );

  const shiftsPresent = useMemo(() => {
    const s = new Set(rows.map((r) => r.shift));
    return (["am", "any", "pm"] as TaskShift[]).filter((x) => s.has(x));
  }, [rows]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!activeStudioId) {
      toastError("No active studio selected.");
      return;
    }
    setBusy(true);
    try {
      await fn();
      toastSuccess(ok);
    } catch (err) {
      console.error("Studio task write failed:", err);
      toastError("Could not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleClaim = async (row: TaskRow) => {
    const mine = row.instance?.claimedBy?.id === author?.id;
    await run(
      () =>
        setTaskClaim({
          location: taskLocationOf(row.template ?? {}, activeStudioId!),
          planned: row,
          author,
          claimed: !mine,
        }),
      mine ? "Handed back." : "You've got it.",
    );
  };

  const toggleRow = async (row: TaskRow) => {
    // A task that must carry a note goes through the dialog rather than
    // silently completing without one.
    if (row.status !== "done" && row.template?.requiresNote) {
      setNoteRow(row);
      return;
    }
    const next = row.status === "done" ? "open" : "done";
    await run(
      async () => {
        await setTaskStatus({
          location: taskLocationOf(row.template ?? {}, activeStudioId!),
          planned: row,
          status: next,
          author,
        });
        // Only on completion, and notify() decides whether anyone actually
        // hears about it — see notify.ts for the four filters that keep this
        // from becoming 40 receipts a day.
        if (next === "done") {
          await notifyTaskCompletion({ row, author, studioId: activeStudioId });
        }
      },
      next === "done" ? "Marked done." : "Re-opened.",
    );
  };

  const markGroup = async (groupRows: TaskRow[]) => {
    const pending = groupRows.filter((r) => r.status !== "done");
    if (pending.length === 0) return;
    await run(
      () =>
        writeMany(pending, "done"),
      `Marked ${pending.length} done.`,
    );
  };

  const markSelected = async (status: "done" | "open") => {
    const chosen = rows.filter(
      (r) => selected.has(r.id) && r.status !== status,
    );
    if (chosen.length === 0) {
      setSelected(new Set());
      return;
    }
    await run(
      () =>
        writeMany(chosen, status),
      `${status === "done" ? "Marked" : "Re-opened"} ${chosen.length}.`,
    );
    setSelected(new Set());
  };

  const submitNote = async (note: string, flagged: boolean) => {
    if (!noteRow) return;
    await run(
      async () => {
        await setTaskStatus({
          location: taskLocationOf(noteRow.template ?? {}, activeStudioId!),
          planned: noteRow,
          status: "done",
          author,
          note,
          flagged,
        });
        // A flagged machine always travels, opt-in or not.
        await notifyTaskCompletion({
          row: noteRow,
          author,
          studioId: activeStudioId,
          flagged,
          note,
        });
      },
      flagged ? "Flagged and marked done." : "Marked done.",
    );
  };

  const pct = counts.total === 0 ? 0 : (counts.done / counts.total) * 100;
  const allPending = rows.filter((r) => r.status !== "done");

  return (
    <div className="st">
      <div className="st__scroll">
        <header className="st__head">
          <div>
            <h1 className="st__title">Studio to-do</h1>
            <span className="st__date">
              {activeStudio?.name ?? "Studio"} ·{" "}
              {dateKey === studioDateKey(new Date()) ? "Today · " : ""}
              {formatStudioDate(
                dateKey ? `${dateKey}T12:00:00` : new Date(),
                { weekday: "short", month: "short", day: "numeric" },
              )}
            </span>
          </div>

          {shiftsPresent.length > 1 && (
            <div className="st__filters" role="group" aria-label="Filter by shift">
              <button
                type="button"
                className="st__filter"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {shiftsPresent.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="st__filter"
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                >
                  {SHIFT_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          {/* Open to everyone now: a manager authors the studio list here, and
              a trainer authors their own. What each may create is decided
              inside the dialog, not by hiding the button. */}
          <button
            type="button"
            className="st__btn"
            onClick={() => setManaging(true)}
          >
            <Settings2 size={14} aria-hidden className="inline align-middle" />{" "}
            {canManage ? "Manage" : "My tasks"}
          </button>

          <div className="st__progress">
            <span className="st__progress-text">
              {counts.done} / {counts.total}
            </span>
            <span
              className="st__bar"
              role="progressbar"
              aria-valuenow={counts.done}
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-label="Tasks completed"
            >
              <span className="st__bar-fill" style={{ width: `${pct}%` }} />
            </span>
          </div>
        </header>

        {flaggedRows.length > 0 && (
          <div className="st__banner">
            <TriangleAlert size={15} aria-hidden className="shrink-0" />
            <span>
              <strong>
                {flaggedRows.length} machine
                {flaggedRows.length === 1 ? "" : "s"} flagged.
              </strong>{" "}
              {flaggedRows
                .map((r) => r.machineName ?? r.title)
                .slice(0, 4)
                .join(", ")}
              {flaggedRows.length > 4 ? ", …" : ""}
            </span>
          </div>
        )}

        {/* Above the checklist on purpose: a cover request is time-sensitive
            in a way that "take out the trash" is not, and interleaving the two
            by timestamp is exactly how "can anyone take my 5pm?" gets missed
            and how staff go back to texting each other. */}
        <RequestsLane
          studioId={activeStudioId}
          author={author}
          currentUserId={ownerId}
        />

        {loading && rows.length === 0 && (
          <p className="st__empty">
            <span className="st__empty-title">Loading…</span>
          </p>
        )}

        {!loading && rows.length === 0 && (
          <div className="st__empty">
            <ClipboardList
              size={28}
              aria-hidden
              className="mx-auto mb-3 opacity-40"
            />
            {/* Three different silences, and they used to read identically.
                Saved-but-nothing-due is normal; saved-but-no-equipment is a
                setup gap that used to look exactly like "the task did not
                save". (Sep 5 2026.) */}
            <p className="st__empty-title">
              {activeStudioId && templates.length > 0 && machineCount === 0
                ? "No equipment for this studio"
                : "Nothing scheduled today"}
            </p>
            <p className="st__empty-body">
              {!activeStudioId
                ? "Select a studio to see its checklist."
                : templates.length > 0 && machineCount === 0
                  ? "This studio has saved tasks, but no machines are available to attach them to, so anything targeting equipment produces no rows. Add this location’s machines in Admin → Machines."
                  : templates.length > 0
                    ? "There are saved tasks, but none of them fall due today."
                    : canManage
                      ? "Add cleaning, maintenance and opening/closing duties with Manage, and they will appear here on the days they are due."
                      : "A studio manager can add cleaning, maintenance and opening/closing duties, and they will appear here on the days they are due."}
            </p>
          </div>
        )}

        {groups.map((group) => {
          const first = group.rows[0];
          const done = group.rows.filter((r) => r.status === "done").length;
          const isMulti = group.rows.length > 1;
          const complete = done === group.rows.length;

          return (
            <section
              className={`st__group${isMulti ? "" : " st__group--single"}`}
              key={group.key}
            >
              <div className="st__group-head">
                <div className="st__group-text">
                  <span className="st__group-title">{first.title}</span>
                  <span className="st__group-meta">
                    {taskScopeOf(first.template ?? {}) === "personal" && (
                      <span
                        className="st__chip"
                        style={{
                          background: "var(--st-live)",
                          color: "#fff",
                          borderColor: "transparent",
                        }}
                      >
                        Mine
                      </span>
                    )}{" "}
                    {first.shift !== "any" && (
                      <span className="st__chip st__chip--shift">
                        {SHIFT_LABEL[first.shift]}
                      </span>
                    )}{" "}
                    {isMulti ? `${done} of ${group.rows.length} · ` : ""}
                    {first.category}
                  </span>
                  {first.template?.detail && (
                    <p className="st__group-detail">{first.template.detail}</p>
                  )}
                </div>

                {isMulti && (
                  <button
                    type="button"
                    className="st__btn st__btn--primary"
                    onClick={() => markGroup(group.rows)}
                    disabled={busy || complete}
                  >
                    {complete ? "All done" : "Mark all"}
                  </button>
                )}
              </div>

              <div className="st__rows">
                {group.rows.map((row) => (
                  /* A div, not a button. The note control is interactive and
                     nesting a button inside a button is invalid HTML — the
                     inner one becomes unreachable by keyboard. */
                  <div
                    key={row.id}
                    className="st__row"
                    data-status={row.status}
                    data-selected={selected.has(row.id) ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className="st__row-main"
                      onClick={() => toggleRow(row)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        toggleSelect(row.id);
                      }}
                      disabled={busy}
                      aria-pressed={row.status === "done"}
                    >
                      <span className="st__box" aria-hidden>
                        {row.status === "done" ? (
                          <Check size={16} strokeWidth={3} />
                        ) : row.status === "skipped" ? (
                          <Minus size={16} strokeWidth={3} />
                        ) : null}
                      </span>

                      <span className="st__row-text">
                        <span className="st__row-name">
                          {row.machineName ??
                            (row.clientName
                              ? `${row.title} — ${row.clientName}`
                              : row.title)}
                        </span>
                        <span className="st__row-sub">
                          {[
                            row.instance?.completedBy?.name
                              ? `Done by ${row.instance.completedBy.name}`
                              : row.instance?.claimedBy?.name
                                ? `${row.instance.claimedBy.name} has this`
                                : row.template?.requiresNote
                                  ? "Note required"
                                  : null,
                            row.shift !== "any" ? SHIFT_LABEL[row.shift] : null,
                            row.category,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {!isMulti && row.template?.detail && (
                          <span className="st__row-note">
                            {row.template.detail}
                          </span>
                        )}
                        {row.instance?.note && (
                          <span className="st__row-note">
                            {row.instance.flagged && (
                              <span className="st__chip st__chip--flag">
                                Flagged
                              </span>
                            )}{" "}
                            {row.instance.note}
                          </span>
                        )}
                      </span>
                    </button>

                    {/* Advisory: the tick box beside it stays live for
                        everyone. A hard lock would mean a trainer claims the
                        trash at 9am, gets pulled into a consultation, and the
                        bin stays full because the app said it was handled. */}
                    {row.status !== "done" && (
                      <button
                        type="button"
                        className="st__claim"
                        onClick={() => toggleClaim(row)}
                        disabled={busy}
                        aria-pressed={
                          row.instance?.claimedBy?.id === author?.id
                        }
                        title={
                          row.instance?.claimedBy
                            ? `${row.instance.claimedBy.name} has this`
                            : "Let the studio know you're on it"
                        }
                      >
                        <Sparkles
                          size={12}
                          aria-hidden
                          className="inline align-middle"
                        />{" "}
                        {row.instance?.claimedBy
                          ? row.instance.claimedBy.id === author?.id
                            ? "Yours"
                            : row.instance.claimedBy.name.split(" ")[0]
                          : "Claim"}
                      </button>
                    )}

                    {row.kind === "client" &&
                      onOpenClientTask &&
                      row.template?.target.kind === "client" &&
                      row.template.target.clientId && (
                        <button
                          type="button"
                          className="st__btn"
                          onClick={() => {
                            const t = row.template.target as {
                              clientId?: string;
                              action?: ClientTaskAction;
                            };
                            if (t.clientId) {
                              onOpenClientTask(t.clientId, t.action);
                            }
                          }}
                        >
                          <ExternalLink
                            size={12}
                            aria-hidden
                            className="inline align-middle"
                          />{" "}
                          Open
                        </button>
                      )}

                    <button
                      type="button"
                      className="st__row-action"
                      aria-label={`Add a note to ${row.machineName ?? row.title}`}
                      onClick={() => setNoteRow(row)}
                      disabled={busy}
                    >
                      <MessageSquarePlus size={16} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {rows.length > 0 && (
          <div className="st__selection">
            {selected.size > 0 ? (
              <>
                <span className="st__selection-count">
                  {selected.size} selected
                </span>
                <button
                  type="button"
                  className="st__btn st__btn--ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="st__btn"
                  onClick={() => markSelected("open")}
                  disabled={busy}
                >
                  Re-open
                </button>
                <button
                  type="button"
                  className="st__btn st__btn--done"
                  onClick={() => markSelected("done")}
                  disabled={busy}
                >
                  Mark done
                </button>
              </>
            ) : (
              <>
                <span className="st__selection-count">
                  {allPending.length === 0
                    ? "Everything done"
                    : `${allPending.length} outstanding`}
                </span>
                <button
                  type="button"
                  className="st__btn st__btn--done"
                  onClick={() =>
                    run(
                      () =>
                        writeMany(allPending, "done"),
                      `Marked ${allPending.length} done.`,
                    )
                  }
                  disabled={busy || allPending.length === 0}
                >
                  Mark everything done
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {(
        <TaskManager
          open={managing}
          onOpenChange={setManaging}
          studioId={activeStudioId}
          canManageStudio={canManage}
          ownerId={ownerId}
          templates={templates}
          author={author}
          clients={clients}
        />
      )}

      <TaskNoteDialog
        row={noteRow}
        open={Boolean(noteRow)}
        onOpenChange={(o) => !o && setNoteRow(null)}
        onSubmit={submitNote}
      />
    </div>
  );
}
