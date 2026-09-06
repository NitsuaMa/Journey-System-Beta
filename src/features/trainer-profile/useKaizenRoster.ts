import { useCallback, useState } from "react";
import { Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { OperationType, handleFirestoreError } from "../../lib/firestore-errors";
import { useToast } from "../../contexts/ToastContext";
import type { Client, KaizenReason, KaizenRosterEntry, Trainer } from "../../types";
import { addToRoster, removeFromRoster, updateRosterEntry } from "./roster";

/**
 * Adding to and removing from a trainer's Kaizen Roster.
 *
 * Writes the whole array with updateDoc rather than arrayUnion/arrayRemove.
 * Two reasons, and the second is the one that decides it:
 *
 *  - arrayRemove needs an EXACT object match to find the element, so removing
 *    an entry would mean reconstructing every field byte-for-byte.
 *  - serverTimestamp() cannot be written inside an array at all, so `addedAt`
 *    is a client-clock Timestamp either way. A device with a wrong clock
 *    misorders its own roster and nothing else -- acceptable for a bookmark,
 *    which is why this is not worth a subcollection.
 *
 * The array being rewritten wholesale is safe here because a roster has
 * exactly one writer: firestore.rules only lets a trainer write their own.
 */
export function useKaizenRoster(trainer: Trainer | null | undefined) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [saving, setSaving] = useState(false);

  const write = useCallback(
    async (next: KaizenRosterEntry[]): Promise<boolean> => {
      if (!trainer?.id) return false;
      setSaving(true);
      try {
        await updateDoc(doc(db, "trainers", trainer.id), { kaizenRoster: next });
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `trainers/${trainer.id}`);
        toastError("Couldn't save your Kaizen Roster. Try again.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [trainer?.id, toastError],
  );

  const add = useCallback(
    async (
      client: Pick<Client, "id" | "firstName" | "lastName">,
      reason: KaizenReason,
      options: { note?: string; reviewBy?: Date | null } = {},
    ): Promise<boolean> => {
      if (!trainer?.id || !client.id) return false;

      const entry: KaizenRosterEntry = {
        clientId: client.id,
        clientName: `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || "Client",
        reason,
        addedAt: Timestamp.now(),
        addedByTrainerId: trainer.id,
      };
      if (options.note?.trim()) entry.note = options.note.trim();
      if (options.reviewBy) entry.reviewBy = Timestamp.fromDate(options.reviewBy);

      const result = addToRoster(trainer.kaizenRoster, entry);
      if (result.kind !== "ok") {
        toastError(result.message);
        return false;
      }

      const saved = await write(result.next);
      // No notification of any kind: adding someone to your own working list
      // is not an event anybody else needs told about, and the Sep 4 freeze on
      // contacting clients and trainers still stands.
      if (saved) toastSuccess(`${entry.clientName} added to your Kaizen Roster.`);
      return saved;
    },
    [trainer, write, toastError, toastSuccess],
  );

  const remove = useCallback(
    async (clientId: string): Promise<boolean> => {
      if (!trainer?.id) return false;
      // No confirmation dialog. This is a bookmark, not a record -- and it can
      // be put back in one tap.
      return write(removeFromRoster(trainer.kaizenRoster, clientId));
    },
    [trainer, write],
  );

  const update = useCallback(
    async (
      clientId: string,
      patch: Partial<Pick<KaizenRosterEntry, "reason" | "note" | "reviewBy">>,
    ): Promise<boolean> => {
      if (!trainer?.id) return false;
      return write(updateRosterEntry(trainer.kaizenRoster, clientId, patch));
    },
    [trainer, write],
  );

  return { add, remove, update, saving };
}
