import React, { useMemo, useState } from "react";
import {
  collectionGroup, doc, getCountFromServer, query, serverTimestamp,
  setDoc, updateDoc, where,
} from "firebase/firestore";
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
  Plus, Search, Archive, Pencil, ShieldAlert, Loader2, RotateCcw,
} from "lucide-react";
import { useMachineCatalog } from "../../hooks/useMachineCatalog";
import { useToast } from "../../contexts/ToastContext";
import {
  MachineCatalogEntry, MachineDefinition,
} from "../../types/machines";
import {
  MachineDefinitionForm,
  emptyMachineDefinition,
  normalizeMachineDefinition,
} from "./MachineDefinitionForm";

/**
 * ADMIN MACHINE CREATOR — the "Machines" tab.
 *
 * Round: Machine Creator & Studio Roster, Sep 2026.
 *
 * CRUD over the global catalog: the default set every studio picks from.
 * Admin-write only (isSuperAdmin in firestore.rules) — a franchise owner
 * editing here would change the starting point for all 100+ locations, and
 * every field a studio has not deliberately overridden stays live-inherited.
 *
 * There is no delete. `allow delete: if false` in the rules, because a
 * retired machine's document is still referenced by every exerciseLog ever
 * written against it. Retiring sets status and pulls it from the picker.
 */

/** 'LEG PRESS' -> 'm-leg-press'. Matches the existing catalog id convention. */
function catalogId(name: string): string {
  return (
    "m-" +
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
  );
}

export function AdminMachineCreator() {
  const { catalog, loading } = useMachineCatalog();
  const { success: toastSuccess, error: toastError } = useToast();

  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<MachineCatalogEntry | null>(null);
  const [draft, setDraft] = useState<MachineDefinition | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((m) => (showRetired ? true : m.status !== "retired"))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.includes(q))
      .sort((a, b) => (a.defaultOrder ?? 999) - (b.defaultOrder ?? 999));
  }, [catalog, search, showRetired]);

  const openNew = () => {
    setIsNew(true);
    setEditing(null);
    setDraft(emptyMachineDefinition());
  };

  const openEdit = (m: MachineCatalogEntry) => {
    setIsNew(false);
    setEditing(m);
    // Strip catalog-only bookkeeping so the form sees a plain definition.
    const { id, status, defaultOrder, inStandardSet, schemaVersion,
      createdAt, createdBy, updatedAt, updatedBy, ...definition } = m;
    // Normalize, do not cast: machines saved before a field existed are
    // missing it entirely, and the form dereferences nested objects directly.
    setDraft(normalizeMachineDefinition(definition));
  };

  const close = () => { setDraft(null); setEditing(null); setIsNew(false); };

  const handleSave = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toastError("Give the machine a name first."); return; }

    const id = editing?.id ?? catalogId(name);
    if (isNew && catalog.some((m) => m.id === id)) {
      toastError(`A machine with the id ${id} already exists.`);
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "machines", id),
        {
          ...draft,
          id,
          status: editing?.status ?? "active",
          defaultOrder: editing?.defaultOrder ?? (catalog.length + 1) * 10,
          inStandardSet: editing?.inStandardSet ?? true,
          schemaVersion: 1,
          ...(isNew
            ? { createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid ?? null }
            : {}),
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid ?? null,
        },
        { merge: true },
      );
      toastSuccess(`${name} saved to the global catalog.`);
      close();
    } catch (err) {
      console.error(err);
      toastError("Could not save. Catalog writes are admin-only.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Retire, but tell the admin how many locations still run it first.
   * Uses the roster collection-group index on `basedOn`.
   */
  const handleRetire = async (m: MachineCatalogEntry) => {
    setRetiring(m.id);
    try {
      let inUse = 0;
      try {
        const snap = await getCountFromServer(
          query(collectionGroup(db, "roster"), where("basedOn", "==", m.id)),
        );
        inUse = snap.data().count;
      } catch {
        // Index still building — retire anyway, just without the count.
        inUse = -1;
      }

      if (inUse > 0) {
        const ok = window.confirm(
          `${inUse} studio roster${inUse === 1 ? "" : "s"} still reference ${m.name}.\n\n` +
            `Retiring hides it from the picker for new studios. Locations that ` +
            `already have it keep it, and their logs are unaffected.\n\nRetire anyway?`,
        );
        if (!ok) { setRetiring(null); return; }
      }

      await updateDoc(doc(db, "machines", m.id), {
        status: m.status === "retired" ? "active" : "retired",
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid ?? null,
      });
      toastSuccess(
        m.status === "retired" ? `${m.name} restored.` : `${m.name} retired.`,
      );
    } catch (err) {
      console.error(err);
      toastError("Could not change status.");
    } finally {
      setRetiring(null);
    }
  };

  const toggleStandardSet = async (m: MachineCatalogEntry) => {
    try {
      await updateDoc(doc(db, "machines", m.id), {
        inStandardSet: !m.inStandardSet,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid ?? null,
      });
    } catch (err) {
      console.error(err);
      toastError("Could not update the standard set.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Machines</h2>
          <p className="text-sm text-muted-foreground">
            The global catalog. Studios pick from this set and may override any field
            for their own location.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" /> New machine
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search machines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showRetired} onCheckedChange={setShowRetired} />
          Show retired
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {catalog.length === 0
                ? "The catalog is empty. Create the first machine to get started."
                : "No machines match that search."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((m) => (
            <Card key={m.id} className={m.status === "retired" ? "opacity-60" : ""}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold uppercase">{m.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{m.id}</Badge>
                    {m.status === "retired" && <Badge variant="secondary">Retired</Badge>}
                    {m.status === "draft" && <Badge variant="secondary">Draft</Badge>}
                    {m.execution?.neverToFailure && (
                      <Badge variant="destructive" className="gap-1">
                        <ShieldAlert className="h-3 w-3" /> Never to failure
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {m.movementPattern} · {m.anatomicalRegion} ·{" "}
                    {m.execution?.concentricSeconds ?? 6}s/{m.execution?.eccentricSeconds ?? 6}s
                    {m.execution?.requiresHandoff ? " · handoff" : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <label className="mr-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Switch
                      checked={m.inStandardSet}
                      onCheckedChange={() => toggleStandardSet(m)}
                    />
                    Standard set
                  </label>
                  <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    disabled={retiring === m.id}
                    onClick={() => handleRetire(m)}
                  >
                    {retiring === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : m.status === "retired" ? (
                      <><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore</>
                    ) : (
                      <><Archive className="mr-1.5 h-3.5 w-3.5" /> Retire</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tight">
              {isNew ? "New machine" : `Edit ${editing?.name}`}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <>
              {isNew && draft.name.trim() && (
                <p className="text-xs text-muted-foreground">
                  Will be saved as{" "}
                  <span className="font-mono text-foreground">{catalogId(draft.name)}</span>
                </p>
              )}
              <MachineDefinitionForm value={draft} onChange={setDraft} />
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background pt-3">
                <Button variant="ghost" onClick={close}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {isNew ? "Create machine" : "Save changes"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
