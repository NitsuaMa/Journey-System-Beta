/**
 * STUDIO TASKS — cleaning, maintenance and floor operations.
 *
 * Round: Studio To-Do, Sep 2026.
 *
 * TEMPLATES AND INSTANCES, NOT A `done` FLAG
 * ------------------------------------------
 * The obvious model is one document per task with a checkbox on it. It does not
 * survive contact with the requirement, because the list has to RESET — nightly,
 * on certain weekdays, or per AM/PM shift. Under a single document, "reset on
 * Mondays" is a destructive write that erases who did what, and there is no way
 * to answer "was the leg press wiped down last Tuesday".
 *
 * So: a template says what should happen and how often; an instance is one
 * occurrence of it on one studio day. Templates are edited by managers and
 * rarely change. Instances are created for a day, checked off by trainers, and
 * kept.
 *
 * THE DETERMINISTIC ID IS THE IMPORTANT PART
 * ------------------------------------------
 * An instance's document id is derived entirely from (template, date, shift,
 * machine) — see instanceId() in recurrence.ts. That makes materialization
 * IDEMPOTENT: the first trainer to open the list on a given day writes the
 * day's instances with setDoc(merge), and every subsequent open is a no-op that
 * cannot duplicate them, even if three trainers open the screen at the same
 * second on three iPads.
 *
 * Which means this ships with NO Cloud Function. A scheduled function can be
 * added later to pre-materialize so the list is warm at open; it will write the
 * same ids and collide with nothing.
 *
 * localDate IS STUDIO-LOCAL
 * -------------------------
 * Always computed with lib/studio-time, never from the device clock. A trainer
 * whose iPad is in another timezone would otherwise mint a second day's worth of
 * instances just after midnight, and the list would appear to reset at random.
 */

/**
 * Which half of the day a task belongs to.
 *
 * 'any' is not "unknown" — it means the task stands for the whole day and is
 * done once, whenever. Opening and closing duties are 'am' and 'pm', and a
 * template set to those generates a SEPARATE instance for each, which is the
 * point: closing is not satisfied by having opened.
 */
export type TaskShift = "am" | "pm" | "any";

export const TASK_SHIFTS: TaskShift[] = ["am", "pm", "any"];

export const SHIFT_LABEL: Record<TaskShift, string> = {
  am: "Opening",
  pm: "Closing",
  any: "Anytime",
};

export type TaskKind = "machine" | "facility" | "client";

/**
 * A category id. FREE-FORM as of Sep 2026 — the four below are seeds, not a
 * whitelist.
 *
 * Studios do not agree on what their work is called. One manager thinks in
 * "front desk" and "outreach", another in "opening" and "closing", and a
 * closed union means every one of them files a request to add a word. So a
 * studio authors its own categories in studios/{id}/taskCategories, and this
 * type is a string.
 *
 * THE CATCH, WHICH IS THE REASON upkeepRole EXISTS
 * ------------------------------------------------
 * useMachineUpkeep answers "when was this machine last cleaned / serviced" by
 * matching category === "cleaning" | "maintenance". Opening the union without
 * anything else would mean the first manager who renames Cleaning to
 * "Wipe-down" silently empties the Last cleaned row on every machine in the
 * Catalog — a bug that would take a long time to trace back to a settings
 * screen. A studio category therefore declares which upkeep question it
 * answers, and the four built-in ids keep mapping to themselves.
 */
export type TaskCategory = string;

/** The upkeep question a category answers, if any. */
export type UpkeepRole = "cleaning" | "maintenance";

/** studios/{studioId}/taskCategories/{categoryId} */
export interface StudioTaskCategory {
  id: string;
  label: string;
  /** A brand palette token name, not a raw hex. */
  color?: string;
  order?: number;
  /** Makes a renamed category still feed the Catalog's upkeep rows. */
  upkeepRole?: UpkeepRole;
  createdAt?: unknown;
  createdBy?: string;
}

/** Seeded into every studio; a studio may add to these or ignore them. */
export const BUILT_IN_CATEGORIES: StudioTaskCategory[] = [
  { id: "cleaning", label: "Cleaning", upkeepRole: "cleaning", order: 0 },
  { id: "maintenance", label: "Maintenance", upkeepRole: "maintenance", order: 1 },
  { id: "ops", label: "Operations", order: 2 },
  { id: "client-service", label: "Client service", order: 3 },
];

export const CATEGORY_LABEL: Record<string, string> = {
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  ops: "Operations",
  "client-service": "Client service",
};

/**
 * Display label for any category id, built-in or studio-authored.
 *
 * Falls back to a title-cased id rather than to "Unknown": a category whose
 * document was deleted still has instances referencing it, and "Front Desk"
 * read off the id is far more useful on a completed task than a blank.
 */
export function categoryLabel(
  id: string,
  studioCategories?: StudioTaskCategory[],
): string {
  const authored = studioCategories?.find((c) => c.id === id);
  if (authored?.label) return authored.label;
  if (CATEGORY_LABEL[id]) return CATEGORY_LABEL[id];
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Which upkeep question a category answers.
 *
 * The built-in ids answer for themselves so studios that never touch
 * categories keep working with no document at all.
 */
export function upkeepRoleOf(
  id: string,
  studioCategories?: StudioTaskCategory[],
): UpkeepRole | undefined {
  const authored = studioCategories?.find((c) => c.id === id);
  if (authored) return authored.upkeepRole;
  if (id === "cleaning" || id === "maintenance") return id;
  return undefined;
}

export type RecurrenceType = "daily" | "weekly" | "monthly" | "once";

export interface TaskRecurrence {
  type: RecurrenceType;
  /**
   * weekly only. 0 = Sunday, matching Date#getDay. Empty behaves as "every day
   * of the week" rather than "never", because a weekly template with no days
   * selected is a half-finished edit, and silently generating nothing is the
   * least debuggable possible outcome.
   */
  daysOfWeek?: number[];
  /** monthly only. 1-31; a day past the end of a short month is skipped. */
  dayOfMonth?: number;
  /** once only. Studio-local 'YYYY-MM-DD'. */
  onDate?: string;
  /**
   * Which shifts this generates on a due day. One instance per shift listed.
   * Defaults to ['any'].
   */
  shifts?: TaskShift[];
}

/**
 * What the task is about.
 *
 * `machineIds: "all"` is stored as the literal string rather than an expanded
 * list on purpose: a studio that adds a machine next month should get it
 * included in "wipe down every machine" without anyone re-saving the template.
 */
export type TaskTarget =
  | { kind: "machine"; machineIds: string[] | "all" }
  | { kind: "facility"; area?: string }
  | {
      kind: "client";
      clientId?: string;
      /** Deep-links the check-off into the real flow rather than a bare tick. */
      action?: "inbody" | "assessment" | "progress-report" | "custom";
    };

/**
 * Which tier a task belongs to.
 *
 *   "studio"   - authored by a manager, visible to everyone at that location.
 *                Lives at studios/{studioId}/task*.
 *   "personal" - a trainer's own list, visible only to them.
 *                Lives at trainers/{uid}/task*.
 *
 * THE TIER IS A PATH, NOT A FIELD TO FILTER ON.
 *
 * The cheaper design is one collection with a `scope` field and a rule that
 * hides other people's rows. Firestore cannot enforce that on a LIST unless
 * every query carries a matching constraint, so privacy would depend on every
 * future query being written correctly, and one unconstrained read added later
 * leaks every trainer's private list at once. Separate paths make it
 * structural instead: the rule is `request.auth.uid == trainerId` and there is
 * nothing for a future caller to remember.
 *
 * `scope` is ALSO stored on the document, so a row that has already been read
 * knows where to write itself back without the caller reconstructing it.
 */
export type TaskScope = "studio" | "personal";

export const SCOPE_LABEL: Record<TaskScope, string> = {
  studio: "Studio",
  personal: "Mine",
};

/**
 * Where one task's documents live.
 *
 * A personal task still carries a studioId - a trainer's own list is filtered
 * to the location they are working at, so "restock the towels" does not follow
 * them across town - but the studio is not part of its path. Ownership is by
 * trainer; visibility is by location.
 */
export type TaskLocation =
  | { scope: "studio"; studioId: string }
  | { scope: "personal"; studioId: string; ownerId: string };

/** Documents written before Sep 2026 predate the tiers and are all studio tasks. */
export function taskScopeOf(t: { scope?: TaskScope }): TaskScope {
  return t.scope === "personal" ? "personal" : "studio";
}

/**
 * The path a template's writes belong on.
 *
 * Falls back to the studio path when a personal template has somehow lost its
 * ownerId. Writing to the shared list is wrong, but writing to
 * trainers/undefined/... is worse: it would silently succeed for the first
 * trainer to do it and be readable by nobody.
 */
export function taskLocationOf(
  template: { scope?: TaskScope; ownerId?: string },
  studioId: string,
): TaskLocation {
  return taskScopeOf(template) === "personal" && template.ownerId
    ? { scope: "personal", studioId, ownerId: template.ownerId }
    : { scope: "studio", studioId };
}

/**
 * Firestore:
 *   studios/{studioId}/taskTemplates/{templateId}   (scope "studio")
 *   trainers/{ownerId}/taskTemplates/{templateId}   (scope "personal")
 */
export interface TaskTemplate {
  id: string;
  studioId: string;
  /** Absent on pre-Sep-2026 documents, which are all studio tasks. */
  scope?: TaskScope;
  /** Auth uid of the owner. Set on personal tasks only, and is their path. */
  ownerId?: string;

  title: string;
  detail?: string;
  kind: TaskKind;
  category: TaskCategory;
  target: TaskTarget;
  recurrence: TaskRecurrence;

  /** Studio-local "HH:MM". Display and ordering only; nothing enforces it. */
  timeOfDay?: string;
  /** Completion is blocked until a note is written. For maintenance checks. */
  requiresNote?: boolean;
  /** Suggested owner. Never enforced — anyone on the floor can close a task. */
  assigneeTrainerId?: string;

  /**
   * Tell whoever created this task when someone finishes it. In-app only.
   *
   * Defaults FALSE for recurring templates and true for one-offs, and that
   * default is the whole feature. A studio with 40 daily cleaning tasks would
   * bury its manager in receipts by lunchtime and they would stop reading the
   * bell entirely — which costs you the notifications that actually matter.
   * Recurring trash duty needs no receipt; "restock the InBody paper before
   * Thursday" does.
   */
  notifyCreatorOnComplete?: boolean;

  order?: number;
  active: boolean;

  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export type TaskStatus = "open" | "done" | "skipped";

/**
 * Firestore, mirroring its template:
 *   studios/{studioId}/taskInstances/{instanceId}
 *   trainers/{ownerId}/taskInstances/{instanceId}
 * where instanceId = instanceId(...) from recurrence.ts.
 */
export interface TaskInstance {
  id: string;
  studioId: string;
  templateId: string;
  scope?: TaskScope;
  ownerId?: string;

  /** Studio-local 'YYYY-MM-DD'. */
  localDate: string;
  shift: TaskShift;
  /** Set only for machine-scoped templates: one instance per machine. */
  machineId?: string;

  status: TaskStatus;
  note?: string;
  /** Maintenance only: closed with a problem, which flags the machine. */
  flagged?: boolean;

  /**
   * Soft claim: "someone is on this". ADVISORY, never a lock — anyone can
   * still complete a task another trainer has claimed.
   *
   * The alternative was tempting and wrong. A hard claim means a trainer
   * claims the trash at 9am, gets pulled into a consultation, and the bin
   * stays full because the app told everyone else it was handled. A claim
   * answers a coordination question, not a permissions one, so the UI shows
   * who has it and leaves the tick box live.
   *
   * Claiming writes the instance document, which looks like it breaks the
   * "nothing is written until someone acts" rule in mutations.ts. It does
   * not: claiming IS acting. The deterministic id still makes it safe when
   * two trainers claim in the same second — one document, last write wins.
   *
   * Claims need no expiry. An instance is already per-localDate, so
   * tomorrow's row is a different document and starts unclaimed.
   */
  claimedBy?: { id: string; name: string } | null;
  claimedAt?: unknown;

  completedAt?: unknown;
  completedBy?: { id: string; name: string } | null;

  /** Denormalized so a completed instance still reads correctly after the
   *  template is renamed or deleted. */
  title: string;
  category: TaskCategory;
  kind: TaskKind;

  createdAt?: unknown;
}

/** One instance the day's plan says should exist. */
export interface PlannedInstance {
  id: string;
  templateId: string;
  localDate: string;
  shift: TaskShift;
  machineId?: string;
  title: string;
  category: TaskCategory;
  kind: TaskKind;
}

/** A planned instance joined to its stored state, ready to render. */
export interface TaskRow extends PlannedInstance {
  template: TaskTemplate;
  instance: TaskInstance | null;
  status: TaskStatus;
  /** Machine display name, when machine-scoped. */
  machineName?: string;
  /** Client display name, when client-scoped. */
  clientName?: string;
}

/** What a client task actually opens. */
export type ClientTaskAction =
  | "inbody"
  | "assessment"
  | "progress-report"
  | "custom";

export const CLIENT_ACTION_LABEL: Record<ClientTaskAction, string> = {
  inbody: "InBody scan",
  assessment: "Assessment",
  "progress-report": "Progress report",
  custom: "Something else",
};
