/**
 * THE SESSION-SCOPE INVARIANT.
 *
 * Round: Unified Routine Builder, Sep 2026.
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
 * Today that holds by construction — the session surfaces simply never call
 * a routine write. "By construction" is precisely the kind of guarantee that
 * stops being true without anyone noticing, and the failure is silent and
 * expensive: a trainer swaps two machines because a station was busy, and the
 * client's prescribed routine is quietly rewritten to match a one-off.
 *
 * These tests read the source files and assert the rule directly, in the same
 * spirit as journey-grid/contrast.test.ts parsing the token file. A unit test
 * of the components could not catch this — the dangerous version still
 * renders correctly and still passes every behavioural test. What matters is
 * which functions the file is allowed to call at all.
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

const SESSION_SCOPED = [
  "src/components/SessionRoutineManagerModal.tsx",
  "src/features/briefing/BriefingScreen.tsx",
];

/** Firestore mutators that could reach a routine document. */
const MUTATORS = ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch", "runTransaction"];

describe("session-scoped surfaces never persist a routine change", () => {
  for (const file of SESSION_SCOPED) {
    it(`${file} contains no Firestore write at all`, () => {
      const src = code(read(file));
      const found = MUTATORS.filter((m) => new RegExp(`\\b${m}\\s*\\(`).test(src));
      expect(
        found,
        `${file} must not write to Firestore — a change made during a session is ` +
          `for that session only. Permanent routine changes belong in EditRoutineDrawer.`,
      ).toEqual([]);
    });

    it(`${file} does not import the routines collection`, () => {
      const src = code(read(file));
      expect(/["']routines["']/.test(src), `${file} references the routines collection`).toBe(false);
    });
  }

  it("the briefing hands its sequence upward and never saves it itself", () => {
    const src = code(read("src/features/briefing/BriefingScreen.tsx"));
    // The one exit: onStart, with customMachines only when the trainer adjusted.
    expect(src).toMatch(/onStart\(/);
    expect(src).toMatch(/adjustedMachineIds/);
  });

  it("the briefing call site never asks startNewSession to persist", () => {
    // startNewSession takes a `permanentSave` flag. It exists for the client
    // profile's path; the briefing must always pass false, so an adjustment
    // made before a session seeds today's logs and nothing else.
    const src = code(read("src/components/WorkoutTrackerView.tsx"));
    const call = src.match(/startNewSession\(\s*routineType[\s\S]{0,300}?\)/);
    expect(call, "could not find the BriefingScreen onStart wiring").not.toBeNull();
    expect(call![0]).toMatch(/false/);
    expect(call![0]).not.toMatch(/true\s*,\s*checkIn/);
  });
});

describe("the client profile is the only place a routine is rewritten", () => {
  it("EditRoutineDrawer writes routines and logs an adjustment", () => {
    const src = code(read("src/components/EditRoutineDrawer.tsx"));
    expect(src).toMatch(/routineAdjustments/);
    expect(src).toMatch(/\b(updateDoc|addDoc)\s*\(/);
  });

  it("every routine rewrite is accompanied by an audit reason", () => {
    // The reason gate is what makes a permanent change reviewable later. If
    // this disappears, deviations from a studio standard become untraceable.
    const src = code(read("src/components/EditRoutineDrawer.tsx"));
    expect(src).toMatch(/reason\.trim\(\)\.length\s*[<>]=?\s*3/);
  });
});
