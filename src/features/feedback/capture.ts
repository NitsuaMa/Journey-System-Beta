/**
 * What the app knows, gathered at the moment the drawer opens.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * CAPTURED AT OPEN, NOT AT SUBMIT
 * -------------------------------
 * A trainer opens the drawer on the failing screen and then spends a minute
 * typing. If the capture ran on submit it would describe the drawer, not the
 * bug — and on a screen that navigates itself (a session ending, a sync
 * finishing) it could describe somewhere else entirely.
 *
 * EVERY READ IS GUARDED
 * ---------------------
 * This runs while something is already going wrong. `window.matchMedia` is
 * absent in a test renderer, `navigator.platform` is deprecated and gone in
 * some browsers, and the error buffer may never have been installed. A capture
 * that throws would take the trainer's report down with it, which is precisely
 * the moment we most want the report.
 */

import type { FeedbackContext, FeedbackErrorSample } from "./types";

/**
 * main.tsx keeps a small ring buffer of the runtime errors it reports and
 * declares `__recentClientErrors` on Window there. Not re-declared here: two
 * global augmentations of the same property must be written with the SAME
 * type, and a second one spelled differently is a compile error rather than a
 * merge. main.tsx is not imported either — it is the entry module, and
 * importing it from a lazy component would drag the whole app bootstrap into
 * that chunk.
 */

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export interface CaptureInput {
  view?: string;
  studioId?: string | null;
  studioName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  sessionId?: string | null;
  theme?: string | null;
}

export function captureFeedbackContext(input: CaptureInput = {}): FeedbackContext {
  const w = safe(() => window);

  const width = safe(() => w?.innerWidth) ?? 0;
  const height = safe(() => w?.innerHeight) ?? 0;

  const ctx: FeedbackContext = {
    ...(input.view ? { view: input.view } : {}),
    ...(input.studioId ? { studioId: input.studioId } : {}),
    ...(input.studioName ? { studioName: input.studioName } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
  };

  if (width && height) {
    ctx.viewport = `${width}x${height}`;
    ctx.orientation = height >= width ? "portrait" : "landscape";
  }

  const dpr = safe(() => w?.devicePixelRatio);
  if (dpr) ctx.devicePixelRatio = dpr;

  const url = safe(() => w?.location?.href);
  if (url) ctx.url = url;

  const ua = safe(() => w?.navigator?.userAgent);
  if (ua) ctx.userAgent = ua;

  // Deprecated and absent in some browsers, hence the guard rather than a read.
  const platform = safe(() => (w?.navigator as Navigator & { platform?: string })?.platform);
  if (platform) ctx.platform = platform;

  const version = safe(() => w?.__appVersion);
  if (version) ctx.appVersion = version;

  // Newest first, capped: a report is a summary, not a log dump, and the
  // Firestore document limit is 1 MiB.
  const errors = safe(() => w?.__recentClientErrors);
  if (errors && errors.length > 0) {
    ctx.recentErrors = errors
      .slice(-5)
      .reverse()
      .map<FeedbackErrorSample>((e) => ({
        message: String(e.message ?? "").slice(0, 500),
        type: String(e.type ?? "unknown"),
        at: Number(e.at) || 0,
      }));
  }

  return ctx;
}

/** A one-line human summary, for the "what we'll send" line in the drawer. */
export function describeContext(ctx: FeedbackContext): string {
  const bits: string[] = [];
  if (ctx.view) bits.push(ctx.view);
  if (ctx.studioName) bits.push(ctx.studioName);
  if (ctx.clientName) bits.push(ctx.clientName);
  if (ctx.viewport) bits.push(`${ctx.viewport} ${ctx.orientation ?? ""}`.trim());
  if (ctx.recentErrors?.length) {
    bits.push(`${ctx.recentErrors.length} recent error${ctx.recentErrors.length === 1 ? "" : "s"}`);
  }
  return bits.join(" · ");
}
