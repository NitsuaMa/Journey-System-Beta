import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc,
} from "firebase/firestore";
import {
  Building2, Globe2, Loader2, Pencil, Plus, Trash2, Upload,
} from "lucide-react";
import { auth, db } from "../../firebase";
import { RoutinePreset, RoutinePresetTier, Studio, Trainer } from "../../types";
import { useMachineCatalog } from "../../hooks/useMachineCatalog";
import { OperationType, handleFirestoreError } from "../../lib/firestore-errors";
import { canAuthorTier, normalizeRoutinePreset } from "../../lib/routine-templates";
import { useToast } from "../../contexts/ToastContext";
import { RoutineTemplateForm, emptyRoutineTemplate } from "./RoutineTemplateForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * ROUTINE TEMPLATES — the admin hub's programming section.
 *
 * Round: Routine Template Builder, Sep 2026.
 *
 * Deliberately shaped like AdminMachinesTab, because it is the same two-layer
 * model and staff should only have to learn it once:
 *
 *   Company Standards   every studio sees these. Admin-write only.
 *   Studio Templates    what ONE location adds for itself. That studio's
 *                       owner/leader, or an admin.
 *
 * The third tier -- presets a trainer saved ad-hoc from the routine drawer --
 * is shown read-only at the bottom of Studio Templates. Leaders could not
 * see those at all before, which meant the thing trainers actually reach for
 * was invisible to the people responsible for standards. A leader can
 * promote a good one into a studio template in one tap.
 */

type SubTab = "company" | "studio";

export function AdminRoutineTemplatesTab({
  studios,
  authTrainer,
}: {
  studios: Studio[];
  authTrainer?: Trainer | null;
  isAdmin?: boolean;
}) {
  const { catalog } = useMachineCatalog();
  const { success: toastSuccess, error: toastError } = useToast();

  const canCompany = canAuthorTier(authTrainer, "company");
  const canStudio = canAuthorTier(authTrainer, "studio");

  const [subTab, setSubTab] = useState<SubTab>(canCompany ? "company" : "studio");
  const [presets, setPresets] = useState<RoutinePreset[]>([]);
  const [draft, setDraft] = useState<RoutinePreset | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Live, unfiltered: the tiers are split in memory rather than with three
  // separate queries, because the collection is small and one listener keeps
  // the tiers consistent with each other.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "routinePresets"),
      (snap) =>
        setPresets(
          snap.docs.map((d) => normalizeRoutinePreset({ id: d.id, ...d.data() })),
        ),
      (err) => handleFirestoreError(err, OperationType.GET, "routine templates"),
    );
    return () => unsub();
  }, []);

  const sortedStudios = useMemo(
    () => [...studios].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [studios],
  );

  const [pickedStudioId, setPickedStudioId] = useState<string | null>(null);
  const home = authTrainer?.primaryHomeStudioId;
  const fallbackStudioId =
    (home && sortedStudios.some((s) => s.id === home) ? home : null) ??
    sortedStudios[0]?.id ??
    null;
  const studioId = pickedStudioId ?? fallbackStudioId;

  const companyTemplates = useMemo(
    () => presets.filter((p) => p.tier === "company").sort(byName),
    [presets],
  );
  const studioTemplates = useMemo(
    () =>
      presets
        .filter((p) => p.tier === "studio" && p.studioId === studioId)
        .sort(byName),
    [presets, studioId],
  );
  const trainerPresets = useMemo(
    () =>
      presets
        .filter((p) => p.tier === "trainer" && p.studioId === studioId)
        .sort(byName),
    [presets, studioId],
  );

  const openNew = (tier: RoutinePresetTier) => {
    setEditingId(null);
    setDraft({
      ...emptyRoutineTemplate(),
      tier,
      scope: tier === "company" ? "global" : (studioId ?? ""),
      studioId: tier === "company" ? undefined : (studioId ?? undefined),
    });
  };

  const openEdit = (p: RoutinePreset) => {
    setEditingId(p.id ?? null);
    setDraft(normalizeRoutinePreset(p));
  };

  const close = () => { setDraft(null); setEditingId(null); };

  const handleSave = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toastError("Give the template a name first."); return; }
    if (draft.machineIds.length === 0) {
      toastError("A template needs at least one machine.");
      return;
    }
    const tier = draft.tier ?? "company";
    if (tier === "studio" && !draft.studioId) {
      toastError("Pick a studio for this template first.");
      return;
    }

    setSaving(true);
    try {
      const uid = auth.currentUser?.uid ?? null;
      const base = {
        name,
        description: draft.description?.trim() ?? "",
        machineIds: draft.machineIds,
        machineNotes: draft.machineNotes ?? {},
        tier,
        scope: tier === "company" ? "global" : draft.studioId!,
        // Omitted, not null, for company templates: the rules read
        // studioId through .get(...,'') and an absent field is the honest
        // representation of "this belongs to no single studio".
        ...(tier === "studio" ? { studioId: draft.studioId } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };

      if (editingId) {
        await setDoc(doc(db, "routinePresets", editingId), base, { merge: true });
      } else {
        await addDoc(collection(db, "routinePresets"), {
          ...base,
          createdAt: serverTimestamp(),
          createdBy: uid,
          createdByName: authTrainer?.fullName ?? "Admin",
        });
      }
      toastSuccess(`"${name}" saved.`);
      close();
    } catch (err) {
      console.error(err);
      toastError(
        tier === "company"
          ? "Could not save. Company standards are admin-only."
          : "Could not save. Studio templates need studio owner or leader access.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: RoutinePreset) => {
    if (!p.id) return;
    setBusyId(p.id);
    try {
      await deleteDoc(doc(db, "routinePresets", p.id));
      toastSuccess(`"${p.name}" deleted.`);
    } catch (err) {
      console.error(err);
      toastError("Could not delete that template.");
    } finally {
      setBusyId(null);
    }
  };

  /** Copy a trainer's ad-hoc preset up into a studio template. */
  const handlePromote = async (p: RoutinePreset) => {
    if (!studioId) return;
    setBusyId(p.id ?? null);
    try {
      await addDoc(collection(db, "routinePresets"), {
        name: p.name,
        description: p.description ?? "",
        machineIds: p.machineIds,
        machineNotes: p.machineNotes ?? {},
        tier: "studio",
        scope: studioId,
        studioId,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid ?? null,
        createdByName: authTrainer?.fullName ?? "Admin",
      });
      toastSuccess(`"${p.name}" promoted to a studio template.`);
    } catch (err) {
      console.error(err);
      toastError("Could not promote that preset.");
    } finally {
      setBusyId(null);
    }
  };

  const nameFor = (id: string) =>
    catalog.find((m) => m.id === id)?.name ?? id;

  const subTabs: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
    { id: "company", label: "Company Standards", icon: <Globe2 className="h-4 w-4" /> },
    { id: "studio", label: "Studio Templates", icon: <Building2 className="h-4 w-4" /> },
  ];

  const list = subTab === "company" ? companyTemplates : studioTemplates;
  const canEditHere = subTab === "company" ? canCompany : canStudio;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-slate-200/60 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
          {subTabs.map((t) => {
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all sm:text-[11px] ${
                  active
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>

        {subTab === "studio" && sortedStudios.length > 0 && (
          <select
            value={studioId ?? ""}
            onChange={(e) => setPickedStudioId(e.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-xs font-semibold"
          >
            {sortedStudios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {subTab === "company"
          ? "The house standard. Every studio sees these, and they are what a trainer reaches for first. Admin-write only."
          : "Templates for this location only. Its owner or leader can add them; admins can edit any studio's."}
      </p>

      <div className="flex justify-end">
        <Button
          className="min-h-10"
          disabled={!canEditHere || (subTab === "studio" && !studioId)}
          onClick={() => openNew(subTab === "company" ? "company" : "studio")}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New {subTab === "company" ? "company standard" : "studio template"}
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No {subTab === "company" ? "company standards" : "templates for this studio"} yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-2 p-4">
                <h4 className="text-sm font-bold">{p.name}</h4>
                {p.description && (
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                )}
                <ol className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  {p.machineIds.map((id, i) => (
                    <li key={id} className="truncate">
                      {i + 1}. {nameFor(id)}
                      {p.machineNotes?.[id] && (
                        <span className="text-amber-600 dark:text-amber-500"> · note</span>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="mt-auto flex gap-2 pt-3">
                  <Button
                    size="sm" variant="outline" className="min-h-10 flex-1"
                    disabled={!canEditHere}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="min-h-10 text-destructive"
                    disabled={!canEditHere || busyId === p.id}
                    onClick={() => handleDelete(p)}
                  >
                    {busyId === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Trainer-saved presets, read-only, with promotion. */}
      {subTab === "studio" && trainerPresets.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <h4 className="text-sm font-bold uppercase tracking-wide">
            Saved by trainers at this studio
          </h4>
          <p className="text-xs text-muted-foreground">
            Ad-hoc presets trainers saved themselves. Promote one to make it an
            official studio template; the trainer's original is left alone.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {trainerPresets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{p.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {p.machineIds.length} machines · {p.createdByName ?? "a trainer"}
                  </p>
                </div>
                <Button
                  size="sm" variant="outline" className="min-h-10"
                  disabled={!canStudio || busyId === p.id}
                  onClick={() => handlePromote(p)}
                >
                  {busyId === p.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Upload className="mr-1.5 h-3.5 w-3.5" /> Promote</>}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tight">
              {editingId ? `Edit ${draft?.name || "template"}` : "New template"}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <>
              <RoutineTemplateForm
                value={draft}
                onChange={setDraft}
                catalog={catalog}
              />
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background pt-3">
                <Button variant="ghost" className="min-h-10" onClick={close}>
                  Cancel
                </Button>
                <Button className="min-h-10" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {editingId ? "Save changes" : "Create template"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const byName = (a: RoutinePreset, b: RoutinePreset) =>
  (a.name || "").localeCompare(b.name || "");
