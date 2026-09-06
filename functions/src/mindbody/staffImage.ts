/**
 * STAFF IMAGE — Mindbody's staff photo, cached on the trainer document.
 *
 * WHERE THE PHOTO ACTUALLY COMES FROM
 * -----------------------------------
 * Three sources, in order of how much they cost:
 *
 *   1. `GET /staff/staff?Limit=200` -- the bulk call server.ts ALREADY makes
 *      every time the Edit Trainer picker opens. It returns ImageUrl for the
 *      whole roster. This is free, and it is where most photos come from.
 *   2. The `imageUrl` field on a `staff.*` webhook payload, when one is
 *      present. Also free.
 *   3. `GET /staff/{staffId}/imageurl` -- one HTTP round trip per staff
 *      member. Only used here, for a single deliberate refresh and for the
 *      weekly sweep.
 *
 * The Public API is metered and the Webhooks API is not, so the write-through
 * cache below matters: without it a burst of staff.updated events turns into
 * a burst of billable calls for a photo that has not changed.
 *
 * A NOTE ON EXPECTATIONS
 * ----------------------
 * Most Max Strength staff have no Mindbody photo at all. Initials are the
 * primary way a trainer is drawn throughout the app, not a fallback state,
 * and nothing here should be read as an attempt to change that.
 */
import { DocumentReference, FieldValue, Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";

const mindbodyApiKey = defineSecret("MINDBODY_API_KEY");

const REGION = "us-central1";
const TIME_ZONE = "America/New_York";
const JOURNEY_DATABASE = "ai-studio-32cbbdcc-6e08-4770-9665-867c68878efa";

/** How long a cached photo URL is trusted before it is fetched again. */
export const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedImageState = {
  imageUrl?: string | null;
  imageFetchedAt?: { toMillis?: () => number } | null;
};

/**
 * Pure: is this cached photo old enough to be worth an API call?
 *
 * A trainer who has never been checked always is. A trainer checked ten
 * minutes ago never is, even if ten staff.updated events arrive in that time.
 */
export function shouldRefreshImage(
  cached: CachedImageState | undefined,
  nowMs: number,
  ttlMs: number = IMAGE_TTL_MS,
): boolean {
  const fetchedAt = cached?.imageFetchedAt;
  if (!fetchedAt || typeof fetchedAt.toMillis !== "function") return true;
  const ms = fetchedAt.toMillis();
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms >= ttlMs;
}

/**
 * Pure: pull a usable photo URL out of whatever the endpoint returned.
 *
 * Mindbody is inconsistent about casing and nesting across its endpoints, and
 * this one is thinly documented, so every plausible shape is accepted and
 * anything that is not an https URL is treated as "no photo" rather than
 * stored to render as a broken avatar forever.
 */
export function parseImageUrlResponse(body: unknown): string | null {
  const candidates: unknown[] = [];
  if (typeof body === "string") candidates.push(body);
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    candidates.push(obj.ImageUrl, obj.imageUrl, obj.ImageURL, obj.url, obj.Url);
    const nested = obj.Staff ?? obj.staff;
    if (nested && typeof nested === "object") {
      const n = nested as Record<string, unknown>;
      candidates.push(n.ImageUrl, n.imageUrl);
    }
  }
  for (const value of candidates) {
    if (typeof value === "string" && /^https:\/\/\S+$/i.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

/**
 * One call to `GET /public/v6/staff/{staffId}/imageurl`.
 *
 * Returns null rather than throwing on a 404 or an empty body: "this staff
 * member has no photo" is the normal answer here, not an error, and treating
 * it as one would fill the logs and retry forever.
 */
export async function fetchStaffImageUrl(opts: {
  apiKey: string;
  siteId: string;
  staffId: string;
  authorization?: string;
  fetchImpl?: FetchLike;
}): Promise<string | null> {
  const doFetch = (opts.fetchImpl || (globalThis.fetch as unknown as FetchLike));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Api-Key": opts.apiKey,
    SiteId: String(opts.siteId),
  };
  if (opts.authorization) headers.Authorization = opts.authorization;

  const response = await doFetch(
    `https://api.mindbodyonline.com/public/v6/staff/${encodeURIComponent(opts.staffId)}/imageurl`,
    { method: "GET", headers },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Mindbody staff image ${response.status}: ${detail.slice(0, 200)}`);
  }

  try {
    return parseImageUrlResponse(await response.json());
  } catch {
    return null;
  }
}

/**
 * Refreshes one trainer's cached photo, honouring the TTL.
 *
 * `imageFetchedAt` is stamped even when Mindbody has no photo, so a staff
 * member without one is not re-checked on every single event.
 */
export async function refreshStaffImage(
  firestore: Firestore,
  trainerRef: DocumentReference,
  opts: {
    apiKey: string;
    siteId: string;
    staffId: string;
    ttlMs?: number;
    force?: boolean;
    nowMs?: number;
    fetchImpl?: FetchLike;
  },
): Promise<{ refreshed: boolean; url: string | null; reason?: string }> {
  const nowMs = opts.nowMs ?? Date.now();
  const snap = await trainerRef.get();
  const cached = (snap.data() as { mindbody?: CachedImageState } | undefined)?.mindbody;

  if (!opts.force && !shouldRefreshImage(cached, nowMs, opts.ttlMs ?? IMAGE_TTL_MS)) {
    return { refreshed: false, url: cached?.imageUrl ?? null, reason: "still fresh" };
  }

  const url = await fetchStaffImageUrl({
    apiKey: opts.apiKey,
    siteId: opts.siteId,
    staffId: opts.staffId,
    fetchImpl: opts.fetchImpl,
  });

  await trainerRef.set(
    {
      mindbody: {
        imageUrl: url,
        imageFetchedAt: FieldValue.serverTimestamp(),
        staffId: String(opts.staffId),
      },
    },
    { merge: true },
  );

  return { refreshed: true, url };
}

/* ------------------------------------------------------------------ */
/* Deployed functions                                                  */
/* ------------------------------------------------------------------ */

let dbInstance: Firestore | null = null;
function db(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(JOURNEY_DATABASE);
  return dbInstance;
}

/** studioId -> Mindbody site id, for turning a trainer into an API call. */
async function siteIdByStudio(firestore: Firestore): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const snap = await firestore.collection("studios").get();
  snap.forEach((doc) => {
    const siteId = (doc.data() as any)?.mindbodySiteId;
    if (siteId !== undefined && siteId !== null && String(siteId).trim()) {
      map.set(doc.id, String(siteId).trim());
    }
  });
  return map;
}

/**
 * Weekly sweep. Catches photos changed in Mindbody without an event, and
 * re-signs any CDN URL that has rotated.
 *
 * Sunday 04:00, which is outside every studio's opening hours.
 */
export const syncMindbodyStaffImages = onSchedule(
  { schedule: "0 4 * * 0", timeZone: TIME_ZONE, region: REGION, secrets: [mindbodyApiKey] },
  async () => {
    const firestore = db();
    const sites = await siteIdByStudio(firestore);
    const trainers = await firestore.collection("trainers").get();

    let checked = 0;
    let updated = 0;
    let skipped = 0;

    for (const doc of trainers.docs) {
      const data = doc.data() as any;
      const staffId = data?.mindbodyStaffId;
      if (staffId === undefined || staffId === null || !String(staffId).trim()) continue;

      const siteId = sites.get(data?.primaryHomeStudioId);
      if (!siteId) {
        skipped += 1;
        continue;
      }

      checked += 1;
      try {
        const result = await refreshStaffImage(firestore, doc.ref, {
          apiKey: mindbodyApiKey.value(),
          siteId,
          staffId: String(staffId).trim(),
        });
        if (result.refreshed) updated += 1;
      } catch (error) {
        // One trainer's failure must not abandon the rest of the roster.
        console.error(`staffImage: refresh failed for trainer ${doc.id}`, error);
      }
    }

    console.log(
      `staffImage: swept ${checked} linked trainers, refreshed ${updated}, skipped ${skipped} with no site id.`,
    );
  },
);

/**
 * On-demand refresh behind the "Refresh photo" button in Edit Trainer.
 *
 * Lives in Cloud Functions rather than only in server.ts so the button works
 * from a device that cannot reach the Render host, and so the API key never
 * has to travel further than it already does.
 */
export const refreshMindbodyStaffImage = onCall(
  { region: REGION, secrets: [mindbodyApiKey] },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

    const trainerId = typeof data?.trainerId === "string" ? data.trainerId.trim() : "";
    if (!trainerId) throw new HttpsError("invalid-argument", "trainerId is required.");

    const firestore = db();
    const trainerRef = firestore.collection("trainers").doc(trainerId);
    const snap = await trainerRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "No such trainer.");

    const trainer = snap.data() as any;

    // Yourself, or someone who can already edit you. Same shape as the Edit
    // Profile affordance, so the button is never offered where it would fail.
    const callerRole =
      (auth.token as Record<string, unknown>).role ??
      (await firestore.collection("trainers").doc(auth.uid).get()).data()?.role;
    const isLeadership =
      callerRole === "Admin" ||
      callerRole === "Founder" ||
      callerRole === "Overseer" ||
      callerRole === "Owner" ||
      callerRole === "FranchiseOwner" ||
      callerRole === "StudioOwner" ||
      callerRole === "StudioLeader" ||
      callerRole === "HeadTrainer";
    if (auth.uid !== trainerId && !isLeadership) {
      throw new HttpsError("permission-denied", "You cannot refresh another trainer's photo.");
    }

    const staffId = trainer?.mindbodyStaffId;
    if (staffId === undefined || staffId === null || !String(staffId).trim()) {
      throw new HttpsError(
        "failed-precondition",
        "This trainer has no Mindbody staff id yet. Link one in Edit Trainer first.",
      );
    }

    const sites = await siteIdByStudio(firestore);
    const siteId = sites.get(trainer?.primaryHomeStudioId);
    if (!siteId) {
      throw new HttpsError(
        "failed-precondition",
        "This trainer's home studio has no Mindbody site id. Set it in Admin -> Studios.",
      );
    }

    const result = await refreshStaffImage(firestore, trainerRef, {
      apiKey: mindbodyApiKey.value(),
      siteId,
      staffId: String(staffId).trim(),
      force: true, // a person pressed a button; the TTL is not the boss here
    });

    return { success: true, imageUrl: result.url };
  },
);
