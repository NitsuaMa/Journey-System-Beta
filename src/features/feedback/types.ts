/**
 * BETA FEEDBACK — bugs, UI complaints and feature ideas.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WHY THIS IS A FEATURE AND NOT A FORM
 * ------------------------------------
 * The old reporter lived inside App Settings, three taps deep, and captured
 * `userAgent` and `platform`. That is the least useful half of a bug report:
 * "it broke" plus a browser string is not something anyone can act on.
 *
 * The trainer knows WHAT went wrong. The app knows WHERE. Splitting the job
 * that way is the whole design — the trainer types one sentence and the app
 * attaches the screen, the studio, the client, the viewport and the last few
 * runtime errors. Nothing below is typed by a human except `description`.
 *
 * Documents land in the existing top-level `bug_reports` collection, which
 * AdminBugReports already reads, so this widens a live pipe rather than
 * digging a second one.
 */

/**
 * Three kinds, one collection.
 *
 * Beta feedback arrives as complaints, not as tickets: "this is broken",
 * "this feels wrong" and "this should exist" turn up in the same breath from
 * the same trainer. Three separate forms would mean three inboxes and a
 * guessing game about which one to open. One field lets AdminBugReports filter.
 */
export type FeedbackKind = "bug" | "ui" | "idea";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Something is broken",
  ui: "Something feels wrong",
  idea: "Something is missing",
};

export const FEEDBACK_KIND_SHORT: Record<FeedbackKind, string> = {
  bug: "Bug",
  ui: "UI feedback",
  idea: "Feature idea",
};

export const FEEDBACK_KIND_PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: "What did you do, and what happened instead of what you expected?",
  ui: "What feels wrong about this screen? Hard to read, hard to reach, too many taps?",
  idea: "What would you like to be able to do that you can't today?",
};

/**
 * One captured runtime error, mirrored from main.tsx's reporter.
 *
 * Deliberately a plain shape rather than an Error: this is serialized into a
 * Firestore document, and Error does not survive that.
 */
export interface FeedbackErrorSample {
  message: string;
  type: string;
  at: number;
}

/**
 * What the app knows about where the trainer was standing.
 *
 * Every field is optional because every field is best-effort — a capture that
 * throws is worse than a capture that comes back half empty, and a trainer
 * mid-report should never lose their typing to a missing id.
 */
export interface FeedbackContext {
  /** currentView at the moment the drawer opened, not when it was submitted. */
  view?: string;
  studioId?: string;
  studioName?: string;
  clientId?: string;
  clientName?: string;
  sessionId?: string;

  /** Catches the portrait-only iPad bugs that never reproduce on a desktop. */
  viewport?: string;
  orientation?: "portrait" | "landscape";
  theme?: string;
  devicePixelRatio?: number;

  appVersion?: string;
  url?: string;
  userAgent?: string;
  platform?: string;

  /** Last few runtime errors, newest first. Usually the actual answer. */
  recentErrors?: FeedbackErrorSample[];
}

/** A document in the top-level `bug_reports` collection. */
export interface FeedbackReport {
  id?: string;
  kind: FeedbackKind;
  /**
   * Kept for the documents written before Sep 2026, which had `issueType`
   * ("UI Problem", "Data Error", ...) and no `kind`. AdminBugReports renders
   * whichever it finds, so old reports keep reading correctly.
   */
  issueType?: string;
  description: string;

  userId: string;
  userEmail: string;
  userName: string;
  studioId: string;

  context: FeedbackContext;
  status: "open" | "investigating" | "fixed" | "wont-fix";
  createdAt?: unknown;
}
