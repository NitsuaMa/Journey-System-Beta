/**
 * The category indirection, and why it exists.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * These tests exist for one regression in particular. useMachineUpkeep used to
 * answer "when was this machine last cleaned" by matching the literal string
 * "cleaning". Opening TaskCategory to studio-authored values made that a
 * silent trap: the first manager to rename Cleaning would empty the Last
 * cleaned row on every machine in the Catalog, with nothing in the UI
 * connecting the two. upkeepRoleOf is the guard, so it is worth pinning down.
 */

import { describe, expect, it } from "vitest";
import { categoryLabel, upkeepRoleOf, BUILT_IN_CATEGORIES } from "./types";
import { shouldNotifyOnComplete } from "./notify";
import type { StudioTaskCategory } from "./types";

describe("categoryLabel", () => {
  it("uses a studio's own label when it has one", () => {
    const studio: StudioTaskCategory[] = [
      { id: "front-desk", label: "Front desk" },
    ];
    expect(categoryLabel("front-desk", studio)).toBe("Front desk");
  });

  it("lets a studio rename a built-in", () => {
    const studio: StudioTaskCategory[] = [
      { id: "cleaning", label: "Wipe-down", upkeepRole: "cleaning" },
    ];
    expect(categoryLabel("cleaning", studio)).toBe("Wipe-down");
  });

  it("falls back to the built-in label with no studio categories", () => {
    expect(categoryLabel("maintenance")).toBe("Maintenance");
  });

  /**
   * A completed instance denormalizes its category id. If the category
   * document is later deleted, "Front Desk" read off the id is far more useful
   * on that historical task than a blank or the word "Unknown".
   */
  it("title-cases an unknown id rather than showing nothing", () => {
    expect(categoryLabel("front_desk")).toBe("Front Desk");
    expect(categoryLabel("outreach")).toBe("Outreach");
  });
});

describe("upkeepRoleOf", () => {
  it("resolves the built-in ids with no studio categories at all", () => {
    // The whole point: a studio that has never opened a category editor keeps
    // working, with zero documents in taskCategories.
    expect(upkeepRoleOf("cleaning")).toBe("cleaning");
    expect(upkeepRoleOf("maintenance")).toBe("maintenance");
    expect(upkeepRoleOf("ops")).toBeUndefined();
  });

  it("keeps the upkeep row alive when a built-in is renamed", () => {
    const studio: StudioTaskCategory[] = [
      { id: "cleaning", label: "Wipe-down", upkeepRole: "cleaning" },
    ];
    expect(upkeepRoleOf("cleaning", studio)).toBe("cleaning");
  });

  it("lets a studio-authored category feed an upkeep row", () => {
    const studio: StudioTaskCategory[] = [
      { id: "deep-clean", label: "Deep clean", upkeepRole: "cleaning" },
    ];
    expect(upkeepRoleOf("deep-clean", studio)).toBe("cleaning");
  });

  it("returns nothing for a studio category that declares no role", () => {
    const studio: StudioTaskCategory[] = [
      { id: "outreach", label: "Outreach" },
    ];
    expect(upkeepRoleOf("outreach", studio)).toBeUndefined();
  });

  /**
   * The dangerous case. A studio category document with a built-in id and NO
   * upkeepRole is an override that turns the role off — that is the honest
   * reading of "the studio said this category answers nothing", and it must be
   * a deliberate choice in the editor rather than a surprise.
   */
  it("respects a studio explicitly clearing a built-in's upkeep role", () => {
    const studio: StudioTaskCategory[] = [{ id: "cleaning", label: "Cleaning" }];
    expect(upkeepRoleOf("cleaning", studio)).toBeUndefined();
  });

  it("ships the two upkeep roles among its built-ins", () => {
    const roles = BUILT_IN_CATEGORIES.map((c) => c.upkeepRole).filter(Boolean);
    expect(roles).toEqual(["cleaning", "maintenance"]);
  });
});

describe("shouldNotifyOnComplete", () => {
  it("stays silent for recurring work by default", () => {
    // The filter that decides whether the bell survives contact with a studio
    // running 40 cleaning tasks a day.
    expect(shouldNotifyOnComplete({ recurrence: { type: "daily" } })).toBe(false);
    expect(shouldNotifyOnComplete({ recurrence: { type: "weekly" } })).toBe(false);
    expect(shouldNotifyOnComplete({ recurrence: { type: "monthly" } })).toBe(false);
  });

  it("notifies for a one-off by default", () => {
    expect(shouldNotifyOnComplete({ recurrence: { type: "once" } })).toBe(true);
  });

  it("lets an explicit choice win either way", () => {
    expect(
      shouldNotifyOnComplete({
        notifyCreatorOnComplete: true,
        recurrence: { type: "daily" },
      }),
    ).toBe(true);
    expect(
      shouldNotifyOnComplete({
        notifyCreatorOnComplete: false,
        recurrence: { type: "once" },
      }),
    ).toBe(false);
  });

  it("treats a template with no recurrence as recurring, not as a one-off", () => {
    // Defaulting an unknown shape to "notify" would make a malformed template
    // the loudest thing on the board.
    expect(shouldNotifyOnComplete({})).toBe(false);
  });
});
