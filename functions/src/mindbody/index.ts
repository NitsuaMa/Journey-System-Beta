import {
  Firestore,
  getFirestore,
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { verifyMindbodySignature } from "./verifySignature";
import { recordHealthEvent } from "./healthState";
import { tryRecordEvent } from "./idempotency";
import { wallClockToInstant, isValidTimeZone, DEFAULT_TIME_ZONE } from "./time";
import {
  ensureCanonicalClient,
  recordLimboEvent,
  LIMBO_QUEUE,
  MindbodyClientProfile,
} from "./clientResolver";
import { recordAttemptFailure } from "./retryLedger";
import { extractBookingExtras } from "./passFields";
import { extractStaffId, mapStaffEventToPatch } from "./staffProfile";
import { resolveTrainerByStaffId } from "./staffResolver";

export type WebhookRequest = {
  rawBody: string;
  signatureHeader: string | undefined;
};

export type WebhookResponse = {
  statusCode: 200 | 400 | 401 | 500;
  body?: string;
};

export type WebhookDeps = {
  firestore: Firestore;
  webhookSecret: string;
};

type CachedStudio = {
  id: string;
  siteId: string;
  locationId?: string;
  /** IANA zone the studio's wall-clock times are expressed in. */
  timeZone?: string;
};

let studiosCache: CachedStudio[] | null = null;
let lastCacheUpdate = 0;

/** Clears the module-level studio cache. Exported for tests. */
export function resetStudioCache(): void {
  studiosCache = null;
  lastCacheUpdate = 0;
}

async function getStudios(firestore: Firestore): Promise<CachedStudio[]> {
  const now = Date.now();
  if (!studiosCache || now - lastCacheUpdate > 60000) {
    // Cache for 1 minute
    const next: CachedStudio[] = [];
    const snap = await firestore.collection("studios").get();
    snap.forEach((doc) => {
      const data = doc.data();
      if (data.mindbodySiteId) {
        next.push({
          id: doc.id,
          siteId: String(data.mindbodySiteId).trim(),
          locationId:
            data.mindbodyLocationId !== undefined &&
            data.mindbodyLocationId !== null
              ? String(data.mindbodyLocationId).trim()
              : undefined,
          timeZone: isValidTimeZone(data.timezone)
            ? String(data.timezone).trim()
            : undefined,
        });
      }
    });
    studiosCache = next;
    lastCacheUpdate = now;
  }
  return studiosCache;
}

export type StudioResolution = {
  studioId?: string;
  /** True when several studios share the site and the event names no location. */
  ambiguous: boolean;
  /** True when NO studio claims this Mindbody site at all. */
  unmapped: boolean;
  /** Timezone of the resolved studio, for reading MindBody's naive times. */
  timeZone?: string;
};

async function resolveStudio(
  firestore: Firestore,
  siteId: string | number,
  locationId?: string | number,
): Promise<StudioResolution> {
  const studios = await getStudios(firestore);
  const site = String(siteId).trim();
  const onSite = studios.filter((s) => s.siteId === site);

  if (onSite.length === 0) return { ambiguous: false, unmapped: true };
  if (locationId !== undefined && locationId !== null && locationId !== "") {
    const loc = String(locationId).trim();
    const match = onSite.find((s) => s.locationId === loc);
    return match
      ? {
          studioId: match.id,
          ambiguous: false,
          unmapped: false,
          timeZone: match.timeZone,
        }
      : { ambiguous: true, unmapped: false };
  }

  if (onSite.length === 1)
    return {
      studioId: onSite[0].id,
      ambiguous: false,
      unmapped: false,
      timeZone: onSite[0].timeZone,
    };
  return { ambiguous: true, unmapped: false };
}

/**
 * Parses a Mindbody UTC datetime string into a Timestamp.
 *
 * Unlike the booking events -- whose times are naive studio wall-clock strings
 * and go through `wallClockToInstant` -- membership and contract events send
 * true UTC (`2018-03-20T00:00:00Z`). A missing zone designator is treated as
 * UTC rather than as the container's clock, so behaviour never depends on where
 * the function happens to run.
 */
export function toUtcTimestamp(value: unknown): Timestamp | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return Timestamp.fromDate(parsed);
}

/** Firestore map keys cannot contain path characters; Mindbody ids are numeric. */
function toMapKey(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const key = String(value).trim();
  if (!key || /[.~*/[\]]/.test(key)) return undefined;
  return key;
}

/**
 * The client document a Mindbody event belongs to. STRICT: always the canonical
 * path, never a document found by searching id fields.
 *
 * This used to fall back to a `mindbodyClientId`/`mindbodyId` field query so
 * commercial data would not land on an orphan record. That fallback is gone on
 * purpose: with one canonical location there is nothing to search for, and a
 * search could only ever return a stale document we have decided to ignore.
 */
function resolveClientRef(firestore: Firestore, clientId: string | number) {
  return firestore.collection("clients").doc(String(clientId).trim());
}

/**
 * Handles incoming Mindbody webhooks.
 * Validates the signature, ensures uniqueness via idempotency checks,
 * and updates client records directly in Firestore.
 */
export async function handleMindbodyWebhook(
  deps: WebhookDeps,
  req: WebhookRequest,
): Promise<WebhookResponse> {
  // Health reporting requires a real, non-negative latency figure; this used to
  // be hardcoded to 0, which made the Integrations Hub health card meaningless.
  const processingStartedAt = Date.now();
  const signature = req.signatureHeader || "";

  // 1. Strict Verification Guard
  if (!verifyMindbodySignature(req.rawBody, signature, deps.webhookSecret)) {
    await recordHealthEvent(deps.firestore, { type: "signature_failure" });
    return { statusCode: 401 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(req.rawBody);
  } catch (e) {
    return { statusCode: 400 };
  }

  // We use messageId or eventId as the tracking event ID.
  const eventId =
    typeof parsed.messageId === "string"
      ? parsed.messageId
      : typeof parsed.eventId === "string"
        ? parsed.eventId
        : undefined;
  const eventType =
    typeof parsed.eventId === "string"
      ? parsed.eventId
      : typeof parsed.eventName === "string"
        ? parsed.eventName
        : "unknown_event";

  if (typeof eventId !== "string" || !eventId.trim()) {
    return { statusCode: 400 };
  }

  // 2. Idempotency Check
  try {
    const { wasNew } = await tryRecordEvent(deps.firestore, eventId, eventType);
    if (!wasNew) {
      // Return 200 to satisfy Mindbody retry loop for duplicates
      return { statusCode: 200 };
    }
  } catch (e) {
    console.error("Idempotency check failed", e);
    return { statusCode: 500 };
  }

  // 3. Payload Mapping & Upsert
  try {
    // Navigate potentially nested payload structures
    const payloadData =
      (parsed.eventData as Record<string, unknown> | undefined) ||
      (parsed.eventInstance as Record<string, unknown> | undefined) ||
      parsed;

    // Safely extract required fields
    const clientId =
      typeof payloadData.clientId === "string" ||
      typeof payloadData.clientId === "number"
        ? payloadData.clientId
        : typeof parsed.clientId === "string" ||
            typeof parsed.clientId === "number"
          ? parsed.clientId
          : undefined;

    const siteId =
      typeof payloadData.siteId === "string" ||
      typeof payloadData.siteId === "number"
        ? payloadData.siteId
        : typeof parsed.siteId === "string" || typeof parsed.siteId === "number"
          ? parsed.siteId
          : undefined;

    // MindBody spells this differently across event types; any of them pins the
    // event to one physical studio.
    const rawLocationId =
      payloadData.locationId ??
      payloadData.LocationId ??
      (payloadData.location as Record<string, unknown> | undefined)?.id ??
      parsed.locationId;
    const locationId =
      typeof rawLocationId === "string" || typeof rawLocationId === "number"
        ? rawLocationId
        : undefined;

    const lowerType = eventType.toLowerCase();

    // Membership and contract events are checked first: they look like client
    // events, but their payloads carry none of the generic client fields and
    // must not fall through to the profile upsert.
    const isMembershipEvent = lowerType.includes("clientmembershipassignment");
    const isContractEvent = lowerType.includes("clientcontract");
    const isCommercialEvent = isMembershipEvent || isContractEvent;

    // Staff events are pulled out BEFORE the client test, and every branch
    // below is now a positive test rather than a leftover.
    //
    // `isClientEvent` used to be `!isBookingEvent && !isCommercialEvent` -- a
    // catch-all, not a test. A `staff.updated` event carries no clientId and
    // matches neither of the other two, so it fell into the CLIENT PROFILE
    // UPSERT: subscribing to staff events without this change would have
    // started writing staff records into the `clients` collection. Anything
    // matching no branch is now parked in limbo instead of guessed at, which
    // also covers every Mindbody event type nobody here has thought of yet.
    const isStaffEvent = lowerType.startsWith("staff.");

    const isBookingEvent =
      !isCommercialEvent &&
      !isStaffEvent &&
      (lowerType.includes("booking") || lowerType.includes("appointment"));
    //
    // Two ways to qualify, because neither alone is right:
    //
    //   the NAME contains "client" -- Mindbody sends "client.updated", and
    //     replayed or hand-built envelopes in this repo's tooling use names
    //     like "evt-client-updated"; and
    //   the payload NAMES a client -- so an unrecognised or future event that
    //     explicitly carries a clientId still reaches the person it is about,
    //     rather than becoming a limbo row nobody reads.
    //
    // The exclusions above are what carry the safety. Staff events never
    // carry a clientId and are excluded by name anyway, so neither door lets
    // one back into the client collection.
    const isClientEvent =
      !isCommercialEvent &&
      !isStaffEvent &&
      !isBookingEvent &&
      (lowerType.includes("client") || clientId !== undefined);

    if (isCommercialEvent && clientId) {
      const clientRef = resolveClientRef(deps.firestore, clientId);
      const isCancelEvent =
        lowerType.includes("cancel") || lowerType.includes("delete");
      const now = FieldValue.serverTimestamp();
      const updates: Record<string, unknown> = {};

      if (isMembershipEvent) {
        // `clientMembershipAssignment.cancelled` carries only siteId, clientId
        // and membershipId, so the record is merged, never replaced -- the name
        // captured at assignment time survives the cancel.
        const key = toMapKey(payloadData.membershipId);
        if (key) {
          const record: Record<string, unknown> = {
            membershipId: payloadData.membershipId,
            status: isCancelEvent ? "Cancelled" : "Active",
            lastSyncAt: now,
          };
          if (siteId !== undefined) record.siteId = siteId;
          if (
            typeof payloadData.membershipName === "string" &&
            payloadData.membershipName.trim()
          ) {
            record.membershipName = payloadData.membershipName.trim();
          }
          if (isCancelEvent) {
            record.cancelledAt = now;
          } else {
            record.assignedAt = now;
            // A re-assigned membership must not keep looking cancelled.
            record.cancelledAt = null;
          }
          updates.mindbodyMemberships = { [key]: record };
        } else {
          console.warn(
            `Mindbody webhook: membership event ${eventId} for client ${clientId} had no usable membershipId; skipping.`,
          );
        }
      }

      if (isContractEvent) {
        // Keyed on clientContractId -- the unique client + contract pairing.
        // One client can hold two instances of the same contractId.
        const key = toMapKey(payloadData.clientContractId);
        if (key) {
          const record: Record<string, unknown> = {
            clientContractId: payloadData.clientContractId,
            lastSyncAt: now,
            updatedAt: now,
          };
          if (siteId !== undefined) record.siteId = siteId;

          if (isCancelEvent) {
            // Deleted in Mindbody. We keep the record and flip its status so
            // the studio can still see what the client used to hold.
            record.status = "Cancelled";
            record.cancelledAt = now;
          } else {
            record.status = "Active";
            record.cancelledAt = null;

            // `.updated` (suspensions, terminations, date changes) omits
            // contractId and contractName, so those keys are only written when
            // the event actually carries them.
            if (payloadData.contractId !== undefined) {
              record.contractId = payloadData.contractId;
            }
            if (
              typeof payloadData.contractName === "string" &&
              payloadData.contractName.trim()
            ) {
              record.contractName = payloadData.contractName.trim();
            }
            if (typeof payloadData.isAutoRenewing === "boolean") {
              record.isAutoRenewing = payloadData.isAutoRenewing;
            }
            if (payloadData.contractOriginationLocation !== undefined) {
              record.originationLocationId =
                payloadData.contractOriginationLocation;
            }

            const soldBy = `${
              typeof payloadData.contractSoldByStaffFirstName === "string"
                ? payloadData.contractSoldByStaffFirstName
                : ""
            } ${
              typeof payloadData.contractSoldByStaffLastName === "string"
                ? payloadData.contractSoldByStaffLastName
                : ""
            }`.trim();
            if (soldBy) record.soldByStaffName = soldBy;

            const startDate = toUtcTimestamp(payloadData.contractStartDateTime);
            if (startDate) record.startDate = startDate;
            const endDate = toUtcTimestamp(payloadData.contractEndDateTime);
            if (endDate) record.endDate = endDate;
            const agreementDate = toUtcTimestamp(payloadData.agreementDateTime);
            if (agreementDate) record.agreementDate = agreementDate;

            if (lowerType.includes("created")) record.createdAt = now;
          }

          updates.mindbodyContracts = { [key]: record };
        } else {
          console.warn(
            `Mindbody webhook: contract event ${eventId} for client ${clientId} had no usable clientContractId; skipping.`,
          );
        }
      }

      // A merge write on nested maps leaves every other membership, contract
      // and profile field on the document untouched.
      if (Object.keys(updates).length > 0) {
        await clientRef.set(updates, { merge: true });
      }
    } else if (isClientEvent && clientId) {
      // Mindbody-owned facts. These always overwrite: Mindbody is the source of
      // truth for commercial status, and nobody types these in the app.
      const enrichment: Record<string, unknown> = {};

      if (typeof payloadData.membershipStatus === "string")
        enrichment.membershipStatus = payloadData.membershipStatus;
      if (typeof payloadData.tierName === "string")
        enrichment.packageTier = payloadData.tierName;
      if (
        typeof payloadData.activeMembership === "boolean" ||
        typeof payloadData.activeMembership === "string"
      )
        enrichment.activeMembership = payloadData.activeMembership;
      if (typeof payloadData.lastVisited === "string")
        enrichment.lastSessionDate = payloadData.lastVisited;
      if (Array.isArray(payloadData.prebookedSchedules))
        enrichment.prebookedSchedules = payloadData.prebookedSchedules;
      if (Array.isArray(payloadData.upcomingBookings))
        enrichment.upcomingBookings = payloadData.upcomingBookings;

      // Mindbody's account notes go to their OWN field. `notes` on a client doc
      // is trainer-authored and must never be overwritten by a sync.
      if (typeof payloadData.notes === "string" && payloadData.notes.trim()) {
        enrichment.mindbodyNotes = payloadData.notes.slice(0, 1000);
      }

      // --- Mindbody-owned identity & compliance facts -------------------
      //
      // Same posture as the commercial fields above: these OVERWRITE, because
      // nobody types them in this app and Mindbody is the system of record.
      // Each is written only when the event actually carries it, so a partial
      // payload never blanks a field that a previous event filled.
      //
      // Deliberately NOT mapped: creditCardLastFour, creditCardExpDate,
      // directDebitLastFour. Mindbody sends them; nothing in a coaching app
      // needs them, and persisting them puts PCI-adjacent data in a document
      // every trainer at the studio can read.

      if (typeof payloadData.isLiabilityReleased === "boolean") {
        enrichment.isLiabilityReleased = payloadData.isLiabilityReleased;
      }
      const liabilityAt = toUtcTimestamp(payloadData.liabilityAgreementDateTime);
      if (liabilityAt) enrichment.liabilityAgreementDate = liabilityAt;

      // `status` is the membership status. Studios can define custom values on
      // top of Mindbody's standard set, so it is stored as the free string it
      // is rather than being narrowed to an enum that a studio could break.
      if (typeof payloadData.status === "string" && payloadData.status.trim()) {
        enrichment.mindbodyStatus = payloadData.status.trim();
      }

      // Client indexes arrive as [{indexName, indexValue}]. They are flattened
      // to a map and written WHOLE rather than merged, so an index the studio
      // removed in Mindbody disappears here too instead of lingering forever.
      if (Array.isArray(payloadData.indexes)) {
        const indexes: Record<string, string> = {};
        for (const raw of payloadData.indexes) {
          const name =
            raw && typeof raw.indexName === "string" ? raw.indexName.trim() : "";
          const value =
            raw && typeof raw.indexValue === "string" ? raw.indexValue.trim() : "";
          if (name && value) indexes[name] = value;
        }
        enrichment.mindbodyIndexes = indexes;
      }

      const mbCreatedAt = toUtcTimestamp(payloadData.creationDateTime);
      if (mbCreatedAt) enrichment.mindbodyCreatedAt = mbCreatedAt;

      const firstAppt = toUtcTimestamp(payloadData.firstAppointmentDateTime);
      if (firstAppt) enrichment.firstAppointmentDate = firstAppt;

      if (
        typeof payloadData.homeLocation === "number" ||
        typeof payloadData.homeLocation === "string"
      ) {
        enrichment.mindbodyHomeLocationId = payloadData.homeLocation;
      }

      if (typeof payloadData.isProspect === "boolean") {
        enrichment.isProspect = payloadData.isProspect;
      }

      // Mindbody's own visit count. Kept distinct from this app's sessionCount
      // — the two will not agree and neither is wrong.
      if (
        typeof payloadData.clientNumberOfVisitsAtSite === "number" &&
        Number.isFinite(payloadData.clientNumberOfVisitsAtSite)
      ) {
        enrichment.clientsNumberOfVisitsAtSite =
          payloadData.clientNumberOfVisitsAtSite;
      }

      // A real client event supersedes any stub a booking created earlier.
      enrichment.isMindbodyStub = false;

      // Person-facts. These only ever FILL BLANKS on an existing profile.
      const pickString = (...keys: string[]): string | undefined => {
        for (const key of keys) {
          const v = payloadData[key];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
        return undefined;
      };

      const firstName = pickString("firstName", "FirstName", "clientFirstName");
      const lastName = pickString("lastName", "LastName", "clientLastName");

      const profile: MindbodyClientProfile = {
        firstName,
        lastName,
        email: pickString("email", "Email"),
        phone: pickString("mobilePhone", "homePhone", "workPhone", "phone"),
        dateOfBirth: pickString("birthDate", "birthDateTime", "dateOfBirth"),
        gender: pickString("gender"),
        address: pickString("addressLine1", "address"),
        emergencyContactName: pickString(
          "emergencyContactInfoName",
          "emergencyContactName",
        ),
        emergencyContactPhone: pickString(
          "emergencyContactInfoPhone",
          "emergencyContactPhone",
        ),
        city: pickString("city"),
        addressState: pickString("state"),
        postalCode: pickString("postalCode"),
        country: pickString("country"),
        referredBy: pickString("referredBy"),
      };

      if (firstName || lastName) {
        profile.mindbody_name = `${firstName || ""} ${lastName || ""}`.trim();
      }

      const rawPhoto = pickString("photoUrl");
      if (rawPhoto && /^https:\/\//i.test(rawPhoto)) {
        profile.photoUrl = rawPhoto;
      }

      let studioId: string | null = null;
      if (siteId) {
        const resolution = await resolveStudio(
          deps.firestore,
          siteId,
          locationId,
        );
        if (resolution.studioId) {
          studioId = resolution.studioId;
          // A client event is authoritative about which studio owns the person,
          // so it may reassign an existing homeStudioId (pre-existing behaviour).
          enrichment.homeStudioId = resolution.studioId;
        } else if (resolution.ambiguous) {
          // Reassigning a client's home studio decides who may view their
          // clinical record, so leave it alone rather than pick one.
          console.warn(
            `Mindbody webhook: site ${siteId} maps to multiple studios and the event named no resolvable location; leaving homeStudioId untouched for client ${clientId}.`,
          );
          await recordLimboEvent(deps.firestore, {
            eventId,
            eventType,
            kind: "client",
            siteId,
            locationId,
            clientId,
            reason:
              "Client profile saved, but its home studio is unset: the site is shared by several studios and the event named no resolvable location. Set mindbodyLocationId on each studio in Admin -> Studios.",
            payload: parsed,
          });
        } else if (resolution.unmapped) {
          // No studio claims this site. The client is still created so their
          // history starts accruing, but with homeStudioId null rather than a
          // guessed default — a mis-tenanted client shows on the wrong
          // location's schedule and is readable by the wrong trainers.
          console.warn(
            `Mindbody webhook: site ${siteId} maps to no studio; client ${clientId} created without a home studio.`,
          );
          await recordLimboEvent(deps.firestore, {
            eventId,
            eventType,
            kind: "client",
            siteId,
            locationId,
            clientId,
            reason:
              "Client profile saved, but its home studio is unset: no studio has this Mindbody site id. Set mindbodySiteId on the studio in Admin -> Studios, then re-run the pull-sync.",
            payload: parsed,
          });
        }
      }

      await ensureCanonicalClient(deps.firestore, {
        mindbodyClientId: clientId,
        profile,
        enrichment,
        studioId,
        origin: "client-event",
      });

    } else if (isBookingEvent) {
      const bookingId =
        typeof payloadData.id === "string" || typeof payloadData.id === "number"
          ? String(payloadData.id)
          : typeof payloadData.appointmentId === "string" ||
              typeof payloadData.appointmentId === "number"
            ? String(payloadData.appointmentId)
            : typeof payloadData.bookingId === "string" ||
                typeof payloadData.bookingId === "number"
              ? String(payloadData.bookingId)
              : eventId;

      const isCancelled =
        eventType.toLowerCase().includes("cancel") ||
        eventType.toLowerCase().includes("delete") ||
        (typeof payloadData.status === "string" &&
          payloadData.status.toLowerCase() === "cancelled");

      // Pass / waitlist / visit-count data, when Mindbody sends any of it.
      // Strictly additive: absent fields write nothing.
      const bookingExtras = extractBookingExtras(payloadData);

      const rawStart =
        payloadData.startDateTime || payloadData.startTime || payloadData.start;
      const rawEnd =
        payloadData.endDateTime || payloadData.endTime || payloadData.end;

      // Read before the studio is resolved: a booking that ends up parked in
      // Limbo still has to tell an admin WHO is arriving.
      let clientName = "";
      if (typeof payloadData.clientName === "string") {
        clientName = payloadData.clientName;
      } else if (
        typeof payloadData.firstName === "string" ||
        typeof payloadData.lastName === "string"
      ) {
        clientName =
          `${typeof payloadData.firstName === "string" ? payloadData.firstName : ""} ${typeof payloadData.lastName === "string" ? payloadData.lastName : ""}`.trim();
      } else if (
        typeof payloadData.clientFirstName === "string" ||
        typeof payloadData.clientLastName === "string"
      ) {
        clientName =
          `${typeof payloadData.clientFirstName === "string" ? payloadData.clientFirstName : ""} ${typeof payloadData.clientLastName === "string" ? payloadData.clientLastName : ""}`.trim();
      }

      // Resolved before the times are read: MindBody's wall-clock strings are
      // meaningless without knowing which studio's clock they belong to.
      let studioId: string | null = null;
      let studioTimeZone = DEFAULT_TIME_ZONE;
      if (siteId) {
        const resolution = await resolveStudio(
          deps.firestore,
          siteId,
          locationId,
        );
        if (resolution.studioId) {
          studioId = resolution.studioId;
          if (resolution.timeZone) studioTimeZone = resolution.timeZone;
        } else if (resolution.ambiguous || resolution.unmapped) {
          // The booking is PARKED, not dropped. It must not reach `schedules`:
          // a row with a null studioId is treated as "belongs to everyone" by
          // the hub's studio filter and would surface on every location's grid,
          // and a row filed under a guessed studio would show on the wrong
          // roster. Limbo keeps it visible to an admin without either failure.
          //
          // NOTE ON TIMES: Mindbody sends naive wall-clock strings. Without a
          // studio there is no timezone to read them against, so the RAW
          // strings are stored, unconverted. Guessing UTC here would park the
          // booking at the wrong hour and it would stay wrong after linking.
          console.warn(
            `Mindbody webhook: parking booking ${bookingId} in ${LIMBO_QUEUE} — site ${siteId}${
              locationId !== undefined ? ` / location ${locationId}` : ""
            } ${resolution.unmapped ? "maps to no studio" : "does not resolve to a single studio"}.`,
          );
          await recordLimboEvent(deps.firestore, {
            eventId,
            eventType,
            kind: "booking",
            siteId,
            locationId,
            clientId,
            reason: resolution.unmapped
              ? "Booking parked: no studio has this Mindbody site id. Set mindbodySiteId in Admin -> Studios, then run Refresh Schedule to release it onto the roster."
              : "Booking parked: site is shared by several studios and the event named no resolvable location. Set mindbodyLocationId in Admin -> Studios, then run Refresh Schedule to release it onto the roster.",
            summary: {
              bookingId,
              clientName: clientName || "Unknown Client",
              // Raw, unconverted — see the note above.
              rawStartDateTime: typeof rawStart === "string" ? rawStart : null,
              rawEndDateTime: typeof rawEnd === "string" ? rawEnd : null,
              staffName:
                typeof payloadData.staffName === "string"
                  ? payloadData.staffName
                  : typeof payloadData.trainerName === "string"
                    ? payloadData.trainerName
                    : null,
              serviceName:
                typeof payloadData.serviceName === "string"
                  ? payloadData.serviceName
                  : null,
              status: isCancelled ? "Cancelled" : "Scheduled",
            },
            payload: parsed,
          });
          await recordHealthEvent(deps.firestore, {
            type: "webhook_success",
            hydrationLatencyMs: Math.max(0, Date.now() - processingStartedAt),
          });
          return { statusCode: 200 };
        }
      }

      // Now that the owning studio is known, read its wall clock.
      const startDate = wallClockToInstant(rawStart, studioTimeZone);
      const endDate = wallClockToInstant(rawEnd, studioTimeZone);
      const startTime: Timestamp | null = startDate
        ? Timestamp.fromDate(startDate)
        : null;
      const endTime: Timestamp | null = endDate
        ? Timestamp.fromDate(endDate)
        : null;

      if (!clientName && clientId) {
        const clientSnap = await deps.firestore
          .collection("clients")
          .doc(String(clientId))
          .get();
        if (clientSnap.exists) {
          const cData = clientSnap.data();
          if (cData) {
            clientName =
              `${cData.firstName || ""} ${cData.lastName || ""}`.trim();
          }
        }
      }

      if (!clientName) {
        clientName = "Unknown Client";
      }

      let trainerId: string | null = null;
      let trainerName = "";
      if (typeof payloadData.staffName === "string") {
        trainerName = payloadData.staffName;
      } else if (typeof payloadData.instructorName === "string") {
        trainerName = payloadData.instructorName;
      } else if (typeof payloadData.teacherName === "string") {
        trainerName = payloadData.teacherName;
      } else if (typeof payloadData.trainerName === "string") {
        trainerName = payloadData.trainerName;
      }

      if (trainerName) {
        const trainersSnap = await deps.firestore.collection("trainers").get();
        const normalized = trainerName.trim().toLowerCase();
        trainersSnap.forEach((docSnap) => {
          const tData = docSnap.data();
          if (
            tData.fullName &&
            tData.fullName.trim().toLowerCase() === normalized
          ) {
            trainerId = docSnap.id;
          } else if (
            tData.nickname &&
            tData.nickname.trim().toLowerCase() === normalized
          ) {
            trainerId = docSnap.id;
          }
        });
      }

      const serviceName =
        typeof payloadData.serviceName === "string"
          ? payloadData.serviceName
          : typeof payloadData.sessionType === "string"
            ? payloadData.sessionType
            : typeof payloadData.className === "string"
              ? payloadData.className
              : "Training Session";

      const scheduleData: Record<string, unknown> = {
        clientName,
        trainerName,
        trainerId,
        studioId,
        startTime,
        endTime,
        status: isCancelled ? "Cancelled" : "Scheduled",
        serviceName,
        source: "MindBody",
        mindbodyAppointmentId: bookingId,
        lastSyncAt: FieldValue.serverTimestamp(),
      };

      // Trainers see pass state on the block; only written when reported, so a
      // payload without pass data never blanks out what a previous one set.
      if (bookingExtras.pass) scheduleData.mindbodyPass = bookingExtras.pass;
      if (bookingExtras.bookingOriginatedFromWaitlist !== undefined) {
        scheduleData.bookingOriginatedFromWaitlist =
          bookingExtras.bookingOriginatedFromWaitlist;
      }

      if (clientId) {
        // ORDERING HAZARD: a booking can arrive before the client.created event
        // for a brand-new client. Rather than write a clientId that points at
        // nothing (which the hub self-heals to null, producing an unlinked
        // block a trainer has to fix by hand), create a stub profile now. The
        // client event enriches it moments later and clears isMindbodyStub.
        //
        // The doc id this returns is used verbatim: if the client still lives
        // at a legacy doc id, the schedule must point THERE, not at a canonical
        // path that does not exist yet.
        const resolvedClient = await ensureCanonicalClient(deps.firestore, {
          mindbodyClientId: clientId,
          profile: {
            mindbody_name: clientName !== "Unknown Client" ? clientName : undefined,
            firstName:
              clientName !== "Unknown Client"
                ? clientName.split(" ")[0]
                : undefined,
            lastName:
              clientName !== "Unknown Client"
                ? clientName.split(" ").slice(1).join(" ") || undefined
                : undefined,
          },
          studioId,
          origin: "booking-stub",
          // Mindbody's own lifetime visit count for this client at the site.
          enrichment:
            bookingExtras.clientsNumberOfVisitsAtSite !== undefined
              ? {
                  clientsNumberOfVisitsAtSite:
                    bookingExtras.clientsNumberOfVisitsAtSite,
                }
              : undefined,
        });
        scheduleData.clientId = resolvedClient.clientDocId;
        scheduleData.mindbodyClientId = String(clientId);
      }

      const scheduleRef = deps.firestore.collection("schedules").doc(bookingId);
      const existingDoc = await scheduleRef.get();
      if (!existingDoc.exists) {
        scheduleData.createdAt = FieldValue.serverTimestamp();
      }

      await scheduleRef.set(scheduleData, { merge: true });
    } else if (isStaffEvent) {
      const staffId = extractStaffId(parsed);

      if (!staffId) {
        await recordLimboEvent(deps.firestore, {
          eventId,
          eventType,
          kind: "staff",
          siteId,
          locationId,
          reason:
            "Staff event carried no staff id, so there is nothing to match a trainer on.",
          payload: parsed,
        });
      } else {
        const resolution = await resolveTrainerByStaffId(deps.firestore, staffId);

        if (resolution.kind === "matched") {
          const { mindbody, deactivated } = mapStaffEventToPatch(parsed, eventType);

          // ONLY the `mindbody` map. Not role, not pinHash, not studio access,
          // not the Kaizen Roster. Mindbody owns the staff member's name,
          // work email and photo; the Journey System owns everything that
          // decides what they can do.
          //
          // Deactivation is reported, never enforced: `mindbody.isActive`
          // goes false and the profile says so loudly, but nobody's access is
          // revoked by a webhook. Removing a trainer's access is a decision a
          // human makes, and a mis-mapped staff id must not be able to lock
          // someone out mid-session.
          await deps.firestore
            .collection("trainers")
            .doc(resolution.trainerId)
            .set(
              { mindbody: { ...mindbody, lastSyncAt: FieldValue.serverTimestamp() } },
              { merge: true },
            );

          if (deactivated) {
            console.warn(
              `Mindbody webhook: staff ${staffId} was deactivated in Mindbody; trainer ${resolution.trainerId} flagged but access left unchanged.`,
            );
          }
        } else {
          await recordLimboEvent(deps.firestore, {
            eventId,
            eventType,
            kind: "staff",
            siteId,
            locationId,
            reason:
              resolution.kind === "ambiguous"
                ? `Mindbody staff id ${staffId} is claimed by more than one trainer (${resolution.trainerIds.join(", ")}). Fix the duplicate in Admin -> Trainers; nothing was written.`
                : `No trainer carries Mindbody staff id ${staffId}. Link them in Edit Trainer -> Mindbody Staff ID; a webhook never creates a trainer account.`,
            summary: { staffId },
            payload: parsed,
          });
        }
      }
    } else {
      // No branch claimed it. Park it rather than drop it.
      await recordLimboEvent(deps.firestore, {
        eventId,
        eventType,
        kind: isClientEvent || isCommercialEvent ? "client" : "unhandled",
        siteId,
        locationId,
        reason:
          isClientEvent || isCommercialEvent
            ? "Event carried no client id, so it could not be filed against a client."
            : `No handler for event type "${eventType}". Recorded so a new Mindbody event type surfaces instead of vanishing.`,
        payload: parsed,
      });
    }

    await recordHealthEvent(deps.firestore, {
      type: "webhook_success",
      hydrationLatencyMs: Math.max(0, Date.now() - processingStartedAt),
    });
    return { statusCode: 200 };

    // 4. Resiliency & Edge Errors
  } catch (error) {
    console.error("Webhook processing error:", { error: String(error) });

    await recordHealthEvent(deps.firestore, { type: "webhook_failure" });

    // The idempotency record was committed before this business logic ran, so
    // without a release the retry would be waved through as a duplicate and the
    // event lost. recordAttemptFailure either frees the gate for another
    // attempt or, once the budget is spent, dead-letters the event.
    try {
      const { willRetry, attempts } = await recordAttemptFailure(deps.firestore, {
        messageId: eventId,
        eventType,
        payload: parsed,
        error,
      });
      if (!willRetry) {
        console.error(
          `Mindbody webhook: event ${eventId} (${eventType}) dead-lettered after ${attempts} attempts.`,
        );
        // 200 stops the retry storm for an event we have given up on; it is
        // preserved in mindbodyDLQ for a human.
        return { statusCode: 200 };
      }
    } catch (ledgerError) {
      console.error(
        "Mindbody webhook: retry ledger failed; falling back to a plain 500.",
        ledgerError,
      );
    }

    // Catch errors without silently swallowing them
    return { statusCode: 500 };
  }
}

const mindbodyWebhookSecret = defineSecret("MINDBODY_WEBHOOK_SECRET");
let firestoreInstance: Firestore | null = null;

/**
 * The expected public entry point for Mindbody webhooks.
 * Wires the pure HTTP handler logic to Firebase, Pub/Sub, and secret parameters.
 * Lazy initialization is used for external clients.
 */
export const mindbodyWebhook = onRequest(
  {
    secrets: [mindbodyWebhookSecret],
    cors: false,
    region: "us-central1",
    maxInstances: 100,
    timeoutSeconds: 10,
  },
  async (req, res) => {
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    if (!firestoreInstance) {
      firestoreInstance = getFirestore(
        "ai-studio-32cbbdcc-6e08-4770-9665-867c68878efa",
      );
    }

    const payloadBuffer = req.rawBody; // req.rawBody is a Buffer natively in firebase-functions
    const rawBodyStr = payloadBuffer ? payloadBuffer.toString("utf8") : "";

    const deps: WebhookDeps = {
      firestore: firestoreInstance,
      webhookSecret: mindbodyWebhookSecret.value(),
    };

    const webhookReq: WebhookRequest = {
      rawBody: rawBodyStr,
      signatureHeader: req.header("x-mindbody-signature"),
    };

    const response = await handleMindbodyWebhook(deps, webhookReq);
    res.status(response.statusCode).send(response.body || "");
  },
);
