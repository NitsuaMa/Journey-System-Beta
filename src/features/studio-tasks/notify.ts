/**
 * Who hears about a completed task, and who does not.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * The whole value of this file is the SILENCE it enforces. A studio runs 30-40
 * completions a day; announcing all of them would train every manager to
 * ignore the bell inside a week, and then the one notification that mattered —
 * a machine flagged as broken — arrives in a channel nobody reads.
 *
 * So four filters, in order of how much volume each removes:
 *
 *   1. Recurring templates are silent unless explicitly opted in. Nobody wants
 *      a receipt for the bin being emptied on a Tuesday.
 *   2. Nobody is told about their own action (enforced in notify()).
 *   3. Personal tasks never notify. There is no one else involved.
 *   4. A flagged machine ALWAYS notifies, opt-in or not, because "the leg
 *      press pad is split" is the message this system exists to carry.
 */

import { notify } from "../notifications";
import type { TaskAuthor } from "./mutations";
import type { TaskRow } from "./types";
import { taskScopeOf } from "./types";

export interface NotifyTaskCompletionParams {
  row: TaskRow;
  author: TaskAuthor | null;
  studioId: string | null;
  /** Falls back to the template's creator when not given. */
  studioLeaderId?: string | null;
  flagged?: boolean;
  note?: string;
}

export async function notifyTaskCompletion(
  params: NotifyTaskCompletionParams,
): Promise<void> {
  const { row, author, studioId, studioLeaderId, flagged, note } = params;
  if (!studioId || !author) return;

  const template = row.template;
  // A personal task has an audience of one, and they just did it.
  if (!template || taskScopeOf(template) === "personal") return;

  const machineSuffix = row.machineName ? ` — ${row.machineName}` : "";

  // Filter 4: a problem always travels, whatever the template says.
  if (flagged) {
    await notify({
      to: studioLeaderId ?? template.createdBy,
      actor: author,
      kind: "machine-flagged",
      title: `${author.name} flagged ${row.machineName ?? row.title}`,
      body: note || "A trainer reported a problem.",
      studioId,
      link: { view: "machine-anatomy", id: row.machineId },
    });
    return;
  }

  // Filter 1: recurring work is silent unless a manager asked to hear it.
  const recurring = template.recurrence?.type !== "once";
  const wanted = template.notifyCreatorOnComplete ?? !recurring;
  if (!wanted) return;

  await notify({
    to: template.createdBy,
    actor: author,
    kind: "task-completed",
    title: `${author.name} completed "${row.title}"${machineSuffix}`,
    ...(note ? { body: note } : {}),
    studioId,
    link: { view: "studio-tasks" },
  });
}
