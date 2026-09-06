/**
 * STAFF RESOLVER — which trainer document a Mindbody staff event belongs to.
 *
 * WHY THIS IS NOT `doc(staffId)`
 * ------------------------------
 * Clients are stored at a canonical path keyed by their Mindbody id, so
 * `clientResolver` can look one up directly. Trainers cannot work that way:
 * a trainer document id is the FIREBASE AUTH UID, because that id is what the
 * security rules compare against `request.auth.uid`. The Mindbody staff id is
 * therefore a field, and finding a trainer means a query.
 *
 * THE RULE
 * --------
 * A staff webhook NEVER creates a trainer document.
 *
 * `ensureCanonicalClient` may create a client, and that is safe: a client
 * document grants nothing. A trainer document is an RBAC principal -- it
 * carries `role`, `pinHash` and studio access -- so letting an external system
 * mint one is precisely the privilege-escalation shape the rules audit already
 * caught once. An unmatched staff member goes to the limbo queue and waits for
 * a human to link them in Edit Trainer.
 */
import { Firestore } from "firebase-admin/firestore";

export type StaffResolution =
  | { kind: "matched"; trainerId: string }
  | { kind: "unlinked" }
  /** Two or more trainers claim the same staff id: a data error, not a guess. */
  | { kind: "ambiguous"; trainerIds: string[] };

/**
 * Finds the trainer carrying this Mindbody staff id.
 *
 * Queries the string form first, then the numeric form. Both exist in the
 * wild: the trainer modals used to write whatever the picker handed them, so
 * older documents can hold `100000012` as a number and newer ones the string
 * "100000012". Firestore's `==` is type-strict, so one query cannot find both.
 * The modals now normalise on write and the backfill repairs old rows -- this
 * second query is what keeps the sync working in the meantime.
 *
 * Single-field equality, so no composite index is needed.
 */
export async function resolveTrainerByStaffId(
  firestore: Firestore,
  staffId: string | number,
): Promise<StaffResolution> {
  const asString = String(staffId).trim();
  if (!asString) return { kind: "unlinked" };

  const candidates: (string | number)[] = [asString];
  const asNumber = Number(asString);
  if (Number.isFinite(asNumber) && String(asNumber) === asString) {
    candidates.push(asNumber);
  }

  const found = new Set<string>();
  for (const value of candidates) {
    const snap = await firestore
      .collection("trainers")
      .where("mindbodyStaffId", "==", value)
      .limit(3)
      .get();
    snap.forEach((doc) => found.add(doc.id));
    if (found.size > 1) break;
  }

  if (found.size === 0) return { kind: "unlinked" };
  if (found.size > 1) return { kind: "ambiguous", trainerIds: [...found] };
  return { kind: "matched", trainerId: [...found][0] };
}
