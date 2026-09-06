import { Firestore, FieldValue } from "firebase-admin/firestore";

/**
 * Canonical client resolution for Mindbody events. STRICT MODE.
 *
 * THE RULE, without exception: a Mindbody client lives at
 * `clients/{mindbodyClientId}`. There is no name matching, no email matching,
 * and no adoption of documents sitting at other ids. If a stale document
 * exists elsewhere it is ignored, not written to.
 *
 * (An earlier revision adopted legacy documents to avoid splitting a client's
 * history. That safety net was removed deliberately once the plan became to
 * purge the database before go-live — with no legacy documents in existence,
 * the net only added branches that could never fire.)
 *
 * Clients that Mindbody has never heard of — created by hand in the app — keep
 * their own doc ids and are none of this module's business.
 */

/** Profile fields Mindbody can tell us about a person. */
export type MindbodyClientProfile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  photoUrl?: string;
  mindbodyNotes?: string;
  mindbody_name?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /* Address parts. `address` stays the single line a trainer edits; these come
   * from the webhook and, like every profile field, only ever fill blanks. */
  city?: string;
  addressState?: string;
  postalCode?: string;
  country?: string;
  /** How the client found the business. Staff-typed in Mindbody, so fill-blanks. */
  referredBy?: string;
};

export type EnsureClientResult = {
  /** Always the canonical doc id. */
  clientDocId: string;
  /** True when this call created the document. */
  created: boolean;
};

const CLIENTS = "clients";

/**
 * Events that could not be attributed to a studio.
 *
 * Deliberately NOT `mindbodyDLQ`. The dead-letter queue means "processing
 * failed and we gave up", and its depth drives the integration's health status
 * — anything over 10 items reports the whole Mindbody connection as `error`.
 * An unmapped site is not a broken integration, it is an empty field in
 * Admin -> Studios, and it must not masquerade as an outage.
 */
export const LIMBO_QUEUE = "mindbodyLimbo";

const str = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0);

/**
 * "staff"     a staff event whose Mindbody id matches no trainer, or matches
 *             more than one. Never auto-linked: a trainer document is an
 *             RBAC principal, so a human links it in Edit Trainer.
 * "unhandled" an event type no branch claims. Parked rather than dropped,
 *             so a new Mindbody event type shows up as a queue item
 *             instead of as silence.
 */
export type LimboKind =
  | "booking"
  | "client"
  | "commercial"
  | "staff"
  | "unhandled";

/**
 * Parks an event that cannot be filed against a studio, so an admin can see it
 * and act. Nothing is dropped.
 *
 * For BOOKINGS this is the difference between a trainer being blind to an
 * arriving client and an admin seeing "3 bookings waiting on a site mapping".
 *
 * Doc id is the event id, so Mindbody's retries collapse onto one record.
 */
export async function recordLimboEvent(
  firestore: Firestore,
  params: {
    eventId: string;
    eventType: string;
    kind: LimboKind;
    siteId?: string | number;
    locationId?: string | number;
    clientId?: string | number;
    reason: string;
    /** Human-readable summary so the admin screen needs no payload spelunking. */
    summary?: Record<string, unknown>;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const ref = firestore.collection(LIMBO_QUEUE).doc(params.eventId);
  await ref.set(
    {
      eventId: params.eventId,
      eventType: params.eventType,
      kind: params.kind,
      siteId: params.siteId !== undefined ? String(params.siteId) : null,
      locationId:
        params.locationId !== undefined ? String(params.locationId) : null,
      clientId: params.clientId !== undefined ? String(params.clientId) : null,
      reason: params.reason,
      summary: params.summary || null,
      payload: params.payload,
      firstSeenAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
    },
    { merge: true },
  );
}

/**
 * Upserts the client for a Mindbody event at the canonical path.
 *
 * `profile` fields only ever FILL BLANKS on an existing document — Mindbody
 * never overwrites what a trainer typed. `enrichment` (membership status, tier,
 * last visit) is Mindbody-owned and always overwrites.
 */
export async function ensureCanonicalClient(
  firestore: Firestore,
  params: {
    mindbodyClientId: string | number;
    profile: MindbodyClientProfile;
    enrichment?: Record<string, unknown>;
    /** Resolved studio, or null when the site could not be mapped. */
    studioId: string | null;
    /** Where the write came from, for auditing sparse stub documents. */
    origin: "client-event" | "booking-stub";
  },
): Promise<EnsureClientResult> {
  const mbId = String(params.mindbodyClientId).trim();
  if (!mbId) throw new TypeError("mindbodyClientId must be non-empty");

  const canonicalRef = firestore.collection(CLIENTS).doc(mbId);
  const canonicalSnap = await canonicalRef.get();

  const profileFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params.profile)) {
    const s = str(v);
    if (s !== undefined) profileFields[k] = s;
  }

  // ---- Existing document: merge, never clobber ---------------------------
  if (canonicalSnap.exists) {
    const existing = (canonicalSnap.data && canonicalSnap.data()) || {};
    const updates: Record<string, unknown> = {
      ...(params.enrichment || {}),
      mindbodyClientId: mbId,
      mindbodySyncedAt: FieldValue.serverTimestamp(),
    };
    for (const [k, v] of Object.entries(profileFields)) {
      if (isEmpty(existing[k])) updates[k] = v;
    }
    // A stub that has since learned the client's studio should record it; an
    // already-known studio is never reassigned here (index.ts decides that).
    if (params.studioId && isEmpty(existing.homeStudioId)) {
      updates.homeStudioId = params.studioId;
    }
    await canonicalRef.set(updates, { merge: true });
    return { clientDocId: mbId, created: false };
  }

  // ---- Create a COMPLETE client document ---------------------------------
  // Every field the app's Client type marks required is written here.
  const firstName = str(params.profile.firstName) || "";
  const lastName = str(params.profile.lastName) || "";
  const fallbackName = str(params.profile.mindbody_name) || "";

  // Use whatever Mindbody gave us, and only invent a placeholder when the
  // payload carried NO name at all. A client with a first name and no surname
  // gets an empty surname — not "Client 12345", which would read as their
  // actual last name everywhere in the app.
  const hasAnyName = Boolean(firstName || lastName || fallbackName);
  const resolvedFirst = firstName || fallbackName.split(" ")[0] || "";
  const resolvedLast =
    lastName || fallbackName.split(" ").slice(1).join(" ") || "";
  const displayName = `${resolvedFirst} ${resolvedLast}`.trim();

  const doc: Record<string, unknown> = {
    ...(params.enrichment || {}),
    ...profileFields,
    firstName: hasAnyName ? resolvedFirst : "Mindbody",
    lastName: hasAnyName ? resolvedLast : `Client ${mbId}`,
    mindbodyClientId: mbId,
    // `homeStudioId: null` is deliberate — never fall back to a default studio.
    // A mis-tenanted client appears on the wrong location's schedule.
    homeStudioId: params.studioId ?? null,
    isActive: true,
    height: "",
    remainingSessions: 0,
    sessionCount: 0,
    completedSessions: 0,
    createdAt: FieldValue.serverTimestamp(),
    mindbodySyncedAt: FieldValue.serverTimestamp(),
    createdBy: `mindbody:${params.origin}`,
    /** Set by booking-stub creation; cleared once a client event fills it in. */
    isMindbodyStub: params.origin === "booking-stub",
  };

  // An empty mindbody_name is worse than no field at all — it looks like a
  // real, blank value to every consumer.
  if (displayName) doc.mindbody_name = displayName;

  await canonicalRef.set(doc, { merge: true });
  return { clientDocId: mbId, created: true };
}
