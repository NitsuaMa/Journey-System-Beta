/**
 * The one write this feature makes.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 */

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import type { FeedbackContext, FeedbackKind } from "./types";
import { FEEDBACK_KIND_SHORT } from "./types";

export interface SubmitFeedbackParams {
  kind: FeedbackKind;
  description: string;
  context: FeedbackContext;
  author: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    studioId?: string | null;
  };
}

/** Firestore rejects a document containing `undefined` on any key, at any depth. */
function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}

export async function submitFeedback(params: SubmitFeedbackParams): Promise<void> {
  const { kind, description, context, author } = params;

  const trimmed = description.trim();
  if (!trimmed) throw new Error("Tell us what happened first.");

  await addDoc(collection(db, "bug_reports"), {
    kind,
    // Written so AdminBugReports, which groups on the pre-Sep-2026
    // `issueType` string, keeps working without a migration.
    issueType: FEEDBACK_KIND_SHORT[kind],
    description: trimmed.slice(0, 5000),

    userId: author.id || "unknown",
    userEmail: author.email || "unknown",
    userName: author.name || "unknown",
    studioId: author.studioId || "unassigned",

    context: pruneUndefined(context as Record<string, unknown>),
    status: "open",
    createdAt: serverTimestamp(),
  });
}
