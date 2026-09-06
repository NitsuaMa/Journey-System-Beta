import { describe, it, expect } from "vitest";
import { Firestore } from "firebase-admin/firestore";
import { resolveTrainerByStaffId } from "./staffResolver";

type Row = { id: string; mindbodyStaffId?: unknown };

/**
 * Minimal Firestore stand-in: enough of collection().where().limit().get()
 * to exercise the query, with a strict `===` so the string/number split this
 * resolver exists to survive is actually reproduced.
 */
function createMockFirestore(rows: Row[]): Firestore & { queries: unknown[] } {
  const queries: unknown[] = [];
  const api = {
    queries,
    collection(name: string) {
      if (name !== "trainers") throw new Error(`unexpected collection ${name}`);
      const build = (matches: Row[]) => ({
        where(field: string, _op: string, value: unknown) {
          queries.push(value);
          return build(rows.filter((r) => (r as any)[field] === value));
        },
        limit(n: number) {
          return build(matches.slice(0, n));
        },
        async get() {
          return {
            size: matches.length,
            empty: matches.length === 0,
            docs: matches.map((r) => ({ id: r.id, data: () => r })),
            forEach(cb: (d: { id: string }) => void) {
              matches.forEach((r) => cb({ id: r.id }));
            },
          };
        },
      });
      return build(rows) as any;
    },
  };
  return api as unknown as Firestore & { queries: unknown[] };
}

describe("resolveTrainerByStaffId", () => {
  it("matches a trainer whose staff id is stored as a string", async () => {
    const db = createMockFirestore([{ id: "uid-aj", mindbodyStaffId: "100000012" }]);
    expect(await resolveTrainerByStaffId(db, "100000012")).toEqual({
      kind: "matched",
      trainerId: "uid-aj",
    });
  });

  it("matches a legacy trainer whose staff id was stored as a number", async () => {
    // Firestore's == is type-strict, so the string query alone would miss this.
    const db = createMockFirestore([{ id: "uid-legacy", mindbodyStaffId: 100000012 }]);
    expect(await resolveTrainerByStaffId(db, "100000012")).toEqual({
      kind: "matched",
      trainerId: "uid-legacy",
    });
    expect(db.queries).toEqual(["100000012", 100000012]);
  });

  it("accepts a numeric staff id from the payload", async () => {
    const db = createMockFirestore([{ id: "uid-aj", mindbodyStaffId: "42" }]);
    expect(await resolveTrainerByStaffId(db, 42)).toEqual({ kind: "matched", trainerId: "uid-aj" });
  });

  it("reports unlinked rather than creating anything", async () => {
    // A trainer document is an RBAC principal. An unknown staff member waits
    // in limbo for a human, it does not get minted by a webhook.
    const db = createMockFirestore([{ id: "uid-aj", mindbodyStaffId: "1" }]);
    expect(await resolveTrainerByStaffId(db, "999")).toEqual({ kind: "unlinked" });
  });

  it("reports ambiguity instead of picking one", async () => {
    const db = createMockFirestore([
      { id: "uid-a", mindbodyStaffId: "7" },
      { id: "uid-b", mindbodyStaffId: "7" },
    ]);
    const result = await resolveTrainerByStaffId(db, "7");
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.trainerIds.sort()).toEqual(["uid-a", "uid-b"]);
  });

  it("does not query at all for a blank staff id", async () => {
    const db = createMockFirestore([]);
    expect(await resolveTrainerByStaffId(db, "   ")).toEqual({ kind: "unlinked" });
    expect(db.queries).toEqual([]);
  });

  it("skips the numeric query when the id is not numeric", async () => {
    const db = createMockFirestore([]);
    await resolveTrainerByStaffId(db, "abc");
    expect(db.queries).toEqual(["abc"]);
  });
});
