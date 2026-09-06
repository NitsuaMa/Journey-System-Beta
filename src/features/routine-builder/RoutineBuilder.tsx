/**
 * THE ROUTINE BUILDER.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * One component behind every surface where a machine sequence is built or
 * edited: the client profile, both halves of the pre-session briefing, the
 * live session, and the standalone/admin template builder. See types.ts for
 * why it is controlled and what each mode changes.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 * Above 900px (landscape iPad) the figure, coverage, suggestions and picker
 * live in a rail beside the list. Below it (portrait) the rail collapses to a
 * 40px coverage strip at the top and a three-button bar at the bottom that
 * opens the same content in bottom sheets.
 *
 * The rule that decides every layout question here: a standard routine runs
 * up to eight machines and all eight must be visible without scrolling. The
 * figure, the suggestions and the warnings all arrange themselves around that
 * and never on top of it — which is why portrait loses the figure rather than
 * shortening the list.
 *
 * ── Warnings ──────────────────────────────────────────────────────────────
 * Adjacency problems mark the two rows involved with a coloured left edge and
 * render their card immediately beneath the pair, so the warning is next to
 * the thing it is about. Same-session cautions are not about a position, so
 * they collect under the list.
 */

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AlertTriangle, Lightbulb, ListPlus, Wand2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "../../lib/utils";
import { canonicalMachineId } from "../catalog/machine-identity";
import { CoverageStrip } from "./CoverageStrip";
import { MachinePicker } from "./MachinePicker";
import { RotationPanel } from "./RotationPanel";
import { RoutineFigure } from "./RoutineFigure";
import { SequenceMachineRow } from "./SequenceMachineRow";
import { SuggestionRail } from "./SuggestionRail";
import { ViolationCard } from "./ViolationCard";
import { MACHINE_ABBR, asAcademyString } from "./academy";
import {
  activeTemplates,
  analyzeRotation,
  analyzeRoutine,
  autoSequence,
  normalizeIds,
  suggestMachines,
} from "./engine";
import { MODE_CONFIG, type RoutineBuilderProps } from "./types";
import "./routine-builder.css";

type SheetKind = "picker" | "ideas" | "warnings" | "figure" | null;

export function RoutineBuilder({
  mode,
  machineIds,
  onChange,
  machines,
  slot = null,
  counterpartMachineIds = null,
  counterpartLabel,
  client = null,
  history,
  presets,
  onApplyPreset,
  appliedPresetId,
  machineNotes,
  onMachineNotesChange,
  purposeText,
  templateIds,
  onTemplateIdsChange,
  established = false,
  disabled = false,
  className,
  headerActions,
}: RoutineBuilderProps) {
  const cfg = MODE_CONFIG[mode];
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);

  const ids = useMemo(() => normalizeIds(machineIds), [machineIds]);

  /* ── Names ──────────────────────────────────────────────────────────────
     Keyed by canonical id so a routine holding a legacy id still resolves to
     the studio's machine document rather than rendering the raw id. */
  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of machines) {
      const id = canonicalMachineId(m.id, m.name);
      if (id) map[id] = m.name || m.fullName || id;
    }
    return map;
  }, [machines]);

  const machineName = useCallback(
    (id: string) => nameById[id] ?? MACHINE_ABBR[id] ?? id,
    [nameById],
  );

  const availableIds = useMemo(
    () => machines.map((m) => canonicalMachineId(m.id, m.name)).filter(Boolean),
    [machines],
  );

  const pickerMachines = useMemo(
    () =>
      availableIds
        .map((id) => ({ id, name: machineName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableIds, machineName],
  );

  /* ── Analysis ───────────────────────────────────────────────────────── */

  const analysis = useMemo(
    () => analyzeRoutine(ids, { names: nameById, established }),
    [ids, nameById, established],
  );

  const rotation = useMemo(
    () =>
      cfg.showRotation && counterpartMachineIds && counterpartMachineIds.length > 0
        ? analyzeRotation(ids, counterpartMachineIds)
        : null,
    [cfg.showRotation, counterpartMachineIds, ids],
  );

  const suggestions = useMemo(
    () =>
      cfg.showSuggestions
        ? suggestMachines({
            machineIds: ids,
            available: availableIds,
            counterpart: counterpartMachineIds ?? undefined,
            purposeText,
            templateIds,
            slot: slot ?? undefined,
            names: nameById,
            limit: 5,
          })
        : [],
    [cfg.showSuggestions, ids, availableIds, counterpartMachineIds, purposeText, templateIds, slot, nameById],
  );

  const templates = useMemo(
    () => activeTemplates({ machineIds: ids, available: availableIds, purposeText, templateIds }),
    [ids, availableIds, purposeText, templateIds],
  );

  /** Highest severity each position participates in. */
  const severityByIndex = useMemo(() => {
    const map = new Map<number, "avoid" | "caution">();
    for (const v of analysis.violations) {
      for (const i of v.indices) {
        if (v.severity === "avoid" || !map.has(i)) map.set(i, v.severity);
      }
    }
    return map;
  }, [analysis.violations]);

  /** Adjacency cards render under the pair; session cards collect at the end. */
  const adjacentAfterIndex = useMemo(() => {
    const map = new Map<number, typeof analysis.violations>();
    for (const v of analysis.violations) {
      if (v.scope !== "adjacent") continue;
      const at = v.indices[1];
      map.set(at, [...(map.get(at) ?? []), v]);
    }
    return map;
  }, [analysis.violations]);

  const sessionViolations = analysis.violations.filter((v) => v.scope === "session");
  const avoidCount = analysis.violations.filter((v) => v.severity === "avoid").length;

  /* ── Mutations ──────────────────────────────────────────────────────── */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(ids, from, to));
  };

  const add = useCallback(
    (machineId: string) => {
      const id = canonicalMachineId(machineId);
      if (!id || ids.includes(id)) return;
      onChange([...ids, id]);
    },
    [ids, onChange],
  );

  const remove = useCallback(
    (machineId: string) => onChange(ids.filter((m) => m !== machineId)),
    [ids, onChange],
  );

  const applyFix = useCallback(
    (apply: (current: string[]) => string[]) => onChange(apply(ids)),
    [ids, onChange],
  );

  const runAutoSequence = useCallback(() => onChange(autoSequence(ids)), [ids, onChange]);

  const setNote = (machineId: string, text: string) => {
    if (!onMachineNotesChange) return;
    const next = { ...(machineNotes ?? {}) };
    if (text.trim()) next[machineId] = text;
    else delete next[machineId];
    onMachineNotesChange(next);
  };

  /* ── Pieces reused by rail and sheets ───────────────────────────────── */

  const picker = (
    <MachinePicker
      machines={pickerMachines}
      selectedIds={ids}
      coverage={analysis.byCategory}
      onAdd={add}
      onRemove={disabled ? undefined : remove}
      onPreview={setPreview}
    />
  );

  const ideas = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {rotation && (
        <RotationPanel
          rotation={rotation}
          slot={slot}
          counterpartLabel={counterpartLabel ?? (slot === "B" ? "Routine A" : "the other routine")}
          machineName={machineName}
          available={availableIds}
          gender={client?.gender}
          templates={templates}
          activeTemplateIds={templateIds ?? []}
          onToggleTemplate={
            onTemplateIdsChange
              ? (id) =>
                  onTemplateIdsChange(
                    (templateIds ?? []).includes(id)
                      ? (templateIds ?? []).filter((t) => t !== id)
                      : [...(templateIds ?? []), id],
                  )
              : undefined
          }
          onSeed={disabled ? undefined : (next) => onChange(next)}
          canSeed={ids.length === 0}
          isEmpty={ids.length === 0}
        />
      )}

      {cfg.showSuggestions && (
        <div>
          <div className="rb-sect__label">
            <Lightbulb size={12} aria-hidden />
            Suggested next
          </div>
          <SuggestionRail
            suggestions={suggestions}
            machineName={machineName}
            onAdd={add}
            onPreview={setPreview}
          />
        </div>
      )}

      {cfg.showPresets && presets && presets.length > 0 && onApplyPreset && (
        <div>
          <div className="rb-sect__label">Presets</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {presets.map((p) => (
              <button
                key={p.id ?? p.name}
                type="button"
                className="rb-fix"
                aria-pressed={appliedPresetId === p.id}
                onClick={() => onApplyPreset(p)}
                title={asAcademyString(normalizeIds(p.machineIds ?? []))}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const warnings =
    analysis.violations.length === 0 ? (
      <p className="rb-note rb-note--muted">
        Nothing flagged — this sequence follows the Academy's programming rules.
      </p>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {analysis.violations.map((v) => (
          <ViolationCard
            key={`${v.ruleId}-${v.indices.join("-")}`}
            violation={v}
            machineName={machineName}
            onApplyFix={applyFix}
            disabled={disabled}
            defaultExpanded
          />
        ))}
      </div>
    );

  /* ── Render ─────────────────────────────────────────────────────────── */

  const countClass =
    analysis.countAdvice?.tone === "ok"
      ? "rb-head__count--target"
      : analysis.countAdvice?.tone === "heavy"
        ? "rb-head__count--heavy"
        : analysis.countAdvice?.tone === "thin"
          ? "rb-head__count--thin"
          : "";

  return (
    <div className={cn("rb", cfg.dense && "rb--dense", className)}>
      <header className="rb-head">
        <span className="rb-head__title">
          {slot ? `Routine ${slot}` : mode === "template" ? "Template" : "Routine"}
        </span>
        <span
          className={cn("rb-head__count", countClass)}
          title={analysis.countAdvice?.text ?? undefined}
        >
          {ids.length} machine{ids.length === 1 ? "" : "s"}
        </span>
        {ids.length > 0 && (
          <span className="rb-head__shorthand" title={asAcademyString(ids)}>
            {asAcademyString(ids)}
          </span>
        )}
        <div className="rb-head__actions">
          {avoidCount > 0 && !disabled && (
            <button
              type="button"
              className="rb-fix"
              onClick={runAutoSequence}
              title="Reorder to clear the sequencing conflicts, changing as little as possible"
            >
              <Wand2 size={11} aria-hidden />
              Auto-sequence
            </button>
          )}
          {headerActions}
        </div>
      </header>

      <div className="rb-body">
        <div className="rb-main">
          {/* Portrait: the coverage strip stands in for the figure. */}
          {cfg.showCoverage && (
            <div style={{ display: "contents" }}>
              <div className="rb-cov-wrap" style={{ display: "block" }}>
                <CoverageStrip
                  coverage={analysis.byCategory}
                  onExpand={cfg.showFigure ? () => setSheet("figure") : undefined}
                />
              </div>
            </div>
          )}

          {ids.length === 0 ? (
            <div className="rb-empty">
              <ListPlus size={22} aria-hidden />
              <span>{cfg.emptyHint}</span>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="rb-seq">
                  {ids.map((id, index) => (
                    <div key={id}>
                      <SequenceMachineRow
                        id={id}
                        position={index + 1}
                        name={machineName(id)}
                        severity={severityByIndex.get(index) ?? null}
                        history={history?.[id] ?? null}
                        showHistory={cfg.showHistory}
                        note={machineNotes?.[id]}
                        showNoteButton={cfg.showNotes && !!onMachineNotesChange}
                        noteOpen={noteOpenFor === id}
                        onToggleNote={() => setNoteOpenFor(noteOpenFor === id ? null : id)}
                        onRemove={disabled ? undefined : () => remove(id)}
                        missing={!availableIds.includes(id)}
                        dense={cfg.dense}
                        disabled={disabled}
                      />

                      {noteOpenFor === id && onMachineNotesChange && (
                        <textarea
                          className="rb-row__note"
                          style={{ width: "calc(100% - 2.9rem)", minHeight: "3.5rem" }}
                          autoFocus
                          value={machineNotes?.[id] ?? ""}
                          placeholder={`Coaching note for ${machineName(id)}`}
                          onChange={(e) => setNote(id, e.target.value)}
                          onBlur={() => setNoteOpenFor(null)}
                        />
                      )}

                      {(adjacentAfterIndex.get(index) ?? []).map((v) => (
                        <div key={`${v.ruleId}-${v.indices.join("-")}`} style={{ marginTop: "0.3rem" }}>
                          <ViolationCard
                            violation={v}
                            machineName={machineName}
                            onApplyFix={applyFix}
                            disabled={disabled}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {sessionViolations.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.2rem" }}>
              {sessionViolations.map((v) => (
                <ViolationCard
                  key={`${v.ruleId}-${v.indices.join("-")}`}
                  violation={v}
                  machineName={machineName}
                  onApplyFix={applyFix}
                  disabled={disabled}
                />
              ))}
            </div>
          )}

          {analysis.countAdvice && analysis.countAdvice.tone !== "ok" && (
            <p className="rb-note rb-note--muted">{analysis.countAdvice.text}</p>
          )}
        </div>

        {/* Landscape rail. Hidden below 900px by CSS, not unmounted, so the
            figure keeps its front/back choice across an orientation change. */}
        <aside className="rb-rail">
          {cfg.showFigure && (
            <RoutineFigure machineIds={ids} gender={client?.gender} previewMachineId={preview} />
          )}
          {/* On an empty routine the seeding options lead, because the
              useful next action is "start from the model B routine" or a
              purpose template — not hand-picking seven machines out of
              twenty. Once there is something to build on, the picker is what
              the trainer reaches for, so it goes back on top. */}
          <div className="rb-rail__scroll">
            {ids.length === 0 && ideas}
            {!disabled && (
              <div>
                <div className="rb-sect__label">
                  <ListPlus size={12} aria-hidden />
                  Add a machine
                </div>
                {picker}
              </div>
            )}
            {ids.length > 0 && ideas}
          </div>
        </aside>
      </div>

      {/* Portrait action bar. */}
      <div className="rb-bar">
        <button
          type="button"
          className="rb-bar__btn rb-bar__btn--primary"
          onClick={() => setSheet("picker")}
          disabled={disabled}
        >
          <ListPlus size={14} aria-hidden />
          Add
        </button>
        <button type="button" className="rb-bar__btn" onClick={() => setSheet("ideas")}>
          <Lightbulb size={14} aria-hidden />
          {suggestions.length > 0 ? `${suggestions.length} ideas` : "Ideas"}
        </button>
        <button
          type="button"
          className={cn("rb-bar__btn", avoidCount > 0 && "rb-bar__btn--warn")}
          onClick={() => setSheet("warnings")}
        >
          <AlertTriangle size={14} aria-hidden />
          {analysis.violations.length > 0 ? `${analysis.violations.length}` : "Clear"}
        </button>
      </div>

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent side="bottom" className="rb">
          <SheetHeader>
            <SheetTitle>
              {sheet === "picker"
                ? "Add a machine"
                : sheet === "ideas"
                  ? "Suggestions"
                  : sheet === "figure"
                    ? "Muscles worked"
                    : "Programming notes"}
            </SheetTitle>
          </SheetHeader>
          <div className="rb-sheet" style={{ overflowY: "auto", padding: "0 0.25rem 0.75rem" }}>
            {sheet === "picker" && picker}
            {sheet === "ideas" && ideas}
            {sheet === "warnings" && warnings}
            {sheet === "figure" && (
              <RoutineFigure machineIds={ids} gender={client?.gender} scale={1.15} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
