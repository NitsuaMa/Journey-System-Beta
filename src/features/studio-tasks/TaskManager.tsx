import { useMemo, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "../../contexts/ToastContext";
import type { Client } from "../../types";
import { taskLocationOf, taskScopeOf } from "./types";
import type { TaskScope } from "./types";
import { useStudioMachines } from "../../hooks/useStudioMachines";
import { useStudioTaskCategories } from "./useStudioTaskCategories";
import {
  deleteTaskTemplate,
  newTemplateId,
  saveTaskTemplate,
  setTaskTemplateActive,
} from "./mutations";
import {
  categoryLabel,
  CLIENT_ACTION_LABEL,
  SHIFT_LABEL,
  TASK_SHIFTS,
  type ClientTaskAction,
  type TaskCategory,
  type TaskKind,
  type TaskShift,
  type TaskTemplate,
} from "./types";

/**
 * The manager's side of the to-do list.
 *
 * Round: Studio To-Do, Sep 2026.
 *
 * Deliberately a small, boring form. Everything here is a decision a studio
 * manager makes once and revisits rarely, so it optimises for being
 * unambiguous rather than for being fast — the opposite of the trainer screen.
 *
 * Retiring is the default; hard delete is behind a second tap and warns, since
 * completed instances reference the template and deleting it orphans the
 * history of every time the task was done.
 */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const KINDS: { value: TaskKind; label: string; category: TaskCategory }[] = [
  { value: "machine", label: "Machines", category: "cleaning" },
  { value: "facility", label: "Facility", category: "ops" },
  { value: "client", label: "With a client", category: "client-service" },
];

function blank(
  studioId: string,
  scope: TaskScope,
  ownerId: string | null,
): TaskTemplate {
  return {
    id: "",
    studioId,
    scope,
    ...(scope === "personal" && ownerId ? { ownerId } : {}),
    title: "",
    kind: "machine",
    category: "cleaning",
    target: { kind: "machine", machineIds: "all" },
    recurrence: { type: "daily", shifts: ["any"] },
    active: true,
  };
}

export interface TaskManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studioId: string | null;
  /** May this trainer author the SHARED studio list? Personal is always on. */
  canManageStudio: boolean;
  /** Firebase Auth uid — the path and the tenancy for personal tasks. */
  ownerId: string | null;
  templates: TaskTemplate[];
  author?: { id: string; name: string } | null;
  clients?: Client[];
}

export function TaskManager({
  open,
  onOpenChange,
  studioId,
  canManageStudio,
  ownerId,
  templates,
  author,
  clients,
}: TaskManagerProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  // Bridged for the same reason as useStudioTasks: an unbridged empty roster
  // renders this picker as a bordered box with nothing in it, which reads as
  // a broken button rather than as missing data.
  const { machines } = useStudioMachines(studioId, {
    bridgeWhenRosterEmpty: true,
  });
  // The studio's own labels, merged over the four built-ins. A studio that has
  // never opened a category editor still gets a sensible list rather than an
  // empty picker.
  const { categories } = useStudioTaskCategories(studioId);
  const [draft, setDraft] = useState<TaskTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A trainer without manage rights opens this dialog to write their OWN
  // list, so they must not be shown - or be able to open - the shared studio
  // templates. Filtering the list is the guard; the rules are the backstop.
  const visibleTemplates = useMemo(
    () =>
      canManageStudio
        ? templates
        : templates.filter((t) => taskScopeOf(t) === "personal"),
    [templates, canManageStudio],
  );

  const sorted = useMemo(
    () =>
      [...visibleTemplates].sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (a.order ?? 999) - (b.order ?? 999) ||
          a.title.localeCompare(b.title),
      ),
    [templates],
  );

  const set = <K extends keyof TaskTemplate>(k: K, v: TaskTemplate[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const startNew = (scope: TaskScope) => {
    if (!studioId) return;
    if (scope === "studio" && !canManageStudio) return;
    if (scope === "personal" && !ownerId) return;
    setDraft(blank(studioId, scope, ownerId));
    setIsNew(true);
    setConfirmDelete(false);
  };

  const startEdit = (t: TaskTemplate) => {
    setDraft({ ...t });
    setIsNew(false);
    setConfirmDelete(false);
  };

  const close = () => {
    setDraft(null);
    setConfirmDelete(false);
  };

  const save = async () => {
    if (!draft || !studioId) return;
    if (!draft.title.trim()) {
      toastError("Give the task a title.");
      return;
    }
    setBusy(true);
    try {
      const id = draft.id || newTemplateId(draft.title);
      await saveTaskTemplate({
        location: taskLocationOf(draft, studioId),
        template: { ...draft, id, order: draft.order ?? sorted.length + 1 },
        author: author ?? null,
        isNew,
      });
      toastSuccess(isNew ? "Task added." : "Task saved.");
      close();
    } catch (err) {
      console.error("Failed to save task template:", err);
      toastError("Could not save the task. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (t: TaskTemplate) => {
    if (!studioId) return;
    try {
      await setTaskTemplateActive({
        location: taskLocationOf(t, studioId),
        templateId: t.id,
        active: !t.active,
        author: author ?? null,
      });
      toastSuccess(t.active ? "Task retired." : "Task restored.");
    } catch {
      toastError("Could not change the task.");
    }
  };

  const hardDelete = async () => {
    if (!draft || !studioId || !draft.id) return;
    setBusy(true);
    try {
      await deleteTaskTemplate(taskLocationOf(draft, studioId), draft.id);
      toastSuccess("Task deleted.");
      close();
    } catch {
      toastError("Could not delete the task.");
    } finally {
      setBusy(false);
    }
  };

  const label = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";
  const input =
    "w-full rounded-lg border border-border bg-background p-2.5 text-sm min-h-11";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="st max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {draft && (
              <button
                type="button"
                className="st__row-action"
                onClick={close}
                aria-label="Back to the task list"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
            )}
            {draft
              ? isNew
                ? taskScopeOf(draft) === "personal"
                  ? "New personal task"
                  : "New studio task"
                : taskScopeOf(draft) === "personal"
                  ? "Edit personal task"
                  : "Edit studio task"
              : canManageStudio
                ? "Studio tasks"
                : "My tasks"}
          </DialogTitle>
        </DialogHeader>

        {!draft && (
          <div className="flex flex-col gap-2 p-1">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              These are the standing duties for this studio. Trainers see them
              on the To-Do screen on the days they are due.
            </p>

            {sorted.length === 0 && (
              <p className="rounded-lg border border-border p-4 text-center text-[12px] text-muted-foreground">
                No tasks yet.
              </p>
            )}

            {sorted.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border p-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => startEdit(t)}
                >
                  <span className="block truncate text-[13px] font-bold">
                    {t.title}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {categoryLabel(t.category, categories)} ·{" "}
                    {t.recurrence.type === "weekly"
                      ? (t.recurrence.daysOfWeek ?? []).length === 0
                        ? "Every day"
                        : (t.recurrence.daysOfWeek ?? [])
                            .map((d) => DAYS[d])
                            .join(", ")
                      : t.recurrence.type === "monthly"
                        ? `Day ${t.recurrence.dayOfMonth} each month`
                        : t.recurrence.type === "once"
                          ? t.recurrence.onDate
                          : "Every day"}
                    {!t.active && " · retired"}
                  </span>
                </button>
                <button
                  type="button"
                  className="st__btn st__btn--ghost"
                  onClick={() => toggleActive(t)}
                >
                  {t.active ? "Retire" : "Restore"}
                </button>
              </div>
            ))}

            {canManageStudio && (
              <button
                type="button"
                className="st__btn st__btn--primary mt-2 flex items-center justify-center gap-2"
                onClick={() => startNew("studio")}
                disabled={!studioId}
              >
                <Plus size={14} aria-hidden /> New studio task
              </button>
            )}
            <button
              type="button"
              className="st__btn mt-2 flex items-center justify-center gap-2"
              onClick={() => startNew("personal")}
              disabled={!studioId || !ownerId}
            >
              <Plus size={14} aria-hidden /> New personal task
            </button>
          </div>
        )}

        {draft && (
          <div className="flex flex-col gap-3 p-1">
            <label className="flex flex-col gap-1.5">
              <span className={label}>Title</span>
              <input
                className={input}
                value={draft.title}
                autoFocus
                onChange={(e) => set("title", e.target.value)}
                placeholder="Wipe down and sanitize"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={label}>Instructions (optional)</span>
              <textarea
                className={`${input} min-h-16 resize-y`}
                value={draft.detail ?? ""}
                onChange={(e) => set("detail", e.target.value)}
                placeholder="Pads, handles and any contact surface."
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className={label}>What is it about</span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    className="st__btn"
                    aria-pressed={draft.kind === k.value}
                    style={
                      draft.kind === k.value
                        ? {
                            background: "var(--st-live)",
                            color: "#fff",
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                    onClick={() =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              kind: k.value,
                              category: k.category,
                              target:
                                k.value === "machine"
                                  ? { kind: "machine", machineIds: "all" }
                                  : k.value === "facility"
                                    ? { kind: "facility" }
                                    : { kind: "client" },
                            }
                          : d,
                      )
                    }
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={label}>Category</span>
              <select
                className={input}
                value={draft.category}
                onChange={(e) =>
                  set("category", e.target.value as TaskCategory)
                }
              >
                {/* The studio's own list, not a hard-coded four. A studio
                    that renames Cleaning keeps the upkeep behaviour, because
                    the id is what carries upkeepRole — see types.ts. */}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {draft.target.kind === "machine" && (
              <div className="flex flex-col gap-1.5">
                <span className={label}>Which machines</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="st__btn"
                    style={
                      draft.target.machineIds === "all"
                        ? {
                            background: "var(--st-live)",
                            color: "#fff",
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                    onClick={() =>
                      set("target", { kind: "machine", machineIds: "all" })
                    }
                  >
                    Every machine
                  </button>
                  <button
                    type="button"
                    className="st__btn"
                    style={
                      draft.target.machineIds !== "all"
                        ? {
                            background: "var(--st-live)",
                            color: "#fff",
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                    onClick={() =>
                      set("target", { kind: "machine", machineIds: [] })
                    }
                  >
                    Choose
                  </button>
                </div>
                {draft.target.machineIds === "all" ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Equipment added later is included automatically — this is not
                    a snapshot of today's roster.
                  </p>
                ) : (
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
                    {machines.map((m) => {
                      const ids = draft.target.kind === "machine" &&
                        draft.target.machineIds !== "all"
                          ? draft.target.machineIds
                          : [];
                      const on = ids.includes(m.machineId);
                      return (
                        <button
                          key={m.machineId}
                          type="button"
                          className="st__btn"
                          aria-pressed={on}
                          style={
                            on
                              ? {
                                  background: "var(--st-live)",
                                  color: "#fff",
                                  borderColor: "transparent",
                                }
                              : undefined
                          }
                          onClick={() =>
                            set("target", {
                              kind: "machine",
                              machineIds: on
                                ? ids.filter((x) => x !== m.machineId)
                                : [...ids, m.machineId],
                            })
                          }
                        >
                          {m.name}
                        </button>
                      );
                    })}
                    {machines.length === 0 && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        No equipment is available for this studio yet, so there
                        is nothing to choose. Add this location’s machines in
                        Admin → Machines, or pick “Every machine” above.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {draft.target.kind === "client" && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className={label}>Which client</span>
                  <select
                    className={input}
                    value={draft.target.clientId ?? ""}
                    onChange={(e) =>
                      set("target", {
                        ...(draft.target as { kind: "client" }),
                        kind: "client",
                        clientId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Choose a client…</option>
                    {[...(clients ?? [])]
                      .sort((a, b) =>
                        `${a.lastName}${a.firstName}`.localeCompare(
                          `${b.lastName}${b.firstName}`,
                        ),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={label}>What opens when a trainer taps it</span>
                  <select
                    className={input}
                    value={draft.target.action ?? "custom"}
                    onChange={(e) =>
                      set("target", {
                        ...(draft.target as { kind: "client" }),
                        kind: "client",
                        action: e.target.value as ClientTaskAction,
                      })
                    }
                  >
                    {(
                      Object.keys(CLIENT_ACTION_LABEL) as ClientTaskAction[]
                    ).map((a) => (
                      <option key={a} value={a}>
                        {CLIENT_ACTION_LABEL[a]}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] leading-relaxed text-muted-foreground">
                    The task opens that screen for this client rather than being
                    a tick that claims the work happened.
                  </span>
                </label>
              </>
            )}

            <label className="flex flex-col gap-1.5">
              <span className={label}>How often</span>
              <select
                className={input}
                value={draft.recurrence.type}
                onChange={(e) =>
                  set("recurrence", {
                    ...draft.recurrence,
                    type: e.target.value as TaskTemplate["recurrence"]["type"],
                  })
                }
              >
                <option value="daily">Every day</option>
                <option value="weekly">Certain days of the week</option>
                <option value="monthly">Once a month</option>
                <option value="once">One time only</option>
              </select>
            </label>

            {draft.recurrence.type === "weekly" && (
              <div className="flex flex-col gap-1.5">
                <span className={label}>Which days</span>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const days = draft.recurrence.daysOfWeek ?? [];
                    const on = days.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        className="st__btn"
                        aria-pressed={on}
                        style={
                          on
                            ? {
                                background: "var(--st-live)",
                                color: "#fff",
                                borderColor: "transparent",
                              }
                            : undefined
                        }
                        onClick={() =>
                          set("recurrence", {
                            ...draft.recurrence,
                            daysOfWeek: on
                              ? days.filter((x) => x !== i)
                              : [...days, i].sort(),
                          })
                        }
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                {(draft.recurrence.daysOfWeek ?? []).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No days picked — this will run every day until you choose
                    some.
                  </p>
                )}
              </div>
            )}

            {draft.recurrence.type === "monthly" && (
              <label className="flex flex-col gap-1.5">
                <span className={label}>Day of the month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className={input}
                  value={draft.recurrence.dayOfMonth ?? 1}
                  onChange={(e) =>
                    set("recurrence", {
                      ...draft.recurrence,
                      dayOfMonth: Number(e.target.value),
                    })
                  }
                />
                {(draft.recurrence.dayOfMonth ?? 1) > 28 && (
                  <p className="text-[11px] text-muted-foreground">
                    Months without this day are skipped rather than moved, so a
                    service check never slides to the wrong week.
                  </p>
                )}
              </label>
            )}

            {draft.recurrence.type === "once" && (
              <label className="flex flex-col gap-1.5">
                <span className={label}>Date</span>
                <input
                  type="date"
                  className={input}
                  value={draft.recurrence.onDate ?? ""}
                  onChange={(e) =>
                    set("recurrence", {
                      ...draft.recurrence,
                      onDate: e.target.value,
                    })
                  }
                />
              </label>
            )}

            <div className="flex flex-col gap-1.5">
              <span className={label}>When in the day</span>
              <div className="flex flex-wrap gap-1.5">
                {TASK_SHIFTS.map((sft: TaskShift) => {
                  const shifts = draft.recurrence.shifts ?? ["any"];
                  const on = shifts.includes(sft);
                  return (
                    <button
                      key={sft}
                      type="button"
                      className="st__btn"
                      aria-pressed={on}
                      style={
                        on
                          ? {
                              background: "var(--st-live)",
                              color: "#fff",
                              borderColor: "transparent",
                            }
                          : undefined
                      }
                      onClick={() => {
                        // 'any' is exclusive: a task is either an all-day task
                        // or it belongs to specific shifts.
                        const next =
                          sft === "any"
                            ? ["any" as TaskShift]
                            : (on
                                ? shifts.filter((x) => x !== sft)
                                : [...shifts.filter((x) => x !== "any"), sft]
                              ).filter(Boolean);
                        set("recurrence", {
                          ...draft.recurrence,
                          shifts: next.length ? next : ["any"],
                        });
                      }}
                    >
                      {SHIFT_LABEL[sft]}
                    </button>
                  );
                })}
              </div>
              {(draft.recurrence.shifts ?? []).length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Opening and closing are separate tasks — closing is not
                  satisfied by having opened.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={Boolean(draft.requiresNote)}
                onChange={(e) => set("requiresNote", e.target.checked)}
              />
              <span className="text-[12px] leading-relaxed">
                <strong>Require a note to complete.</strong>
                <span className="block text-muted-foreground">
                  For inspections, where "done" without a finding is not an
                  answer.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={
                  draft.notifyCreatorOnComplete ??
                  draft.recurrence.type === "once"
                }
                onChange={(e) =>
                  set("notifyCreatorOnComplete", e.target.checked)
                }
              />
              <span className="text-[12px] leading-relaxed">
                <strong>Tell me when someone finishes this.</strong>
                <span className="block text-muted-foreground">
                  In-app only — nothing is emailed or texted. Off by default
                  for repeating tasks: forty cleaning receipts a day is how a
                  studio learns to ignore the bell.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {!isNew && (
                <button
                  type="button"
                  className="st__btn st__btn--ghost mr-auto flex items-center gap-1.5"
                  onClick={() =>
                    confirmDelete ? hardDelete() : setConfirmDelete(true)
                  }
                  disabled={busy}
                  style={confirmDelete ? { color: "var(--st-flag)" } : undefined}
                >
                  <Trash2 size={14} aria-hidden />
                  {confirmDelete ? "Delete permanently?" : "Delete"}
                </button>
              )}
              <button type="button" className="st__btn" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="st__btn st__btn--primary"
                onClick={save}
                disabled={busy}
              >
                {busy ? "Saving…" : "Save task"}
              </button>
            </div>

            {confirmDelete && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Completed instances reference this task; deleting it orphans the
                record of every time it was done. Retiring keeps the history and
                stops it appearing.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
