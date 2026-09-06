import { useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMachineCatalog } from "../../hooks/useMachineCatalog";
import { useActiveStudio } from "../../ActiveStudioContext";
import type { Machine, ClientMachineSetting } from "../../types";
import { toEquipmentMachines } from "./adapters";
import { SettingsCard } from "./SettingsCard";
import { SetupGuide } from "./SetupGuide";
import type { JournalContext, MutationAuthor } from "./mutations";

/**
 * IN-SESSION SETUP PROMPT.
 *
 * When a trainer opens a machine mid-session that this client has never
 * performed, the useful thing to show first is not an empty weight field — it
 * is how to set the machine up. This surfaces that automatically, once per
 * machine per session, before the performance entry HUD.
 *
 * It is deliberately the SAME SettingsCard and SetupGuide the Equipment tab
 * uses, not a second implementation: the ghosting rules, the absolute-standard
 * pre-fill and the journal sync are defined once and behave identically
 * wherever a trainer meets them. Only `origin` differs — notes and audit
 * reasons written here file as "in_session".
 *
 * Skipping writes nothing. A trainer with a client already sitting on the
 * machine should never be blocked by a form.
 */

export interface SetupPromptDialogProps {
  open: boolean;
  machine: Machine | null;
  clientId: string;
  clientSettings: Record<string, ClientMachineSetting>;
  author: MutationAuthor | null;
  sessionId?: string | null;
  onClose: () => void;
  /** Fired after a successful save, so the caller can continue into the HUD. */
  onSaved?: () => void;
  onError?: (message: string) => void;
}

export function SetupPromptDialog({
  open,
  machine,
  clientId,
  clientSettings,
  author,
  sessionId,
  onClose,
  onSaved,
  onError,
}: SetupPromptDialogProps) {
  const { byId: catalogById } = useMachineCatalog();
  const { activeStudio, activeStudioId } = useActiveStudio();

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

  const journal: JournalContext = useMemo(
    () => ({
      studioId: activeStudioId || activeStudio?.id || "",
      origin: "in_session",
      sessionId: sessionId ?? null,
    }),
    [activeStudioId, activeStudio, sessionId],
  );

  if (!equipment) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[86dvh] overflow-y-auto p-0 border-0 bg-transparent shadow-none">
        <div className="eq eq-prompt">
          <header className="eq-prompt__head">
            <span className="eq-prompt__kicker">First time on this machine</span>
            <h2 className="eq-detail__name">{equipment.name}</h2>
            <p className="eq-prompt__sub">
              Set it up for this client before the first set. The studio standard is shown as a
              hint — nothing is saved until you confirm.
            </p>
          </header>

          <div className="eq-prompt__body">
            <SettingsCard
              machine={equipment}
              clientId={clientId}
              author={author}
              journal={journal}
              startEditing
              onSaved={() => {
                onSaved?.();
                onClose();
              }}
              onError={onError}
            />

            {equipment.guide && <SetupGuide guide={equipment.guide} defaultOpen />}
          </div>

          <footer className="eq-prompt__foot">
            <button type="button" className="eq-btn eq-btn--ghost" onClick={onClose}>
              Skip for now
            </button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
