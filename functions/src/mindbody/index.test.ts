import { describe, it, expect, vi, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import {
  handleMindbodyWebhook,
  resetStudioCache,
  toUtcTimestamp,
  WebhookRequest,
  WebhookDeps,
} from "./index";
import { recordHealthEvent } from "./healthState";
import { tryRecordEvent } from "./idempotency";
import { Firestore, Timestamp } from "firebase-admin/firestore";

vi.mock("./healthState", () => ({
  recordHealthEvent: vi.fn(),
}));

vi.mock("./idempotency", () => ({
  tryRecordEvent: vi.fn(),
}));

function signForTest(body: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
}

const mockSecret = "test_secret_123";

function createValidEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    messageId: "msg-f47ac10b-58cc-4372-a567-0e02b2c3d479",
    eventId: "evt-client-updated",
    eventSchemaVersion: 1,
    eventInstanceOriginationDateTime: "2024-01-01T12:00:00Z",
    eventData: {
      siteId: 99999,
      clientId: 12345,
      membershipStatus: "Active",
      tierName: "12-Pack",
      lastVisited: "2024-01-13T10:00:00Z",
    },
    ...overrides,
  });
}

describe("handleMindbodyWebhook (Inline Upsert)", () => {
  let deps: WebhookDeps;
  let mockSet: ReturnType<typeof vi.fn>;
  // Per-test studio roster; the default is a single studio owning site 99999.
  let studioDocs: Array<{ id: string; data: () => Record<string, unknown> }>;
  // Every set() the handler performed, tagged with its collection.
  let writes: Array<{
    collection: string;
    id: string;
    data: any;
    options: any;
  }>;
  const writesTo = (collection: string) =>
    writes.filter((w) => w.collection === collection);
  // Docs returned by a `clients.where(...)` lookup -- empty unless a test is
  // exercising the fallback match onto an app-created (random id) client doc.
  let clientQueryDocs: Array<{ id: string; ref: unknown }>;
  // Trainer roster for `trainers.where("mindbodyStaffId", ...)`. Staff events
  // resolve a trainer by field query rather than by doc id, because a trainer
  // document id is the Firebase Auth uid.
  let trainerDocs: Array<{ id: string; mindbodyStaffId?: unknown }>;

  beforeEach(() => {
    vi.clearAllMocks();
    // The studio lookup is cached at module scope for 60s, which would otherwise
    // leak one test's roster into the next.
    resetStudioCache();

    studioDocs = [
      { id: "studio-123", data: () => ({ mindbodySiteId: 99999 }) },
    ];

    clientQueryDocs = [];
    trainerDocs = [{ id: "trainer-abc", mindbodyStaffId: "100000012" }];

    writes = [];
    mockSet = vi.fn().mockResolvedValue(undefined);
    // Writes are recorded WITH their collection. The webhook now writes to more
    // than one place per event (a client profile plus, on an unresolvable site,
    // a quarantine record), so "was anything written" is no longer a useful
    // assertion — "what was written to schedules" is.
    const mockDoc = (collectionName: string) =>
      vi.fn((id: string) => ({
        id,
        set: vi.fn(async (data: any, options: any) => {
          writes.push({ collection: collectionName, id, data, options });
          return (mockSet as (...args: any[]) => any)(data, options);
        }),
        get: vi.fn().mockResolvedValue({
          exists: false,
          data: () => undefined,
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      }));
    const mockCollection = vi.fn((path: string) => {
      if (path === "studios") {
        return {
          get: vi.fn().mockResolvedValue({
            forEach: (cb: any) => studioDocs.forEach((d) => cb(d)),
          }),
        };
      }
      if (path === "trainers") {
        const buildQuery = (matches: typeof trainerDocs) => ({
          where: (field: string, _op: string, value: unknown) =>
            buildQuery(matches.filter((t) => (t as any)[field] === value)),
          limit: (n: number) => buildQuery(matches.slice(0, n)),
          get: vi.fn().mockResolvedValue({
            size: matches.length,
            empty: matches.length === 0,
            docs: matches.map((t) => ({ id: t.id, data: () => t })),
            forEach: (cb: any) =>
              matches.forEach((t) => cb({ id: t.id, data: () => t })),
          }),
        });
        return {
          ...buildQuery(trainerDocs),
          // The booking handler lists every trainer to fuzzy-match a name.
          get: vi.fn().mockResolvedValue({
            forEach: (cb: any) =>
              cb({ id: "trainer-abc", data: () => ({ fullName: "Marina" }) }),
          }),
          doc: mockDoc("trainers"),
        };
      }
      return {
        doc: mockDoc(path),
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: clientQueryDocs,
              empty: clientQueryDocs.length === 0,
            }),
          })),
        })),
      };
    });

    deps = {
      firestore: {
        collection: mockCollection,
        // The retry ledger runs a transaction on every processing failure.
        // Without this the ledger threw and the handler fell back to a plain
        // 500, so the release-and-dead-letter path was never exercised here.
        runTransaction: vi.fn(async (cb: any) =>
          cb({
            get: vi.fn().mockResolvedValue({
              exists: false,
              data: () => undefined,
            }),
            set: vi.fn(),
          }),
        ),
      } as unknown as Firestore,
      webhookSecret: mockSecret,
    };

    vi.mocked(tryRecordEvent).mockResolvedValue({ wasNew: true });
  });

  it("1. Valid signature + new event + clientId in eventData -> returns 200, writes to Firestore", async () => {
    const rawBody = createValidEnvelope();
    const signatureHeader = signForTest(rawBody, mockSecret);
    const req: WebhookRequest = { rawBody, signatureHeader };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(200);
    expect(tryRecordEvent).toHaveBeenCalledWith(
      deps.firestore,
      "msg-f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "evt-client-updated",
    );

    // A client event now creates a COMPLETE profile rather than the handful of
    // enrichment fields it used to write, so this asserts the Mindbody-owned
    // values AND that nothing required by the app's Client type is missing.
    const clientWrites = writesTo("clients");
    expect(clientWrites).toHaveLength(1);
    expect(clientWrites[0].id).toBe("12345");
    expect(clientWrites[0].data).toMatchObject({
      membershipStatus: "Active",
      packageTier: "12-Pack",
      lastSessionDate: "2024-01-13T10:00:00Z",
      homeStudioId: "studio-123",
      mindbodyClientId: "12345",
      isActive: true,
      height: "",
      remainingSessions: 0,
      sessionCount: 0,
      isMindbodyStub: false,
    });
    // This payload carries no name at all, so a placeholder identifies the row.
    expect(clientWrites[0].data.firstName).toBe("Mindbody");
    expect(clientWrites[0].data.lastName).toBe("Client 12345");
    // ...and an empty display name is omitted rather than stored blank.
    expect(clientWrites[0].data).not.toHaveProperty("mindbody_name");
    expect(clientWrites[0].options).toEqual({ merge: true });
  });

  it("2. Valid signature + duplicate event (wasNew: false) -> returns 200, no write", async () => {
    vi.mocked(tryRecordEvent).mockResolvedValue({ wasNew: false });

    const rawBody = createValidEnvelope();
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(200);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("3. Invalid signature -> returns 401, records signature_failure", async () => {
    const rawBody = createValidEnvelope();
    const req: WebhookRequest = { rawBody, signatureHeader: "bad_sig" };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(401);
    expect(recordHealthEvent).toHaveBeenCalledWith(deps.firestore, {
      type: "signature_failure",
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("4. Missing signature header -> returns 401, records signature_failure", async () => {
    const rawBody = createValidEnvelope();
    const req: WebhookRequest = { rawBody, signatureHeader: undefined };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(401);
    expect(recordHealthEvent).toHaveBeenCalledWith(deps.firestore, {
      type: "signature_failure",
    });
  });

  it("5. Malformed JSON body -> returns 400, no health event", async () => {
    const rawBody = "{ bad json";
    const signatureHeader = signForTest(rawBody, mockSecret);
    const req: WebhookRequest = { rawBody, signatureHeader };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(400);
    expect(recordHealthEvent).not.toHaveBeenCalled();
  });

  it("6. Valid signature but missing BOTH messageId and eventId -> returns 400", async () => {
    const rawBody = createValidEnvelope({
      messageId: undefined,
      eventId: undefined,
    });
    const signatureHeader = signForTest(rawBody, mockSecret);
    const req: WebhookRequest = { rawBody, signatureHeader };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(400);
  });

  it("7. Valid signature + event without clientId anywhere -> returns 200, parked not filed", async () => {
    const rawBody = createValidEnvelope({ eventData: { siteId: 99999 } }); // No clientId
    const signatureHeader = signForTest(rawBody, mockSecret);
    const req: WebhookRequest = { rawBody, signatureHeader };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(200);
    // No client can be written -- there is no id to write it against.
    expect(writesTo("clients")).toHaveLength(0);
    // But it is no longer dropped on the floor either: a client event with no
    // client id is malformed data an admin should see, so it lands in limbo.
    const [parked] = writesTo("mindbodyLimbo");
    expect(parked.data.kind).toBe("client");
    expect(parked.data.reason).toContain("no client id");
  });

  it("8. Valid signature + Firestore set throws -> returns 500, records webhook_failure", async () => {
    mockSet.mockRejectedValue(new Error("Firestore error"));
    const rawBody = createValidEnvelope();
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(500);
    expect(recordHealthEvent).toHaveBeenCalledWith(deps.firestore, {
      type: "webhook_failure",
    });
  });

  it("9. Valid signature + tryRecordEvent throws -> returns 500", async () => {
    vi.mocked(tryRecordEvent).mockRejectedValue(new Error("Idempotency error"));

    const rawBody = createValidEnvelope();
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(500);
  });

  it("10. Extracts fields properly when placed at top level (partial payload)", async () => {
    const rawBodyObj = {
      messageId: "msg-custom-001",
      clientId: 999,
      firstName: "Alice",
      upcomingBookings: ["booking-1"],
    };
    const rawBody = JSON.stringify(rawBodyObj);
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    await handleMindbodyWebhook(deps, req);

    const [write] = writesTo("clients");
    expect(write.data).toMatchObject({
      mindbody_name: "Alice",
      firstName: "Alice",
      upcomingBookings: ["booking-1"],
    });
    // A first name with no surname must NOT get "Client 999" as a last name —
    // that would read as the person's actual surname throughout the app.
    expect(write.data.lastName).toBe("");
    // No siteId in this payload, so no studio may be guessed.
    expect(write.data.homeStudioId).toBeNull();
  });

  it("10a. client.created payload writes mindbodyNotes and photoUrl, never trainer notes", async () => {
    const photo =
      "https://clients.mindbodyonline.com/studios/ACMEYoga/clients/100000009_large.jpg?osv=637136734414821811";
    const rawBody = createValidEnvelope({
      eventId: "client.created",
      eventData: {
        siteId: 99999,
        clientId: "100000009",
        firstName: "John",
        lastName: "Smith",
        notes: "Notes about the client.",
        photoUrl: photo,
      },
    });
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);
    expect(response.statusCode).toBe(200);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const [written, opts] = mockSet.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(written.mindbodyNotes).toBe("Notes about the client.");
    expect(written.photoUrl).toBe(photo);
    // The trainer-authored `notes` field must never be written by the webhook.
    expect(written).not.toHaveProperty("notes");
  });

  it("10b. Mindbody notes are capped at 1000 characters", async () => {
    const rawBody = createValidEnvelope({
      eventId: "client.updated",
      eventData: {
        siteId: 99999,
        clientId: "100000009",
        notes: "x".repeat(1500),
      },
    });
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    await handleMindbodyWebhook(deps, req);

    const [written] = mockSet.mock.calls[0];
    expect(written.mindbodyNotes).toHaveLength(1000);
  });

  it("10c. Blank notes and non-HTTPS photoUrl are ignored", async () => {
    const rawBody = createValidEnvelope({
      eventId: "client.updated",
      eventData: {
        siteId: 99999,
        clientId: "100000009",
        notes: "   ",
        photoUrl: "javascript:alert(1)",
      },
    });
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    await handleMindbodyWebhook(deps, req);

    const [written] = mockSet.mock.calls[0];
    expect(written).not.toHaveProperty("mindbodyNotes");
    expect(written).not.toHaveProperty("photoUrl");
    expect(written).not.toHaveProperty("notes");
  });

  it("11. Booking created event maps and writes to schedules collection", async () => {
    const rawBodyObj = {
      messageId: "booking-msg-001",
      eventId: "appointmentBooking.created",
      eventData: {
        siteId: 99999,
        clientId: "client-123",
        id: "booking-abc",
        clientName: "Alice Smith",
        staffName: "Marina",
        startDateTime: "2024-01-13T10:00:00Z",
        endDateTime: "2024-01-13T11:00:00Z",
        serviceName: "Semi-Private Training",
      },
    };
    const rawBody = JSON.stringify(rawBodyObj);
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Alice Smith",
        trainerName: "Marina",
        trainerId: "trainer-abc",
        studioId: "studio-123",
        status: "Scheduled",
        serviceName: "Semi-Private Training",
        source: "MindBody",
        clientId: "client-123",
      }),
      { merge: true },
    );
  });

  it("12. Booking cancelled event maps and updates status to Cancelled", async () => {
    const rawBodyObj = {
      messageId: "booking-msg-002",
      eventId: "appointmentBooking.cancelled",
      eventData: {
        siteId: 99999,
        clientId: "client-123",
        id: "booking-abc",
        clientName: "Alice Smith",
        staffName: "Marina",
        startDateTime: "2024-01-13T10:00:00Z",
        endDateTime: "2024-01-13T11:00:00Z",
        serviceName: "Semi-Private Training",
      },
    };
    const rawBody = JSON.stringify(rawBodyObj);
    const req: WebhookRequest = {
      rawBody,
      signatureHeader: signForTest(rawBody, mockSecret),
    };

    const response = await handleMindbodyWebhook(deps, req);

    expect(response.statusCode).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "Cancelled",
      }),
      { merge: true },
    );
  });

  describe("multiple studios sharing one MindBody site", () => {
    // Solon is listed first and Westlake last on purpose: the old site-keyed
    // lookup collapsed to whichever studio was iterated last, so a test that
    // expects Solon fails against that bug instead of matching it by accident.
    const sharedSite = [
      {
        id: "studio-solon",
        data: () => ({ mindbodySiteId: 99999, mindbodyLocationId: 2 }),
      },
      {
        id: "studio-westlake",
        data: () => ({ mindbodySiteId: 99999, mindbodyLocationId: 1 }),
      },
    ];

    it("13. Booking with a location resolves to that location's studio, not the first on the site", async () => {
      studioDocs = [...sharedSite];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-013",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          locationId: 2,
          clientId: "client-123",
          id: "booking-solon",
          clientName: "Alice Smith",
          startDateTime: "2024-01-13T10:00:00Z",
          endDateTime: "2024-01-13T11:00:00Z",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      const response = await handleMindbodyWebhook(deps, req);

      expect(response.statusCode).toBe(200);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ studioId: "studio-solon" }),
        { merge: true },
      );
    });

    it("14. Booking on a shared site with no location is parked in Limbo, not misfiled", async () => {
      studioDocs = [...sharedSite];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-014",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          clientId: "client-123",
          id: "booking-unknown",
          clientName: "Alice Smith",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      const response = await handleMindbodyWebhook(deps, req);

      expect(response.statusCode).toBe(200);
      // The booking is PARKED, not dropped: nothing reaches schedules (a null
      // studioId would leak it onto every location's grid) and no client is
      // created, but the event is preserved in Limbo for an admin.
      expect(writesTo("schedules")).toHaveLength(0);
      expect(writesTo("clients")).toHaveLength(0);
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data).toMatchObject({
        kind: "booking",
        resolvedAt: null,
      });
      // The admin has to be able to see who is arriving without opening the
      // raw payload.
      expect(parked.data.summary).toMatchObject({
        bookingId: "booking-unknown",
        clientName: "Alice Smith",
      });
    });

    it("15. Booking naming a location no studio owns is parked in Limbo", async () => {
      studioDocs = [...sharedSite];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-015",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          locationId: 7,
          clientId: "client-123",
          id: "booking-orphan",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      const response = await handleMindbodyWebhook(deps, req);

      expect(response.statusCode).toBe(200);
      expect(writesTo("schedules")).toHaveLength(0);
      expect(writesTo("clients")).toHaveLength(0);
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data).toMatchObject({
        kind: "booking",
        siteId: "99999",
        locationId: "7",
        resolvedAt: null,
      });
      expect(parked.data.summary.bookingId).toBe("booking-orphan");
    });

    it("13b. Pass, waitlist and visit data land on the right documents when sent", async () => {
      const rawBody = JSON.stringify({
        messageId: "booking-msg-013b",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          clientId: "client-123",
          id: "booking-pass",
          clientName: "Alice Smith",
          startDateTime: "2026-08-18T07:00:00",
          endDateTime: "2026-08-18T07:30:00",
          clientPassId: "pass-9",
          clientPassSessionsTotal: 24,
          clientPassSessionsDeducted: 9,
          clientPassSessionsRemaining: 15,
          clientPassActivationDateTime: "2026-01-01T00:00:00Z",
          clientPassExpirationDateTime: "2026-12-31T00:00:00Z",
          bookingOriginatedFromWaitlist: true,
          clientsNumberOfVisitsAtSite: 87,
        },
      });

      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);

      // Pass + waitlist belong to the BOOKING.
      const [schedule] = writesTo("schedules");
      expect(schedule.data.mindbodyPass).toEqual({
        passId: "pass-9",
        sessionsTotal: 24,
        sessionsDeducted: 9,
        sessionsRemaining: 15,
        activationDateTime: "2026-01-01T00:00:00Z",
        expirationDateTime: "2026-12-31T00:00:00Z",
      });
      expect(schedule.data.bookingOriginatedFromWaitlist).toBe(true);

      // The lifetime visit count belongs to the CLIENT.
      const [client] = writesTo("clients");
      expect(client.data.clientsNumberOfVisitsAtSite).toBe(87);
    });

    it("13c. A booking without pass data writes no pass keys at all", async () => {
      // The expected case for 1:1 appointments. An absent field must not blank
      // out what a previous event or the pull-sync already stored.
      const rawBody = JSON.stringify({
        messageId: "booking-msg-013c",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          clientId: "client-123",
          id: "booking-nopass",
          clientName: "Alice Smith",
          startDateTime: "2026-08-18T07:00:00",
        },
      });

      await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      const [schedule] = writesTo("schedules");
      expect(schedule.data).not.toHaveProperty("mindbodyPass");
      expect(schedule.data).not.toHaveProperty("bookingOriginatedFromWaitlist");
      const [client] = writesTo("clients");
      expect(client.data).not.toHaveProperty("clientsNumberOfVisitsAtSite");
    });

    it("15b. A parked booking keeps Mindbody's raw wall-clock times, unconverted", async () => {
      studioDocs = [...sharedSite];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-015b",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          clientId: "client-123",
          id: "booking-timed",
          clientName: "Alice Smith",
          staffName: "Marina",
          startDateTime: "2026-08-18T07:00:00",
          endDateTime: "2026-08-18T07:30:00",
        },
      });

      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      const [parked] = writesTo("mindbodyLimbo");
      // With no studio there is no timezone to read a naive time against.
      // Storing a guessed UTC value would park the booking hours off, and it
      // would still be wrong after an admin links it.
      expect(parked.data.summary).toMatchObject({
        rawStartDateTime: "2026-08-18T07:00:00",
        rawEndDateTime: "2026-08-18T07:30:00",
        clientName: "Alice Smith",
        staffName: "Marina",
        status: "Scheduled",
      });
    });

    it("16. Client event on a shared site leaves homeStudioId untouched", async () => {
      studioDocs = [...sharedSite];

      const rawBody = createValidEnvelope();
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      const response = await handleMindbodyWebhook(deps, req);

      expect(response.statusCode).toBe(200);
      // Membership fields still sync; only the studio assignment is withheld.
      // The event is also quarantined so an admin can map the location.
      const clientWrites = writesTo("clients");
      expect(clientWrites).toHaveLength(1);
      expect(clientWrites[0].data).toMatchObject({ membershipStatus: "Active" });
      // A brand-new client doc is created with a null studio rather than a
      // guessed one; what must never happen is it being filed under a studio.
      expect(clientWrites[0].data.homeStudioId).toBeNull();
      // The profile is saved either way; Limbo records that its studio is unset.
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data).toMatchObject({ kind: "client", resolvedAt: null });
    });

    it("18. Booking times are read on the studio clock, not the host's UTC", async () => {
      // The studio declares Eastern; MindBody sends naive site-local time.
      studioDocs = [
        {
          id: "studio-solon",
          data: () => ({
            mindbodySiteId: 99999,
            mindbodyLocationId: 2,
            timezone: "America/New_York",
          }),
        },
      ];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-018",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          locationId: 2,
          clientId: "client-123",
          id: "booking-tz",
          clientName: "Alice Smith",
          startDateTime: "2026-08-18T07:00:00",
          endDateTime: "2026-08-18T07:30:00",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      await handleMindbodyWebhook(deps, req);

      // A booking now also creates a stub client, so the schedule write is no
      // longer the first one — select it by collection instead of by order.
      const [scheduleWrite] = writesTo("schedules");
      const written = scheduleWrite.data;
      // 07:00 Eastern in August is 11:00 UTC. Storing 07:00 UTC would place the
      // booking at 3 AM on the studio's own roster.
      expect(written.startTime.toDate().toISOString()).toBe(
        "2026-08-18T11:00:00.000Z",
      );
      expect(written.endTime.toDate().toISOString()).toBe(
        "2026-08-18T11:30:00.000Z",
      );
    });

    it("19. Falls back to Eastern when the studio has no timezone set", async () => {
      studioDocs = [
        {
          id: "studio-solon",
          data: () => ({ mindbodySiteId: 99999, mindbodyLocationId: 2 }),
        },
      ];

      const rawBody = JSON.stringify({
        messageId: "booking-msg-019",
        eventId: "appointmentBooking.created",
        eventData: {
          siteId: 99999,
          locationId: 2,
          id: "booking-no-tz",
          clientName: "Alice Smith",
          startDateTime: "2026-08-18T07:00:00",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      await handleMindbodyWebhook(deps, req);

      const [written] = mockSet.mock.calls[0];
      expect(written.startTime.toDate().toISOString()).toBe(
        "2026-08-18T11:00:00.000Z",
      );
    });

    it("17. Client event carrying a location still sets the right homeStudioId", async () => {
      studioDocs = [...sharedSite];

      const rawBody = createValidEnvelope({
        eventData: {
          siteId: 99999,
          locationId: 1,
          clientId: 12345,
          membershipStatus: "Active",
        },
      });
      const req: WebhookRequest = {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      };

      await handleMindbodyWebhook(deps, req);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ homeStudioId: "studio-westlake" }),
        { merge: true },
      );
    });
  });

  describe("membership and contract events", () => {
    it("20. clientMembershipAssignment.created writes an active membership record", async () => {
      const rawBody = createValidEnvelope({
        eventId: "clientMembershipAssignment.created",
        eventData: {
          siteId: 99999,
          clientId: "100000009",
          clientUniqueId: 100000009,
          clientFirstName: "John",
          clientLastName: "Smith",
          membershipId: 12,
          membershipName: "Gold Level Member",
        },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      expect(mockSet).toHaveBeenCalledTimes(1);

      const [written, opts] = mockSet.mock.calls[0];
      expect(opts).toEqual({ merge: true });
      expect(written.mindbodyMemberships["12"]).toMatchObject({
        membershipId: 12,
        membershipName: "Gold Level Member",
        status: "Active",
        siteId: 99999,
      });
      // A membership event must not touch the generic profile fields.
      expect(written).not.toHaveProperty("homeStudioId");
      expect(written).not.toHaveProperty("mindbody_name");
      expect(written).not.toHaveProperty("mindbodyContracts");
    });

    it("21. clientMembershipAssignment.cancelled flips status without clearing the name", async () => {
      const rawBody = createValidEnvelope({
        eventId: "clientMembershipAssignment.cancelled",
        eventData: { siteId: 99999, clientId: "100000009", membershipId: 12 },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      const [written] = mockSet.mock.calls[0];
      const record = written.mindbodyMemberships["12"];
      expect(record.status).toBe("Cancelled");
      expect(record.cancelledAt).toBeDefined();
      // Nothing overwrites the previously synced name -- the merge preserves it.
      expect(record).not.toHaveProperty("membershipName");
    });

    it("22. clientContract.created stores the full contract with UTC timestamps", async () => {
      const rawBody = createValidEnvelope({
        eventId: "clientContract.created",
        eventData: {
          siteId: 99999,
          clientId: "100000009",
          clientUniqueId: 100000009,
          agreementDateTime: "2018-03-20T10:29:42Z",
          contractSoldByStaffId: 12,
          contractSoldByStaffFirstName: "Jane",
          contractSoldByStaffLastName: "Doe",
          contractOriginationLocation: 1,
          contractId: 3,
          contractName: "Gold Membership Contract",
          clientContractId: 117,
          contractStartDateTime: "2018-03-20T00:00:00Z",
          contractEndDateTime: "2019-03-20T00:00:00Z",
          isAutoRenewing: true,
        },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      const [written, opts] = mockSet.mock.calls[0];
      expect(opts).toEqual({ merge: true });

      const record = written.mindbodyContracts["117"];
      expect(record).toMatchObject({
        clientContractId: 117,
        contractId: 3,
        contractName: "Gold Membership Contract",
        status: "Active",
        isAutoRenewing: true,
        soldByStaffName: "Jane Doe",
        originationLocationId: 1,
      });
      expect(record.startDate).toEqual(
        Timestamp.fromDate(new Date("2018-03-20T00:00:00Z")),
      );
      expect(record.endDate).toEqual(
        Timestamp.fromDate(new Date("2019-03-20T00:00:00Z")),
      );
      expect(record.agreementDate).toEqual(
        Timestamp.fromDate(new Date("2018-03-20T10:29:42Z")),
      );
      expect(record.cancelledAt).toBeNull();
    });

    it("23. clientContract.updated merges dates without clearing contractName", async () => {
      const rawBody = createValidEnvelope({
        eventId: "clientContract.updated",
        eventData: {
          siteId: 99999,
          agreementDateTime: "2018-03-20T10:29:42Z",
          clientId: "100000009",
          clientUniqueId: 100000009,
          clientContractId: 117,
          contractStartDateTime: "2018-03-20T00:00:00Z",
          contractEndDateTime: "2020-03-20T00:00:00Z",
          isAutoRenewing: false,
        },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      const record = mockSet.mock.calls[0][0].mindbodyContracts["117"];
      expect(record.isAutoRenewing).toBe(false);
      expect(record.endDate).toEqual(
        Timestamp.fromDate(new Date("2020-03-20T00:00:00Z")),
      );
      // The update event carries neither, so neither may be written -- a
      // written `undefined` would blow away the stored name.
      expect(record).not.toHaveProperty("contractName");
      expect(record).not.toHaveProperty("contractId");
      expect(record).not.toHaveProperty("createdAt");
    });

    it("24. clientContract.cancelled marks the record cancelled and keeps its history", async () => {
      const rawBody = createValidEnvelope({
        eventId: "clientContract.cancelled",
        eventData: {
          siteId: 99999,
          clientId: "100000009",
          clientUniqueId: 100000009,
          clientContractId: 117,
        },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      const record = mockSet.mock.calls[0][0].mindbodyContracts["117"];
      expect(record.status).toBe("Cancelled");
      expect(record.cancelledAt).toBeDefined();
      expect(record).not.toHaveProperty("startDate");
      expect(record).not.toHaveProperty("endDate");
      expect(record).not.toHaveProperty("contractName");
    });

    it("25. STRICT: writes commercial data to the canonical id, ignoring a doc at another id", async () => {
      // Pre-strict this fell back to a doc found by querying mindbodyClientId,
      // so contract data would not land on an orphan record. Strict mode
      // reverses that on purpose: there is one canonical location, and a stale
      // document elsewhere is ignored rather than written to.
      const orphanSet = vi.fn().mockResolvedValue(undefined);
      clientQueryDocs = [
        { id: "random-app-doc-id", ref: { set: orphanSet } },
      ];

      const rawBody = createValidEnvelope({
        eventId: "clientContract.created",
        eventData: {
          siteId: 99999,
          clientId: "100000009",
          clientContractId: 117,
          contractId: 3,
          contractName: "Gold Membership Contract",
          contractStartDateTime: "2018-03-20T00:00:00Z",
          contractEndDateTime: "2019-03-20T00:00:00Z",
          isAutoRenewing: true,
        },
      });
      const response = await handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

      expect(response.statusCode).toBe(200);
      // Written to clients/100000009, NOT to the doc sitting at another id.
      expect(orphanSet).not.toHaveBeenCalled();
      const [written] = writesTo("clients");
      expect(written.id).toBe("100000009");
      expect(written.data.mindbodyContracts["117"].contractName).toBe(
        "Gold Membership Contract",
      );
    });

    it("26. toUtcTimestamp reads zoneless Mindbody strings as UTC, not host-local", () => {
      expect(toUtcTimestamp("2019-03-20T00:00:00")).toEqual(
        Timestamp.fromDate(new Date("2019-03-20T00:00:00Z")),
      );
      expect(toUtcTimestamp("2019-03-20T00:00:00Z")).toEqual(
        Timestamp.fromDate(new Date("2019-03-20T00:00:00Z")),
      );
      expect(toUtcTimestamp("")).toBeUndefined();
      expect(toUtcTimestamp("not a date")).toBeUndefined();
      expect(toUtcTimestamp(undefined)).toBeUndefined();
    });
  });

  /**
   * STAFF EVENTS (Sep 2026, Trainer Dossier round).
   *
   * The first test here is the one that matters: `isClientEvent` used to be
   * `!isBookingEvent && !isCommercialEvent`, a catch-all rather than a test,
   * so a staff event fell into the client profile upsert. Subscribing to
   * staff.* without that fix would have written staff records into `clients`.
   */
  describe("staff events", () => {
    const staffEnvelope = (
      eventId: string,
      eventData: Record<string, unknown>,
    ) =>
      JSON.stringify({
        messageId: `msg-${eventId}-${JSON.stringify(eventData).length}`,
        eventId,
        eventSchemaVersion: 1,
        eventData: { siteId: 99999, ...eventData },
      });

    const post = async (rawBody: string) =>
      handleMindbodyWebhook(deps, {
        rawBody,
        signatureHeader: signForTest(rawBody, mockSecret),
      });

    it("27. a staff event never reaches the clients collection", async () => {
      const response = await post(
        staffEnvelope("staff.updated", {
          staffId: 100000012,
          firstName: "Austin",
          lastName: "Jurgens",
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(writesTo("clients")).toHaveLength(0);
    });

    it("28. a matched staff event writes only the mindbody map", async () => {
      await post(
        staffEnvelope("staff.updated", {
          staffId: 100000012,
          firstName: "Austin",
          lastName: "Jurgens",
          email: "aj@example.com",
          imageUrl: "https://cdn.example.com/aj.jpg",
        }),
      );

      const [written] = writesTo("trainers");
      expect(written.id).toBe("trainer-abc");
      expect(written.options).toEqual({ merge: true });
      // The entire patch is one key. Role, pinHash and studio access are
      // untouchable by a webhook by construction, not by review.
      expect(Object.keys(written.data)).toEqual(["mindbody"]);
      expect(written.data.mindbody).toMatchObject({
        staffId: "100000012",
        displayName: "Austin Jurgens",
        email: "aj@example.com",
        imageUrl: "https://cdn.example.com/aj.jpg",
        lastEventType: "staff.updated",
      });
    });

    it("29. a staff id nobody carries is parked, and no trainer is created", async () => {
      await post(staffEnvelope("staff.created", { staffId: 777 }));

      expect(writesTo("trainers")).toHaveLength(0);
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data.kind).toBe("staff");
      expect(parked.data.reason).toContain("777");
      expect(parked.data.reason).toContain("never creates a trainer account");
    });

    it("30. a staff id claimed by two trainers is parked rather than guessed", async () => {
      trainerDocs = [
        { id: "trainer-a", mindbodyStaffId: "55" },
        { id: "trainer-b", mindbodyStaffId: "55" },
      ];

      await post(staffEnvelope("staff.updated", { staffId: 55, firstName: "Sam" }));

      expect(writesTo("trainers")).toHaveLength(0);
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data.kind).toBe("staff");
      expect(parked.data.reason).toContain("more than one trainer");
    });

    it("31. deactivation is recorded but revokes nothing", async () => {
      await post(staffEnvelope("staff.deactivated", { staffId: 100000012 }));

      const [written] = writesTo("trainers");
      expect(written.data.mindbody.isActive).toBe(false);
      // Access is a human decision. A mis-mapped staff id must not be able to
      // lock a trainer out mid-session.
      expect(written.data).not.toHaveProperty("role");
      expect(written.data).not.toHaveProperty("isVisibleOnCalendar");
      expect(written.data).not.toHaveProperty("accessibleStudioIds");
    });

    it("32. a staff event with no staff id is parked, not dropped", async () => {
      await post(staffEnvelope("staff.updated", { firstName: "Nobody" }));

      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data.kind).toBe("staff");
      expect(parked.data.reason).toContain("no staff id");
    });

    it("33. an event type no branch claims is parked instead of vanishing", async () => {
      await post(staffEnvelope("location.updated", { locationId: 3 }));

      expect(writesTo("clients")).toHaveLength(0);
      const [parked] = writesTo("mindbodyLimbo");
      expect(parked.data.kind).toBe("unhandled");
      expect(parked.data.reason).toContain("location.updated");
    });
  });
});
