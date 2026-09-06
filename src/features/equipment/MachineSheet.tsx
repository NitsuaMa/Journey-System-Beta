import { useMemo, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMachineCatalog } from "../../hooks/useMachineCatalog";
import { useActiveStudio } from "../../ActiveStudioContext";
import type { Client, ClientMachineSetting, Machine } from "../../types";
import { toEquipmentMachines } from "./adapters";
import { SettingsCard } from "./SettingsCard";
import { MachineNotes } from "./MachineNotes";
import { SetupGuide } from "./SetupGuide";
import { ChangeHistory } from "./ChangeHistory";
import type { JournalContext, MutationAuthor } from "./mutations";

/**
 * THE MACHINE SHEET — one place, mid-session, for everything about one
 * machine and one client.
 *
 * What it replaces: the Active Session used to have TWO modals. Tapping a
 * machine cell opened "Machine Settings" (dials + an optional reason).
 * A separate small icon on the same row opened "Machine Notes". They were
 * different shapes, different widths, wrote through different code paths,
 * and — the actual problem — a trainer standing at a machine had to know
 * WHICH of two near-identical targets held the thing they wanted. With a
 * client waiting, that is a guess, and a wrong guess costs two taps.
 *
 * So: one target (the machine's name), one sheet, everything stacked in the
 * order a trainer needs it.
 *
 *   1. WHAT COULD HURT SOMEONE.  Any note flagged high-importance is
 *      hoisted to the top, above the fold, before a single dial. "Hip pain
 *      if she goes too fast" was previously two taps deep inside the modal
 *      a trainer was LESS likely to open. Safety information does not wait
 *      behind a scroll.
 *   2. THE DIALS.  Gap, Back Pad, Seat — with the studio standard ghosted
 *      in each empty field, and a reason box that is required only when a
 *      value actually changed.
 *   3. THE NOTES.  The list, plus a box to add one, plus the flag.
 *   4. SET-UP GUIDE and CHANGE HISTORY, both collapsed. Reference, not
 *      workflow — but "why did someone move this last month" is answerable
 *      without leaving the session, which it was not before.
 *
 * It is a BOTTOM SHEET, not a centred dialog, and that is a physical
 * argument rather than a stylistic one: this app is used on a large iPad
 * held in two hands on a gym floor. The bottom third of that screen is
 * where thumbs already are; the middle is where they are not.
 *
 * Every write goes through `features/equipment/mutations.ts` — the same
 * functions the Equipment tab calls. That is what makes the promise in the
 * spec true rather than aspirational: a setting changed here lands in
 * `clientMachineSettings`, in `machines/{id}/settingHistory` with its
 * reason, and in the client's Journal, so it is already on the client's
 * Equipment tab by the time the trainer walks back to the desk. The old
 * in-session dialog wrote its own third copy to a `machineSettingChanges`
 * collection that nothing in the app has ever read.
 */

export interface MachineSheetProps {
  open: boolean;
  machine: Machine | null;
  client: Client | null;
  clientId: string;
  clientSettings: Record<string, ClientMachineSetting>;
  author: MutationAuthor | null;
  sessionId?: string | null;
  onClose: () => void;
  onError?: (message: string) => void;
  /** Toast-worthy confirmation, so the sheet can stay open after a save. */
  onSaved?: (message: string) => void;
}

export function MachineSheet({
  open,
  machine,
  client,
  clientId,
  clientSettings,
  author,
  sessionId,
  onClose,
  onError,
  onSaved,
}: MachineSheetProps) {
  const { byId: catalogById } = useMachineCatalog();
  const { activeStudio, activeStudioId } = useActiveStudio();
  const [flash, setFlash] = useState<string | null>(null);

  const equipment = useMemo(() => {
    if (!machine?.id) return null;
    return (
      toEquipmentMachines({
        machines: [machine],
        clientSettings,
        allLogs: [],
        catalogById,
        studioMachineSettings: activeStudio?.machineSettings,
      })[0] ?? null
    );
  }, [machine, clientSettings, catalogById, activeStudio]);

  /* Notes written from here file as "in_session", so the Journal can say
     where a note came from without the trainer having to type it. */
  const journal: JournalContext = useMemo(
    () => ({
      studioId: activeStudioId || activeStudio?.id || "",
      origin: "in_session",
      sessionId: sessionId ?? null,
    }),
    [activeStudioId, activeStudio, sessionId],
  );

  const alerts = useMemo(
    () => (equipment?.notes || []).filter((n) => n.isImportant),
    [equipment],
  );

  const announce = (message: string) => {
    setFlash(message);
    onSaved?.(message);
    window.setTimeout(() => setFlash((f) => (f === message ? null : f)), 4000);
  };

  if (!equipment) return null;

  const who = [client?.height, client?.gender].filter(Boolean).join(", ");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setFlash(null);
          onClose();
        }
      }}
    >
      {/* Overrides the centred-dialog geometry into a bottom sheet. Capped
          at 88vh so the sheet never becomes the whole screen — seeing a
          sliver of the grid behind it is what tells a trainer the session
          is still running underneath. */}
      <DialogContent
        showCloseButton={false}
        className="top-auto bottom-0 left-1/2 translate-y-0 max-w-none sm:max-w-[680px] w-full max-h-[88dvh] rounded-b-none rounded-t-[22px] p-0 border-0 bg-transparent shadow-none"
      >
        <div className="eq eq-sheet">
          <div className="eq-sheet__grab" aria-hidden="true" />

          <header className="eq-sheet__head">
            <div className="eq-sheet__id">
              <h2 className="eq-sheet__name">{equipment.name}</h2>
              <p className="eq-sheet__who">
                {client ? `${client.firstName} ${client.lastName}` : "Client"}
                {who ? ` · ${who}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="eq-sheet__close"
              onClick={onClose}
              aria-label="Close machine sheet"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
          </header>

          <div className="eq-sheet__body">
            {/* 1. Above the fold, above the dials, above everything. */}
            {alerts.length > 0 && (
              <section className="eq-sheet__alerts" aria-label="High importance notes">
                <span className="eq-sheet__alerts-kicker">
                  <TriangleAlert size={12} strokeWidth={2.8} aria-hidden />
                  High importance
                </span>
                {alerts.map((n) => (
                  <p key={n.id} className="eq-sheet__alert">
                    {n.content}
                    <i>
                      {n.authorName}
                      {n.timestamp ? ` · ${new Date(n.timestamp).toLocaleDateString()}` : ""}
                    </i>
                  </p>
                ))}
              </section>
            )}

            {flash && (
              <p className="eq-sheet__flash" role="status">
                {flash}
              </p>
            )}

            {/* 2. The dials, with the reason box the audit trail needs. */}
            <SettingsCard
              machine={equipment}
              clientId={clientId}
              author={author}
              journal={journal}
              onSaved={(result) =>
                announce(
                  `Saved to ${client?.firstName || "the client"}'s profile — ${result.summary}. Logged to their Equipment tab.`,
                )
              }
              onError={onError}
            />

            {/* 3. The notes. */}
            <MachineNotes
              machine={equipment}
              clientId={clientId}
              author={author}
              journal={journal}
              flagLabel="High importance"
              onSaved={announce}
              onError={onError}
            />

            {/* 4. Reference, folded away. */}
            {equipment.guide && <SetupGuide guide={equipment.guide} />}
            <ChangeHistory machineId={equipment.id} clientId={clientId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
