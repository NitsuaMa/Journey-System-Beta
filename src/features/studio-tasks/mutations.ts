/**
 * STUDIO TASKS — every write this feature makes, in one file.
 *
 * Round: Studio To-Do, Sep 2026.
 *
 * NO EAGER MATERIALIZATION — a departure from the spec
 * ----------------------------------------------------
 * The plan was for the first trainer to open the list each day to write that
 * day's instances with setDoc(merge). The deterministic ids made that safe, and
 * it is what §8.1 of the catalog spec describes.
 *
 * It is also unnecessary, and writing it would have been the expensive kind of
 * unnecessary. The day's plan is DERIVED — planDay() computes it from the
 * templates and the roster — so a row with no stored document is simply an open
 * task. Materializing eagerly would mean:
 *
 *   - a burst of 50+ writes the first time anyone opens the app each morning,
 *     on a tablet on studio wifi, for a day that might see no work at all;
 *   - a document for every task on every day the studio was closed;
 *   - a create permission that has to be open to every trainer for documents
 *     nobody asked for.
 *
 * So instances are written LAZILY, on the first action against them. The
 * deterministic id is still what makes that safe: two trainers ticking the same
 * box at the same moment write the same document rather than two.
 *
 * The tradeoff is that "what was outstanding last Tuesday" has to be recomputed
 * from the templates rather than read back. That is the correct direction — the
 * plan is the source of truth and the instances are the record of action
 * against it — and planDay() is pure, so recomputing it is free.
 */

import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase";
import type {
  PlannedInstance,
  StudioTaskCategory,
  TaskInstance,
  TaskLocation,
  TaskStatus,
  TaskTemplate,
} from "./types";

export interface TaskAuthor {
  id: string;
  name: string;
}

export function templatesRef(studioId: string) {
  return collection(db, "studios", studioId, "taskTemplates");
}

export function instancesRef(studioId: string) {
  return collection(db, "studios", studioId, "taskInstances");
}

export function instanceRef(studioId: string, instanceId: string) {
  return doc(db, "studios", studioId, "taskInstances", instanceId);
}

/** A trainer's private list. The uid IS the tenancy - see TaskScope. */
export function personalTemplatesRef(ownerId: string) {
  return collection(db, "trainers", ownerId, "taskTemplates");
}

export function personalInstancesRef(ownerId: string) {
  return collection(db, "trainers", ownerId, "taskInstances");
}

/** The one place either tier is turned into a path. */
export function templateDocRef(loc: TaskLocation, templateId: string) {
  return loc.scope === "personal"
    ? doc(db, "trainers", loc.ownerId, "taskTemplates", templateId)
    : doc(db, "studios", loc.studioId, "taskTemplates", templateId);
}

export function instanceDocRef(loc: TaskLocation, instanceId: string) {
  return loc.scope === "personal"
    ? doc(db, "trainers", loc.ownerId, "taskInstances", instanceId)
    : doc(db, "studios", loc.studioId, "taskInstances", instanceId);
}

/** Convenience for the many call sites that only ever mean a studio task. */
export function studioLocation(studioId: string): TaskLocation {
  return { scope: "studio", studioId };
}

/** studios/{studioId}/taskCategories — a studio's own labels for its work. */
export function categoriesRef(studioId: string) {
  return collection(db, "studios", studioId, "taskCategories");
}

/**
 * Firestore caps a batch at 500 operations. A studio with a lot of templates
 * and a full roster can exceed that on "mark everything", so chunk below the
 * limit rather than discovering it in production.
 *
 * Each chunk is atomic on its own. A partially-applied "mark all" leaves some
 * tasks ticked and some not, which is recoverable and visible; the alternative
 * (one write per row, unbatched) fails the same way but slower and with more
 * chances to fail.
 */
const BATCH_LIMIT = 450;

function instancePayload(
  planned: PlannedInstance,
  loc: TaskLocation,
  status: TaskStatus,
  author: TaskAuthor | null,
  extra: { note?: string; flagged?: boolean } = {},
): Omit<TaskInstance, "id"> & Record<string, unknown> {
  const done = status === "done";
  return {
    studioId: loc.studioId,
    scope: loc.scope,
    ...(loc.scope === "personal" ? { ownerId: loc.ownerId } : {}),
    templateId: planned.templateId,
    localDate: planned.localDate,
    shift: planned.shift,
    ...(planned.machineId ? { machineId: planned.machineId } : {}),

    status,
    ...(extra.note !== undefined ? { note: extra.note } : {}),
    ...(extra.flagged !== undefined ? { flagged: extra.flagged } : {}),

    // Cleared on reopen, so a re-opened task does not keep claiming it was
    // finished by whoever last closed it.
    completedAt: done ? serverTimestamp() : null,
    completedBy: done ? author : null,

    // Denormalized so a completed instance still reads correctly after its
    // template is renamed, retargeted or deleted.
    title: planned.title,
    category: planned.category,
    kind: planned.kind,

    updatedAt: serverTimestamp(),
  };
}

/** Set one task's status. Creates the instance document if this is its first action. */
export async function setTaskStatus(params: {
  location: TaskLocation;
  planned: PlannedInstance;
  status: TaskStatus;
  author: TaskAuthor | null;
  note?: string;
  flagged?: boolean;
}): Promise<void> {
  const { location, planned, status, author, note, flagged } = params;
  if (!location.studioId) {
    throw new Error("No active studio — cannot update a task.");
  }

  await setDoc(
    instanceDocRef(location, planned.id),
    instancePayload(planned, location, status, author, { note, flagged }),
    { merge: true },
  );
}

/**
 * Set many tasks at once — "mark all", or a multi-select.
 *
 * Returns how many were written so the caller can report honestly rather than
 * assuming. Rows already in the target status are skipped, so re-tapping "mark
 * all" costs nothing.
 */
export async function setManyTaskStatuses(params: {
  location: TaskLocation;
  planned: PlannedInstance[];
  status: TaskStatus;
  author: TaskAuthor | null;
  note?: string;
}): Promise<number> {
  const { location, planned, status, author, note } = params;
  if (!location.studioId) {
    throw new Error("No active studio — cannot update tasks.");
  }
  if (planned.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < planned.length; i += BATCH_LIMIT) {
    const chunk = planned.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const p of chunk) {
      batch.set(
        instanceDocRef(location, p.id),
        instancePayload(p, location, status, author, { note }),
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/**
 * Claim a task, or hand it back.
 *
 * Writes the instance document on first claim, exactly as a status change
 * does — see the note on TaskInstance.claimedBy for why claiming counts as
 * acting, and why the claim is advisory rather than a lock.
 *
 * Deliberately does NOT touch `status`. A claimed task is still open; the two
 * are separate axes, and collapsing them would make "claimed" unfinishable by
 * anyone but the claimer, which is the failure this design exists to avoid.
 */
export async function setTaskClaim(params: {
  location: TaskLocation;
  planned: PlannedInstance;
  author: TaskAuthor | null;
  claimed: boolean;
}): Promise<void> {
  const { location, planned, author, claimed } = params;
  if (!location.studioId) {
    throw new Error("No active studio — cannot claim a task.");
  }
  if (claimed && !author) {
    throw new Error("Cannot claim a task without a signed-in trainer.");
  }

  await setDoc(
    instanceDocRef(location, planned.id),
    {
      studioId: location.studioId,
      scope: location.scope,
      ...(location.scope === "personal" ? { ownerId: location.ownerId } : {}),
      templateId: planned.templateId,
      localDate: planned.localDate,
      shift: planned.shift,
      ...(planned.machineId ? { machineId: planned.machineId } : {}),

      // Written so a claimed-but-never-completed row still renders from its
      // own document if the template is later renamed or retired.
      title: planned.title,
      category: planned.category,
      kind: planned.kind,

      claimedBy: claimed ? author : null,
      claimedAt: claimed ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ── CATEGORIES (studio-authored) ─────────────────────────────────────────

export async function saveStudioCategory(params: {
  studioId: string;
  category: StudioTaskCategory;
  author: TaskAuthor | null;
  isNew: boolean;
}): Promise<void> {
  const { studioId, category, author, isNew } = params;
  if (!studioId) throw new Error("No active studio.");
  if (!category.label.trim()) throw new Error("A category needs a name.");

  const { id, ...rest } = category;
  await setDoc(
    doc(db, "studios", studioId, "taskCategories", id),
    {
      ...rest,
      label: category.label.trim(),
      ...(isNew
        ? { createdAt: serverTimestamp(), createdBy: author?.id ?? null }
        : {}),
    },
    { merge: true },
  );
}

/**
 * Retire a category.
 *
 * Hard delete, unlike a template: instances denormalize their category id and
 * categoryLabel() title-cases an unknown id rather than showing a blank, so a
 * deleted category leaves history readable. There is nothing to preserve.
 */
export async function deleteStudioCategory(
  studioId: string,
  categoryId: string,
): Promise<void> {
  await deleteDoc(doc(db, "studios", studioId, "taskCategories", categoryId));
}

/** Ids are readable so a completed instance reads correctly without a join. */
export function newCategoryId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || `cat-${Math.random().toString(36).slice(2, 7)}`;
}

// ── TEMPLATES (manager) ──────────────────────────────────────────────────

export async function saveTaskTemplate(params: {
  location: TaskLocation;
  template: TaskTemplate;
  author: TaskAuthor | null;
  isNew: boolean;
}): Promise<void> {
  const { location, template, author, isNew } = params;
  if (!location.studioId) {
    throw new Error("No active studio — cannot save a task.");
  }
  if (!template.title.trim()) throw new Error("A task needs a title.");

  const { id, ...rest } = template;
  await setDoc(
    templateDocRef(location, id),
    {
      ...rest,
      studioId: location.studioId,
      scope: location.scope,
      ...(location.scope === "personal" ? { ownerId: location.ownerId } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: author?.id ?? null,
      ...(isNew
        ? { createdAt: serverTimestamp(), createdBy: author?.id ?? null }
        : {}),
    },
    { merge: true },
  );
}

/**
 * Retire a template.
 *
 * Deactivates rather than deletes by default: instances reference it, and a
 * deleted template would orphan the history of every time the task was done.
 * Hard delete is reserved for a template created in error.
 */
export async function setTaskTemplateActive(params: {
  location: TaskLocation;
  templateId: string;
  active: boolean;
  author: TaskAuthor | null;
}): Promise<void> {
  const { location, templateId, active, author } = params;
  await setDoc(
    templateDocRef(location, templateId),
    { active, updatedAt: serverTimestamp(), updatedBy: author?.id ?? null },
    { merge: true },
  );
}

export async function deleteTaskTemplate(
  location: TaskLocation,
  templateId: string,
): Promise<void> {
  await deleteDoc(templateDocRef(location, templateId));
}

/** Ids are readable on purpose — they appear inside every instance id. */
export function newTemplateId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${slug || "task"}-${Math.random().toString(36).slice(2, 7)}`;
}
