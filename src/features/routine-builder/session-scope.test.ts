/**
 * THE SESSION-SCOPE INVARIANT.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *        Retargeted when the in-session modal became an inline panel.
 *
 * A trainer has full discretion over machine order and count on the day. The
 * client arrived late, so it is five machines instead of seven. The client
 * needs blood flow rather than a set to failure. Another trainer is on the
 * Leg Press, so the Pulldown moves up. All of that is normal coaching, and
 * none of it is a decision about the client's programme.
 *
 * So: a mid-session change is temporary and must never write back to the
 * client's routine. Permanent routine changes are made on the client profile
 * and nowhere else.
 *
 * These tests read the source and assert that directly, in the same spirit as
 * journey-grid/contrast.test.ts parsing the token file. A unit test of the
 * components cannot catch this — the dangerous version still renders
 * correctly and still passes every behavioural test. What matters is which
 * functions each file is allowed to call.
 *
 * ── Why this file changed shape ──────────────────────────────────────────
 * It first asserted that the session surfaces contained NO Firestore mutator
 * at all, which worked while the in-session editor was its own modal. Folding
 * that modal into WorkoutTrackerView made the blunt assertion useless: that
 * file legitimately writes logs, sessions and clients on every set. So the
 * assertions are now about the `routines` collection specifically, and about
 * the one handler that commits a mid-session reorder.
 *
 * The test failing when the modal was deleted is the system working. It is
 * meant to fail when the shape of the thing it guards changes, so that
 * someone has to re-state the rule rather than quietly lose it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Strip comments so prose about writes is not mistaken for a write. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The body of a `const name = (...) => { ... }` declaration. */
function bodyOf(source: string, name: string): string {
  const at = source.indexOf(`const ${name} =`);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return "";
}

const MUTATORS = ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch", "runTransaction"];

const WTV = code(read("src/components/WorkoutTrackerView.tsx"));
const BRIEFING = code(read("src/features/briefing/BriefingScreen.tsx"));

describe("the shared builder never persists anything", () => {
  // Whichever surface mounts it, the builder is controlled: ids in, ids out.
  // The moment it learns to save, every surface it serves saves with it.
  const files = [
    "RoutineBuilder.tsx",
    "SequenceMachineRow.tsx",
    "MachinePicker.tsx",
    "SwapSheet.tsx",
    "RotationPanel.tsx",
    "SuggestionRail.tsx",
    "CoverageStrip.tsx",
    "ViolationCard.tsx",
    "RoutineFigure.tsx",
  ];
  for (const file of files) {
    it(`${file} contains no Firestore write`, () => {
      const src = code(read(`src/features/routine-builder/${file}`));
      const found = MUTATORS.filter((m) => new RegExp(`\\b${m}\\s*\\(`).test(src));
      expect(found, `${file} must stay controlled — ids in, ids out`).toEqual([]);
    });
  }
});

describe("the pre-session briefing hands its sequence upward", () => {
  it("contains no Firestore write at all", () => {
    const found = MUTATORS.filter((m) => new RegExp(`\\b${m}\\s*\\(`).test(BRIEFING));
    expect(found).toEqual([]);
  });

  it("starting a session has no way to persist a routine", () => {
    // startNewSession used to take a `permanentSave` flag that rewrote the
    // client's saved routine as a side effect of starting a session. No
    // caller ever set it, which is what made it dangerous: a dead branch
    // enabling exactly the forbidden thing, one argument away from firing.
    expect(
      /permanentSave/.test(WTV),
      "permanentSave is gone on purpose — do not reintroduce a way to save a " +
        "routine from the session path",
    ).toBe(false);
  });
});

describe("mid-session changes stay in session state", () => {
  it("the reorder handler is a plain setState", () => {
    const body = bodyOf(WTV, "handleSaveSessionMachineIds");
    expect(body, "handleSaveSessionMachineIds not found").not.toBe("");
    expect(body).toMatch(/setActiveMachineIds/);
    const found = MUTATORS.filter((m) => new RegExp(`\\b${m}\\s*\\(`).test(body));
    expect(
      found,
      "a mid-session reorder must not reach Firestore — the client's routine is " +
        "edited on their profile, not from a live session",
    ).toEqual([]);
  });

  it("adding a machine mid-session only touches session state", () => {
    const at = WTV.indexOf("onAddMachine:");
    expect(at, "onAddMachine not found").toBeGreaterThan(-1);
    const handler = WTV.slice(at, at + 400);
    expect(handler).toMatch(/setActiveMachineIds/);
    const found = MUTATORS.filter((m) => new RegExp(`\\b${m}\\s*\\(`).test(handler));
    expect(found).toEqual([]);
  });

  it("the session screen never updates or replaces a routine document", () => {
    // Creating one is allowed: the briefing's Create_A / Create_B path is how
    // a client's first routine comes into existence. Rewriting an existing
    // one from here is not.
    const writes = [
      ...WTV.matchAll(/\b(updateDoc|setDoc|deleteDoc)\s*\(\s*doc\([^)]*?["']routines["']/g),
    ];
    expect(
      writes.map((m) => m[0]),
      "the live session must not rewrite a saved routine",
    ).toEqual([]);
  });
});

describe("the client profile is the only place a routine is rewritten", () => {
  const DRAWER = code(read("src/components/EditRoutineDrawer.tsx"));

  it("EditRoutineDrawer writes routines and logs an adjustment", () => {
    expect(DRAWER).toMatch(/routineAdjustments/);
    expect(DRAWER).toMatch(/\b(updateDoc|addDoc)\s*\(/);
  });

  it("every routine rewrite is gated on an audit reason", () => {
    // The reason gate is what makes a permanent change reviewable later. If it
    // goes, deviations from a studio standard become untraceable.
    expect(DRAWER).toMatch(/reason\.trim\(\)\.length\s*[<>]=?\s*3/);
  });
});
