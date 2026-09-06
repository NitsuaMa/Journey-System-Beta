import React, { useMemo, useState } from "react";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus, Search, Loader2, Wrench, CheckCircle2, Sparkles, ShieldAlert,
} from "lucide-react";
import { useStudioMachines } from "../../hooks/useStudioMachines";
import { useToast } from "../../contexts/ToastContext";
import {
  MachineDefinition, RosterStatus, studioMachineId,
} from "../../types/machines";
import { MachineDefinitionForm, emptyMachineDefinition } from "./MachineDefinitionForm";

/**
 * STUDIO INVENTORY MANAGER — what THIS location actually has.
 *
 * Round: Machine Creator & Studio Roster, Sep 2026.
 *
 * Studio owners and studio leaders pick their equipment from the global
 * catalog and add machines the catalog has never heard of. Writes go to
 * studios/{studioId}/roster/{machineId}; tenancy is enforced by that path in
 * firestore.rules, so a trainer at one location cannot touch another's roster.
 *
 * A roster entry is either:
 *   source 'catalog' — inherits the catalog entry, overrides any field
 *   source 'custom'  — the studio's own definition, with `basedOn` lineage
 *
 * `basedOn` on a custom machine inherits nothing. It exists so a location's
 * bespoke leg press still rolls up against every other leg press in network
 * reporting instead of becoming its own incomparable island.
 */
export function StudioInventoryManager({
  studioId,
  studioName,
}: {
  studioId: string | null;
  studioName?: string;
}) {
  const { machines, catalog, rosterEntries, loading } = useStudioMachines(studioId, {
    includeInactive: true,
    includeUnrostered: true,
  });
  const { success: toastSuccess, error: toastError } = useToast();

  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<MachineDefinition | null>(null);
  const [customBasedOn, setCustomBasedOn] = useState<string>("");
  const [savingCustom, setSavingCustom] = useState(false);

  const rosteredIds = useMemo(
    () => new Set(rosterEntries.map((e) => e.machineId)),
    [rosterEntries],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [machines, search]);

  const ownedCount = machines.filter(
    (m) => rosteredIds.has(m.machineId) && m.rosterStatus !== "inactive",
  ).length;

  if (!studioId) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Select a studio to manage its equipment.
          </p>
        </CardContent>
      </Card>
    );
  }

  /** Add a catalog machine to this roster, or flip its status. */
  const setRosterStatus = async (machineId: string, status: RosterStatus) => {
    setBusy(machineId);
    try {
      const isCustom = rosterEntries.find(
        (e) => e.machineId === machineId && e.source === "custom",
      );
      await setDoc(
        doc(db, "studios", studioId, "roster", machineId),
        {
          machineId,
          studioId,
          status,
          ...(isCustom ? {} : { source: "catalog", basedOn: machineId }),
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid ?? null,
        },
        { merge: true },
      );
    } catch (err) {
      console.error(err);
      toastError("Could not update the roster. Studio leads and admins only.");
    } finally {
      setBusy(null);
    }
  };

  /** Remove entirely — only safe for equipment never used in a session. */
  const removeFromRoster = async (machineId: string) => {
    setBusy(machineId);
    try {
      await deleteDoc(doc(db, "studios", studioId, "roster", machineId));
    } catch (err) {
      console.error(err);
      toastError("Could not remove that machine.");
    } finally {
      setBusy(null);
    }
  };

  /** Onboarding shortcut: adopt everything flagged inStandardSet. */
  const adoptStandardSet = async () => {
    setBusy("__standard__");
    try {
      const targets = catalog.filter(
        (c) => c.inStandardSet && c.status === "active" && !rosteredIds.has(c.id),
      );
      await Promise.all(
        targets.map((c) =>
          setDoc(
            doc(db, "studios", studioId, "roster", c.id),
            {
              machineId: c.id,
              studioId,
              source: "catalog",
              basedOn: c.id,
              status: "active",
              updatedAt: serverTimestamp(),
              updatedBy: auth.currentUser?.uid ?? null,
            },
            { merge: true },
          ),
        ),
      );
      toastSuccess(`Added ${targets.length} machines to ${studioName ?? "this studio"}.`);
    } catch (err) {
      console.error(err);
      toastError("Could not add the standard set.");
    } finally {
      setBusy(null);
    }
  };

  const saveCustom = async () => {
    if (!customDraft) return;
    const name = customDraft.name.trim();
    if (!name) { toastError("Give the machine a name first."); return; }

    const machineId = studioMachineId(studioId, name);
    if (rosteredIds.has(machineId)) {
      toastError("This studio already has a machine with that name.");
      return;
    }

    setSavingCustom(true);
    try {
      await setDoc(doc(db, "studios", studioId, "roster", machineId), {
        machineId,
        studioId,
        source: "custom",
        ...(customBasedOn ? { basedOn: customBasedOn } : {}),
        status: "active",
        definition: customDraft,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid ?? null,
      });
      toastSuccess(`${name} added to ${studioName ?? "this studio"}.`);
      setCustomDraft(null);
      setCustomBasedOn("");
    } catch (err) {
      console.error(err);
      toastError("Could not save the machine.");
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">
            Equipment {studioName ? `· ${studioName}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            {ownedCount} machine{ownedCount === 1 ? "" : "s"} in service. Trainers running a
            session here see exactly this list.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={adoptStandardSet}
            disabled={busy === "__standard__"}
          >
            {busy === "__standard__"
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <Sparkles className="mr-1.5 h-4 w-4" />}
            Add standard set
          </Button>
          <Button onClick={() => setCustomDraft(emptyMachineDefinition())}>
            <Plus className="mr-1.5 h-4 w-4" /> Custom machine
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search equipment"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading equipment…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((m) => {
            const rostered = rosteredIds.has(m.machineId);
            const owned = rostered && m.rosterStatus !== "inactive";
            return (
              <Card
                key={m.machineId}
                className={owned ? "" : "opacity-60"}
              >
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold uppercase">{m.name}</span>
                      {m.source === "custom" && (
                        <Badge variant="secondary" className="text-[10px]">Ours</Badge>
                      )}
                      {m.rosterStatus === "maintenance" && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Wrench className="h-3 w-3" /> Maintenance
                        </Badge>
                      )}
                      {m.overriddenFields.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {m.overriddenFields.length} override
                          {m.overriddenFields.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {m.catalogStatus === "retired" && (
                        <Badge variant="secondary" className="text-[10px]">
                          Retired from catalog
                        </Badge>
                      )}
                      {m.execution?.neverToFailure && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <ShieldAlert className="h-3 w-3" /> Never to failure
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {m.movementPattern} · gap {m.universalBaseline?.startingWeightStackGap || "—"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {owned && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch
                          checked={m.rosterStatus === "maintenance"}
                          onCheckedChange={(c) =>
                            setRosterStatus(m.machineId, c ? "maintenance" : "active")
                          }
                        />
                        Out of service
                      </label>
                    )}

                    {owned ? (
                      <Button
                        variant="ghost" size="sm"
                        disabled={busy === m.machineId}
                        onClick={() =>
                          m.source === "custom"
                            ? removeFromRoster(m.machineId)
                            : setRosterStatus(m.machineId, "inactive")
                        }
                      >
                        {busy === m.machineId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : "We don't have this"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline" size="sm"
                        disabled={busy === m.machineId}
                        onClick={() => setRosterStatus(m.machineId, "active")}
                      >
                        {busy === m.machineId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> We have this</>}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!customDraft} onOpenChange={(o) => !o && setCustomDraft(null)}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tight">
              Add a custom machine
            </DialogTitle>
          </DialogHeader>

          {customDraft && (
            <>
              <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                <span className="text-xs font-semibold">Which machine is this most like?</span>
                <select
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={customBasedOn}
                  onChange={(e) => setCustomBasedOn(e.target.value)}
                >
                  <option value="">None — genuinely novel equipment</option>
                  {catalog
                    .filter((c) => c.status === "active")
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Nothing is inherited from this. It only lets network reporting compare
                  your unit against the same movement at other locations — without it,
                  your leg press becomes its own one-studio leaderboard.
                </p>
              </div>

              <MachineDefinitionForm value={customDraft} onChange={setCustomDraft} />

              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background pt-3">
                <Button variant="ghost" onClick={() => setCustomDraft(null)}>Cancel</Button>
                <Button onClick={saveCustom} disabled={savingCustom}>
                  {savingCustom && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Add to {studioName ?? "this studio"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
