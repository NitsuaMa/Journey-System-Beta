/**
 * STUDIO SETUP — this location's settings for ONE machine.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WHY THIS IS IN THE CATALOG AND NOT IN SETTINGS
 * ---------------------------------------------
 * It used to be "Equipment Settings Setup": a grid of every machine at the
 * studio, living inside the trainer's Hub Settings. Three reasons it moved
 * here rather than staying as a shortcut:
 *
 *   1. A shortcut re-creates the bloat the teardown removes. The moment
 *      Trainer Settings owns an editor, however light, the next feature has a
 *      precedent to land there too. The screen stays thin only if it owns
 *      nothing.
 *   2. MachineDetail already renders setup notes, execution, musculature,
 *      contraindications, upkeep and studio notes for exactly one machine at
 *      exactly one studio. This studio's settings for that machine are the
 *      missing section, not a separate destination.
 *   3. It matches the physical workflow. A leader changing the gap range on
 *      the Hip Adduction is standing at the Hip Adduction, so they open it in
 *      the Catalog. Splitting machine SETTINGS into Settings while machine
 *      everything-else lives in Catalog is a mental model split with no payoff.
 *
 * READ-ONLY IS A FEATURE, NOT A CONSOLATION
 * -----------------------------------------
 * Trainers below studio leader see the values and cannot change them. That is
 * not a stripped-down state to apologise for: "what is the studio standard gap
 * on this machine" is a question trainers ask constantly, and the settings are
 * what they read to preset a machine as they walk up to it. Hiding them from
 * the people who use them would be the wrong kind of lockdown.
 *
 * Writes go to studioMachineSettings/{studioId}_{machineId} - the same
 * document TrainerMachineEditor wrote, so nothing about the data changes and
 * every existing reader (the journey grid, the session table) keeps working.
 */

import React, { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Check, Lock, Plus, X } from "lucide-react";
import { db } from "../../firebase";
import { useToast } from "../../contexts/ToastContext";
import type { StudioMachineSetting } from "../../types";

export interface StudioSetupCardProps {
  machineId: string;
  machineName: string;
  studioId: string | null;
  /** This studio's stored overrides, if any. */
  setting?: StudioMachineSetting;
  /** Studio leader and above. Everyone else reads. */
  canEdit: boolean;
  authorId?: string | null;
}

export function StudioSetupCard({
  machineId,
  machineName,
  studioId,
  setting,
  canEdit,
  authorId,
}: StudioSetupCardProps) {
  const { success: toastSuccess, error: toastError } = useToast();

  const [options, setOptions] = useState<string[]>([]);
  const [standard, setStandard] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-seed when the trainer taps a different machine in the rail. Keyed on
  // machineId as well as the document so switching machines never carries the
  // previous machine's unsaved edits across - which would be a silent way to
  // write the leg press's gap range onto the pulldown.
  useEffect(() => {
    setOptions(setting?.settingOptions ?? []);
    setStandard(setting?.standardSettings ?? {});
    setDraft("");
    setDirty(false);
  }, [machineId, setting]);

  const addOption = () => {
    const name = draft.trim();
    if (!name) return;
    if (options.some((o) => o.toLowerCase() === name.toLowerCase())) {
      toastError(`${machineName} already has a "${name}" setting.`);
      return;
    }
    setOptions((prev) => [...prev, name]);
    setDraft("");
    setDirty(true);
  };

  const removeOption = (name: string) => {
    setOptions((prev) => prev.filter((o) => o !== name));
    setStandard((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!studioId) {
      toastError("No active studio — cannot save these settings.");
      return;
    }
    setBusy(true);
    try {
      // Merge, never replace: this document also carries `order` and
      // `isActive`, written by the admin machines tab. A full overwrite here
      // would silently drop a studio's display order every time someone
      // renamed a setting.
      await setDoc(
        doc(db, "studioMachineSettings", `${studioId}_${machineId}`),
        {
          studioId,
          machineId,
          settingOptions: options,
          standardSettings: standard,
          updatedAt: serverTimestamp(),
          updatedBy: authorId ?? null,
        },
        { merge: true },
      );
      setDirty(false);
      toastSuccess(`${machineName} settings saved for this studio.`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toastError(`Could not save: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  if (options.length === 0 && !canEdit) {
    return (
      <p className="ssc__empty">
        No studio settings recorded for {machineName} yet.
      </p>
    );
  }

  return (
    <div className="ssc">
      {!canEdit && (
        <p className="ssc__readonly">
          <Lock size={12} aria-hidden />
          <span>
            Studio standards, set by your studio leader. Read these to preset
            the machine before your client reaches it.
          </span>
        </p>
      )}

      {options.length === 0 ? (
        <p className="ssc__empty">
          Nothing set up yet. Add the adjustments this machine has — gap, seat,
          back pad — and the standard each one sits at.
        </p>
      ) : (
        <ul className="ssc__rows">
          {options.map((name) => (
            <li key={name} className="ssc__row">
              <span className="ssc__name">{name}</span>
              {canEdit ? (
                <input
                  className="ssc__value"
                  value={standard[name] ?? ""}
                  placeholder="—"
                  inputMode="text"
                  onChange={(e) => {
                    const v = e.target.value;
                    setStandard((prev) => ({ ...prev, [name]: v }));
                    setDirty(true);
                  }}
                  aria-label={`Standard ${name} for ${machineName}`}
                />
              ) : (
                <span className="ssc__value ssc__value--static">
                  {standard[name] || "—"}
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="ssc__remove"
                  onClick={() => removeOption(name)}
                  aria-label={`Remove ${name}`}
                >
                  <X size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <div className="ssc__add">
            <input
              className="ssc__draft"
              value={draft}
              placeholder="Add a setting (Gap, Seat, Back pad…)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
              aria-label={`Add a setting to ${machineName}`}
            />
            <button
              type="button"
              className="ssc__addbtn"
              onClick={addOption}
              disabled={!draft.trim()}
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>

          <button
            type="button"
            className="ssc__save"
            onClick={save}
            disabled={!dirty || busy}
          >
            <Check size={14} aria-hidden />
            {busy ? "Saving…" : dirty ? "Save for this studio" : "Saved"}
          </button>
        </>
      )}
    </div>
  );
}
