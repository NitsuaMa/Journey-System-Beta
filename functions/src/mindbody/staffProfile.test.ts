import { describe, it, expect } from "vitest";
import { extractStaffId, mapStaffEventToPatch } from "./staffProfile";

const envelope = (eventData: Record<string, unknown>) => ({
  messageId: "m-1",
  eventId: "staff.updated",
  eventSchemaVersion: 1,
  eventData,
});

describe("extractStaffId", () => {
  it("reads staffId from eventData", () => {
    expect(extractStaffId(envelope({ staffId: 100000012 }))).toBe("100000012");
  });

  it("accepts the flat payload shape", () => {
    expect(extractStaffId({ staffId: "42" })).toBe("42");
  });

  it("returns undefined when the event names no staff member", () => {
    expect(extractStaffId(envelope({ siteId: 5746957 }))).toBeUndefined();
  });
});

describe("mapStaffEventToPatch", () => {
  it("maps the common fields", () => {
    const { mindbody } = mapStaffEventToPatch(
      envelope({
        staffId: 100000012,
        siteId: 5746957,
        firstName: "Austin",
        lastName: "Jurgens",
        email: "aj@example.com",
      }),
      "staff.updated",
    );
    expect(mindbody).toMatchObject({
      staffId: "100000012",
      siteId: "5746957",
      firstName: "Austin",
      lastName: "Jurgens",
      displayName: "Austin Jurgens",
      email: "aj@example.com",
      lastEventType: "staff.updated",
    });
  });

  it("writes only into the mindbody map, never a trainer field", () => {
    // The whole point of the map: a hostile or mis-mapped payload cannot
    // reach role, pinHash, studio access or the Kaizen Roster.
    const { mindbody } = mapStaffEventToPatch(
      envelope({
        staffId: 1,
        role: "Admin",
        pinHash: "pwned",
        accessibleStudioIds: ["everything"],
        kaizenRoster: [],
        rollups: { sessionsCoached: 99999 },
      }),
      "staff.updated",
    );
    expect(Object.keys(mindbody).sort()).toEqual(["lastEventType", "staffId"]);
  });

  it("omits absent fields rather than nulling them", () => {
    // staff.deactivated carries almost nothing; writing nulls for the rest
    // would wipe the name and photo captured at creation time.
    const { mindbody } = mapStaffEventToPatch(envelope({ staffId: 7 }), "staff.deactivated");
    expect(mindbody).not.toHaveProperty("firstName");
    expect(mindbody).not.toHaveProperty("imageUrl");
  });

  it("flags deactivation from the event type", () => {
    const patch = mapStaffEventToPatch(envelope({ staffId: 7 }), "staff.deactivated");
    expect(patch.deactivated).toBe(true);
    expect(patch.mindbody.isActive).toBe(false);
  });

  it("flags deactivation from an explicit inactive flag", () => {
    const patch = mapStaffEventToPatch(envelope({ staffId: 7, isActive: false }), "staff.updated");
    expect(patch.deactivated).toBe(true);
  });

  it("marks a reactivated staff member active", () => {
    const patch = mapStaffEventToPatch(envelope({ staffId: 7, isActive: true }), "staff.updated");
    expect(patch.deactivated).toBe(false);
    expect(patch.mindbody.isActive).toBe(true);
  });

  it("keeps https photos and drops anything else", () => {
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, imageUrl: "https://cdn/x.jpg" }), "staff.updated")
        .mindbody.imageUrl,
    ).toBe("https://cdn/x.jpg");
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, imageUrl: "http://cdn/x.jpg" }), "staff.updated")
        .mindbody.imageUrl,
    ).toBeUndefined();
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, ImageUrl: "not a url" }), "staff.updated")
        .mindbody.imageUrl,
    ).toBeUndefined();
  });

  it("reads a location whether it arrives as a number, string or object", () => {
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, homeLocation: 3 }), "staff.updated").mindbody
        .homeLocationId,
    ).toBe("3");
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, homeLocation: { id: 4 } }), "staff.updated")
        .mindbody.homeLocationId,
    ).toBe("4");
    expect(
      mapStaffEventToPatch(envelope({ staffId: 1, homeLocationId: "5" }), "staff.updated").mindbody
        .homeLocationId,
    ).toBe("5");
  });

  it("collects every location a staff member works at", () => {
    const { mindbody } = mapStaffEventToPatch(
      envelope({ staffId: 1, locationIds: [1, { id: 2 }, "3", null] }),
      "staff.updated",
    );
    expect(mindbody.locationIds).toEqual(["1", "2", "3"]);
  });
});
