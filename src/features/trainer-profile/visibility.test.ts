import { describe, it, expect } from "vitest";
import type { Trainer, UserRole } from "../../types";
import {
  resolveProfileScope,
  resolveProfileVisibility,
  scopeNotice,
  sharesStudio,
  studioIdsFor,
} from "./visibility";

const trainer = (over: Partial<Trainer> & { id: string }): Trainer =>
  ({
    fullName: "Test Trainer",
    initials: "TT",
    role: "LifeTransformer" as UserRole,
    primaryHomeStudioId: "solon",
    accessibleStudioIds: [],
    activeGuestStudioIds: [],
    ...over,
  }) as Trainer;

describe("studioIdsFor", () => {
  it("collects every studio a trainer is attached to", () => {
    const t = trainer({
      id: "t1",
      primaryHomeStudioId: "solon",
      accessibleStudioIds: ["mentor"],
      activeGuestStudioIds: ["westlake"],
      ownedStudioIds: ["strongsville"],
    });
    expect([...studioIdsFor(t)].sort()).toEqual(["mentor", "solon", "strongsville", "westlake"]);
  });

  it("ignores blanks rather than matching on them", () => {
    // Two trainers with an empty home studio must not count as colleagues.
    const a = trainer({ id: "a", primaryHomeStudioId: "  ", accessibleStudioIds: [""] });
    const b = trainer({ id: "b", primaryHomeStudioId: "" });
    expect(studioIdsFor(a).size).toBe(0);
    expect(sharesStudio(a, b)).toBe(false);
  });
});

describe("resolveProfileScope", () => {
  const aj = trainer({ id: "aj", primaryHomeStudioId: "solon" });

  it("knows you", () => {
    expect(resolveProfileScope(aj, aj)).toBe("self");
  });

  it("treats a colleague at the same studio as a peer", () => {
    expect(resolveProfileScope(trainer({ id: "other", primaryHomeStudioId: "solon" }), aj)).toBe(
      "peer",
    );
  });

  it("treats a trainer at another studio as outside", () => {
    expect(resolveProfileScope(trainer({ id: "far", primaryHomeStudioId: "mentor" }), aj)).toBe(
      "outside",
    );
  });

  it("counts cross-train access as sharing a studio", () => {
    const guest = trainer({ id: "guest", primaryHomeStudioId: "mentor", activeGuestStudioIds: ["solon"] });
    expect(resolveProfileScope(guest, aj)).toBe("peer");
  });

  it.each(["Admin", "Founder", "Overseer", "Owner", "FranchiseOwner", "StudioOwner"] as UserRole[])(
    "gives %s leadership everywhere",
    (role) => {
      const boss = trainer({ id: "boss", role, primaryHomeStudioId: "somewhere-else" });
      expect(resolveProfileScope(boss, aj)).toBe("leadership");
    },
  );

  it.each(["StudioLeader", "HeadTrainer"] as UserRole[])(
    "gives %s leadership only where they share a studio",
    (role) => {
      const here = trainer({ id: "lead", role, primaryHomeStudioId: "solon" });
      const elsewhere = trainer({ id: "lead2", role, primaryHomeStudioId: "mentor" });
      expect(resolveProfileScope(here, aj)).toBe("leadership");
      // A studio leader is not automatically leadership over the whole company.
      expect(resolveProfileScope(elsewhere, aj)).toBe("outside");
    },
  );

  it("falls back to outside when there is no viewer", () => {
    expect(resolveProfileScope(null, aj)).toBe("outside");
  });
});

describe("resolveProfileVisibility", () => {
  const aj = trainer({ id: "aj", primaryHomeStudioId: "solon" });

  it("shows a trainer everything about themselves", () => {
    const v = resolveProfileVisibility(aj, aj);
    expect(v).toMatchObject({
      scope: "self",
      canEdit: true,
      showContact: true,
      showIntegration: true,
      showRoster: true,
    });
  });

  it("gives a peer the client-facing sections but no editing or contact details", () => {
    const v = resolveProfileVisibility(trainer({ id: "peer", primaryHomeStudioId: "solon" }), aj);
    expect(v.scope).toBe("peer");
    expect(v.showRoster).toBe(true);
    expect(v.showSchedule).toBe(true);
    expect(v.showRecentlyCoached).toBe(true);
    expect(v.canEdit).toBe(false);
    expect(v.showContact).toBe(false);
    expect(v.showIntegration).toBe(false);
  });

  it("hides every client name from someone with no studio in common", () => {
    // The whole point of the tier: credentials travel, client lists do not.
    const v = resolveProfileVisibility(trainer({ id: "far", primaryHomeStudioId: "mentor" }), aj);
    expect(v.scope).toBe("outside");
    expect(v.showRoster).toBe(false);
    expect(v.showSchedule).toBe(false);
    expect(v.showRecentlyCoached).toBe(false);
    // ...but the aggregate numbers are a credential, not client data.
    expect(v.showCoachingLoad).toBe(true);
  });

  it("never lets a non-privileged viewer edit", () => {
    for (const viewer of [
      trainer({ id: "peer", primaryHomeStudioId: "solon" }),
      trainer({ id: "far", primaryHomeStudioId: "mentor" }),
      null,
    ]) {
      expect(resolveProfileVisibility(viewer, aj).canEdit).toBe(false);
    }
  });
});

describe("scopeNotice", () => {
  it("explains read-only, and why clients are missing when they are", () => {
    expect(scopeNotice("peer", "Austin")).toContain("Read-only");
    expect(scopeNotice("outside", "Austin")).toContain("clients are hidden");
    expect(scopeNotice("self", "Austin")).toBeNull();
    expect(scopeNotice("leadership", "Austin")).toBeNull();
  });
});
