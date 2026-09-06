import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronDown, ChevronUp, ChevronsRight, MoreHorizontal, NotebookPen, Plus, X } from "lucide-react";
import type { JourneyRow, JourneySession, JourneySet, LiveColumn, LiveSet, StatMetric } from "./types";
import {
  computeRowStats,
  formatLongDate,
  formatShortDate,
  journeySummary,
  nextMetric,
  STAT_LABEL,
  STAT_ORDER,
  type RowStats,
} from "./stats";
import { JourneyCell } from "./JourneyCell";
import { StatCell } from "./StatCell";
import { TodayCell } from "./TodayCell";

/* ------------------------------------------------------------------ *
 * Public props
 * ------------------------------------------------------------------ */

export interface GridSection {
  id: string;
  label: string;
  rows: JourneyRow[];
  /** Collapsed sections render only their divider row (tap to expand). */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Rows in this section get a 1..n order badge (today's routine). */
  numbered?: boolean;
  /** Rows in this section have NO live input even when a live column exists. */
  inactive?: boolean;
}

export interface JourneyGridProps {
  /** Columns to render, oldest → newest. The grid never re-sorts. */
  sessions: JourneySession[];
  /**
   * Every loaded session (a superset of `sessions`), oldest → newest. The
   * Analytics column and the start→now summary search THIS set, so "Lowest"
   * is the true floor even when only the last ten columns are open.
   * Defaults to `sessions`.
   */
  historySessions?: JourneySession[];
  sections: GridSection[];
  /** Show the sticky Analytics column (default true). */
  showStats?: boolean;
  /** Controlled metric for the Analytics column. Uncontrolled if omitted. */
  metric?: StatMetric;
  onMetricChange?: (metric: StatMetric) => void;
  /**
   * The most recent logged session — framed as the baseline for today's
   * prescription. Defaults to the last entry of `historySessions`.
   */
  latestSessionId?: string | null;
  /** Controlled spotlight (tap a date header). Uncontrolled if omitted. */
  spotlightSessionId?: string | null;
  onSpotlight?: (sessionId: string | null) => void;
  /** Controlled row trace (tap a machine name). Uncontrolled if omitted. */
  selectedMachineId?: string | null;
  onSelectMachine?: (machineId: string | null) => void;
  /** When set, every machine cell gets a note button at its right edge. */
  onMachineNote?: (machineId: string) => void;
  /** Present only inside an Active Session — adds the sticky-right Today column. */
  live?: LiveColumn;
  /** "Older" affordance at the far left of the timeline. */
  onLoadOlder?: () => void;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  /**
   * "auto": the scroller caps at `maxHeight` (default 72dvh).
   * "fill": the grid stretches to fill its flex-column parent — for a parent
   * whose height is already bounded.
   * "viewport": the grid measures its own offset from the top of the page and
   * sizes itself to the viewport that is left (minus `viewportReserve` for a
   * bottom bar / legend). Use this under a static page header on a page that
   * is NOT itself height-bounded — the grid, not the page, scrolls.
   * "page": the inverse of "viewport". The grid is exactly as tall as its
   * machine list, so the PAGE scrolls and the grid has no vertical scrollbar
   * of its own. Sessions still scroll sideways inside the grid — the page
   * must never scroll horizontally. Rows keep a readable fixed height
   * instead of being squeezed to fit a box.
   */
  layout?: "auto" | "fill" | "viewport" | "page";
  /** CSS length for the scroll container when layout="auto". */
  maxHeight?: string;
  /** Pixels kept free under the grid in "viewport" layout (bottom bar, legend). */
  viewportReserve?: number;
  /** Column caption in the sticky corner. */
  title?: string;
  /**
   * "fixed" (default, Active Session): the tuned density — 44px rows, 84px
   * columns — and the grid scrolls when it overflows.
   * "auto" (Recent Journey): the grid measures the height and width it has
   * been given and shrinks rows (44 → 28px) and session columns (84 → 56px)
   * until every loaded machine fits vertically and at least ten sessions fit
   * across. Below 36px rows the cell goes single-line ("116 · 12↓") and the
   * settings rail folds into the ⋯ menu.
   */
  fit?: "fixed" | "auto";
  /**
   * "inline": the settings rail under the machine name (Active Session — the
   * trainer reads it walking up to the machine). "menu": the name alone, with
   * a ⋯ button that opens the settings in a popover; buys the row height the
   * dense Recent Journey needs.
   */
  settingsDisplay?: "inline" | "menu";
  /** Session columns to aim for when fitting (default 14; never fewer than 10 are fitted). */
  targetColumns?: number;
}

/* ------------------------------------------------------------------ *
 * Row
 * ------------------------------------------------------------------ */

interface RowProps {
  row: JourneyRow;
  sessions: JourneySession[];
  history: JourneySession[];
  stats: RowStats | undefined;
  metric: StatMetric;
  showStats: boolean;
  latestSessionId: string | null;
  spotlightSessionId: string | null;
  isSelected: boolean;
  onSelect: (machineId: string) => void;
  onJump: (sessionId: string) => void;
  onNote?: (machineId: string) => void;
  hasOlderColumn: boolean;
  orderNumber?: number;
  live?: LiveColumn;
  liveValue?: LiveSet;
  liveInactive: boolean;
  settingsDisplay: "inline" | "menu";
  /** Every other row inside a section, for the zebra band. */
  band?: boolean;
}

function RowImpl({
  row,
  sessions,
  history,
  stats,
  metric,
  showStats,
  latestSessionId,
  spotlightSessionId,
  isSelected,
  onSelect,
  onJump,
  onNote,
  hasOlderColumn,
  orderNumber,
  live,
  liveValue,
  liveInactive,
  settingsDisplay,
  band,
}: RowProps) {
  const { machine } = row;
  const hasLive = !!live && !liveInactive;
  const isFocus = hasLive && live?.focusMachineId === machine.id;
  const hit = stats ? stats[metric] : null;
  const hitSessionId = hit?.session.id ?? null;
  const hitVisible = hitSessionId ? sessions.some((s) => s.id === hitSessionId) : false;

  // Walk once, carrying the previous set forward for the trend glyph.
  let previous: JourneySet | undefined;
  const cells = sessions.map((s) => {
    const set = row.sets[s.id];
    const cell = (
      <JourneyCell
        key={s.id}
        session={s}
        machineName={machine.name}
        set={set}
        previous={previous}
        isLatest={latestSessionId === s.id}
        isSpot={spotlightSessionId === s.id}
        isStatHit={showStats && hitSessionId === s.id}
      />
    );
    if (set) previous = set;
    return cell;
  });

  // Already canonically ordered by orderMachineSettings upstream — position
  // is the thing a trainer reads, so the grid must never re-sort.
  const settingEntries = machine.settings ? Object.entries(machine.settings) : [];
  const settingLabel = (k: string) => machine.settingLabels?.[k] ?? k;
  const shownSettings = settingEntries.slice(0, 5);
  const hiddenSettings = settingEntries.length - shownSettings.length;
  const spokenSettings = settingEntries.length
    ? ` Settings: ${settingEntries.map(([k, v]) => `${settingLabel(k)} ${v}`).join(", ")}.`
    : "";

  return (
    <div
      className={`jg-row ${isSelected ? "is-selected" : ""} ${hasLive ? "has-live" : ""} ${isFocus ? "is-focus" : ""} ${
        machine.sides ? "has-sides" : ""
      }`}
      /* Banding is counted per section, not per DOM child, so a group
         divider never eats a stripe and the rhythm restarts cleanly under
         each heading. Purely presentational -- hence data, not a class. */
      data-band={band ? "1" : "0"}
      role="row"
    >
      <div className="jg-machine" role="rowheader">
        <button
          type="button"
          className="jg-machine__btn"
          aria-pressed={isSelected}
          aria-label={`${machine.name}.${spokenSettings} ${journeySummary(row, history)}. Tap to trace this row.`}
          onClick={() => onSelect(machine.id)}
        >
          <span className="jg-machine__name">
            {orderNumber !== undefined && <span className="jg-machine__order">{orderNumber}</span>}
            <span className="jg-machine__label">{machine.name}</span>
            {machine.alert && (
              <AlertCircle className="jg-machine__alert" size={13} strokeWidth={2.5} aria-label="important machine note" />
            )}
          </span>
          {settingEntries.length > 0 && settingsDisplay === "inline" && (
            <span className="jg-machine__meta">
              {shownSettings.map(([k, v]) => (
                <span key={k} className="jg-setting" title={`${settingLabel(k)} ${v}`}>
                  <span className="jg-setting__k">{k}</span>
                  <span className="jg-setting__v">{v}</span>
                </span>
              ))}
              {hiddenSettings > 0 && (
                <span className="jg-setting jg-setting--more">+{hiddenSettings}</span>
              )}
            </span>
          )}
        </button>
        {live?.reorder && !liveInactive ? (
          /* In reorder mode these take the note button's place rather than
             sitting beside it: the sticky machine column is the narrowest
             thing on the screen, and a trainer reordering is not reading
             notes in the same breath. */
          <span className="jg-machine__reorder">
            <button
              type="button"
              className="jg-machine__move"
              aria-label={`Move ${machine.name} earlier`}
              disabled={orderNumber === 1}
              onClick={() => live.onMoveMachine?.(machine.id, -1)}
            >
              <ChevronUp size={13} strokeWidth={2.75} />
            </button>
            <button
              type="button"
              className="jg-machine__move"
              aria-label={`Move ${machine.name} later`}
              disabled={orderNumber === live.routineMachineIds.length}
              onClick={() => live.onMoveMachine?.(machine.id, 1)}
            >
              <ChevronDown size={13} strokeWidth={2.75} />
            </button>
            <button
              type="button"
              className="jg-machine__drop"
              aria-label={`Remove ${machine.name} from today`}
              onClick={() => live.onRemoveMachine?.(machine.id)}
            >
              <X size={13} strokeWidth={2.75} />
            </button>
          </span>
        ) : null}

        {onNote && !(live?.reorder && !liveInactive) && (
          <button
            type="button"
            className={`jg-machine__note ${machine.alert ? "is-alert" : machine.noteCount ? "has-notes" : ""}`}
            aria-label={`${machine.name} notes${machine.noteCount ? ` (${machine.noteCount})` : ""}`}
            onClick={() => onNote(machine.id)}
          >
            <NotebookPen size={13} strokeWidth={2.25} />
          </button>
        )}
        {settingsDisplay === "menu" && (settingEntries.length > 0 || machine.noteCount) && (
          <MachineMenu
            machineName={machine.name}
            settings={settingEntries.map(([k, v]) => ({ key: k, label: settingLabel(k), value: v }))}
            noteCount={machine.noteCount}
            summary={journeySummary(row, history)}
            onNote={onNote ? () => onNote(machine.id) : undefined}
          />
        )}
      </div>

      {showStats && (
        <StatCell
          machineName={machine.name}
          metric={metric}
          hit={hit}
          isVisible={hitVisible}
          onJump={hitVisible ? onJump : undefined}
        />
      )}

      {hasOlderColumn && (
        <div className="jg-cell jg-cell--older" role="gridcell" aria-hidden="true">
          <span className="jg-cell--older__mark">‹</span>
        </div>
      )}

      {cells}

      {live &&
        (hasLive ? (
          <TodayCell
            machineId={machine.id}
            machineName={machine.name}
            sides={!!machine.sides}
            value={liveValue}
            prescribedWeight={row.prescribedWeight}
            isFocus={isFocus}
            onFocus={live.onFocusMachine}
          />
        ) : (
          <div className="jg-today jg-today--idle" role="gridcell" aria-label={`${machine.name}: not in today's routine`}>
            {live.onAddMachine ? (
              <button
                type="button"
                className="jg-today__add"
                aria-label={`Add ${machine.name} to today's session`}
                onClick={() => live.onAddMachine?.(machine.id)}
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden="true">—</span>
            )}
          </div>
        ))}
    </div>
  );
}

/**
 * The ⋯ at the right edge of a machine cell in the dense grid. Opens a small
 * popover with the machine's settings (the same G/S pairs the inline rail
 * shows in the Active Session) and the note count.
 * Rendered through a portal: the sticky machine column lives inside an
 * overflow scroller, so anything positioned inside the cell would be clipped.
 */
function MachineMenu({
  machineName,
  settings,
  noteCount,
  summary,
  onNote,
}: {
  machineName: string;
  settings: { key: string; label: string; value: string }[];
  noteCount?: number;
  summary: string;
  onNote?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 232)) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (btnRef.current && t && btnRef.current.contains(t)) return;
      if (t && (t as Element).closest?.(".jg-menu")) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", () => setOpen(false), { once: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const title = settings.length ? settings.map((s) => `${s.label} ${s.value}`).join(" · ") : "No settings on file";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`jg-machine__more ${open ? "is-open" : ""} ${noteCount ? "has-notes" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${machineName}: settings and notes. ${title}`}
        title={title}
        onClick={toggle}
      >
        <MoreHorizontal size={14} strokeWidth={2.5} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="jg-menu" role="dialog" aria-label={`${machineName} settings`} style={{ top: pos.top, left: pos.left }}>
            <div className="jg-menu__title">
              {machineName}
              <span className="jg-menu__summary">{summary}</span>
            </div>
            {settings.length ? (
              <dl className="jg-menu__settings">
                {settings.map((s) => (
                  <div key={s.key} className="jg-menu__setting">
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="jg-menu__empty">No machine settings saved for this client.</p>
            )}
            {onNote && (
              <button type="button" className="jg-menu__note" onClick={() => { setOpen(false); onNote(); }}>
                <NotebookPen size={13} strokeWidth={2.25} /> {noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : "Add a note"}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

const Row = memo(RowImpl);

/* ------------------------------------------------------------------ *
 * Grid
 * ------------------------------------------------------------------ */

export function JourneyGrid({
  sessions,
  historySessions,
  sections,
  showStats = true,
  metric: metricProp,
  onMetricChange,
  latestSessionId: latestProp,
  spotlightSessionId,
  onSpotlight,
  selectedMachineId,
  onSelectMachine,
  onMachineNote,
  live,
  onLoadOlder,
  canLoadOlder = false,
  loadingOlder = false,
  layout = "auto",
  maxHeight,
  viewportReserve = 112,
  title = "Equipment",
  fit = "fixed",
  settingsDisplay = "inline",
  targetColumns = 14,
}: JourneyGridProps) {
  const history = historySessions ?? sessions;
  const latestSessionId = latestProp !== undefined ? latestProp : (history[history.length - 1]?.id ?? null);

  /* --- controlled / uncontrolled metric, spotlight, selection -------- */
  const [innerMetric, setInnerMetric] = useState<StatMetric>("high");
  const metric = metricProp ?? innerMetric;
  const cycleMetric = useCallback(() => {
    const next = nextMetric(metric);
    setInnerMetric(next);
    onMetricChange?.(next);
  }, [metric, onMetricChange]);

  const [innerSpot, setInnerSpot] = useState<string | null>(null);
  const spot = spotlightSessionId !== undefined ? spotlightSessionId : innerSpot;
  const setSpot = useCallback(
    (next: string | null) => {
      setInnerSpot(next);
      onSpotlight?.(next);
    },
    [onSpotlight],
  );
  const toggleSpot = useCallback((id: string) => setSpot(spot === id ? null : id), [spot, setSpot]);

  const [innerSel, setInnerSel] = useState<string | null>(null);
  const selected = selectedMachineId !== undefined ? selectedMachineId : innerSel;
  const toggleSelect = useCallback(
    (id: string) => {
      const next = selected === id ? null : id;
      setInnerSel(next);
      onSelectMachine?.(next);
    },
    [selected, onSelectMachine],
  );

  /* --- analytics: all five metrics per row, one pass, memoised ------- */
  const stats = useMemo(() => {
    const map = new Map<string, RowStats>();
    if (!showStats) return map;
    for (const section of sections) {
      for (const row of section.rows) map.set(row.machine.id, computeRowStats(row, history));
    }
    return map;
  }, [sections, history, showStats]);

  /* --- scroll management --------------------------------------------- */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevFirstId = useRef<string | null>(null);
  const prevScrollWidth = useRef(0);
  const userTouched = useRef(false);

  const scrollToEnd = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const firstId = sessions[0]?.id ?? null;

    if (prevFirstId.current && firstId !== prevFirstId.current && sessions.some((s) => s.id === prevFirstId.current)) {
      // Older columns were prepended: keep the same cells under the thumb.
      el.scrollLeft += el.scrollWidth - prevScrollWidth.current;
    } else if (!userTouched.current) {
      // Chronological flow: newest is on the right, so open the grid there.
      scrollToEnd();
    }
    prevFirstId.current = firstId;
    prevScrollWidth.current = el.scrollWidth;
  }, [sessions, scrollToEnd]);

  // The host page can resize after mount (fonts, orientation, a panel
  // animating open). Until the trainer touches the grid, keep it parked on
  // the latest session through those resizes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const touch = () => {
      userTouched.current = true;
    };
    el.addEventListener("pointerdown", touch, { passive: true });
    el.addEventListener("wheel", touch, { passive: true });
    el.addEventListener("keydown", touch);
    const ro = new ResizeObserver(() => {
      if (!userTouched.current) scrollToEnd();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener("pointerdown", touch);
      el.removeEventListener("wheel", touch);
      el.removeEventListener("keydown", touch);
    };
  }, [scrollToEnd]);

  /** Tap on an Analytics cell: bring that session's column into view and spotlight it. */
  const jumpTo = useCallback(
    (sessionId: string) => {
      const el = scrollerRef.current;
      if (!el) return;
      const head = el.querySelector<HTMLElement>(`.jg-head[data-session-id="${sessionId}"]`);
      if (!head) return;
      const corner = el.querySelector<HTMLElement>(".jg-corner");
      const statHead = el.querySelector<HTMLElement>(".jg-stat-head");
      const rail = (corner?.offsetWidth ?? 0) + (statHead?.offsetWidth ?? 0);
      userTouched.current = true;
      const left = Math.max(0, head.offsetLeft - rail - 8);
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
      setSpot(sessionId);
    },
    [setSpot],
  );

  /* --- "viewport" layout: size to what is left under the page header --- */
  const [viewportMaxH, setViewportMaxH] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (layout !== "viewport") return;
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      setViewportMaxH(`max(240px, calc(100dvh - ${top}px - ${viewportReserve}px))`);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [layout, viewportReserve]);

  const hasOlderColumn = !!onLoadOlder;
  // The Older rail is its own fixed 26px track (see --jg-track-older), so it
  // is no longer counted among the session columns.
  const cols = sessions.length;

  /* --- "auto" fit: size rows and columns to the space we actually have --- */
  const rowCount = sections.reduce((n, s) => n + (s.collapsed ? 0 : s.rows.length), 0);
  const dividerCount = sections.length;
  const [fitVars, setFitVars] = useState<{ rowH: number; colW: number; dense: boolean } | null>(null);
  useLayoutEffect(() => {
    if (fit !== "auto") {
      setFitVars(null);
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    const MACHINE_W = settingsDisplay === "menu" ? 150 : 184;
    const STAT_W = settingsDisplay === "menu" ? 92 : 100;
    const OLDER_W = 26;
    const HEAD_H = 40;
    const measure = () => {
      // "page" has no height budget to solve for: the list sets the page's
      // length, so rows keep their readable height and only the COLUMN
      // width is fitted to the width we were handed.
      if (layout === "page") {
        const availWPage =
          el.clientWidth - MACHINE_W - (showStats ? STAT_W : 0) - (hasOlderColumn ? OLDER_W : 0);
        const wantPage = Math.max(10, Math.min(targetColumns, Math.max(1, cols)));
        const colWPage = Math.max(56, Math.min(84, Math.floor(availWPage / wantPage)));
        setFitVars((prev) =>
          prev && prev.rowH === 38 && prev.colW === colWPage && prev.dense === false
            ? prev
            : { rowH: 38, colW: colWPage, dense: false },
        );
        return;
      }
      // Height we may fill: the viewport that is left under the header, or
      // the flex box the parent handed us.
      let availH: number;
      if (layout === "viewport") {
        const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
        availH = Math.max(240, window.innerHeight - top - viewportReserve);
      } else {
        availH = el.clientHeight || 400;
      }
      // Sections cost a divider each (30px, 24px when dense). Solve for the
      // row height that fits every row, then clamp to the readable range.
      const dividerH = 30;
      const rowsH = availH - HEAD_H - dividerCount * dividerH - 2;
      // 26px is the floor: 12.5px numerals with 3px of air each side. Below
      // that the trainer is squinting, and scrolling two rows beats that.
      const dense = rowCount > 0 && Math.floor(rowsH / rowCount) < 36;
      const dividerAdj = dense ? dividerCount * (dividerH - 24) + (HEAD_H - 36) : 0; // dense chrome is shorter
      const rowH = rowCount > 0 ? Math.max(26, Math.min(44, Math.floor((rowsH + dividerAdj) / rowCount))) : 44;
      // Width: fit `targetColumns` sessions (never fewer than ten) into what
      // is left beside the sticky rails, between 56 and 84px each.
      const availW = el.clientWidth - MACHINE_W - (showStats ? STAT_W : 0) - (hasOlderColumn ? OLDER_W : 0);
      const want = Math.max(10, Math.min(targetColumns, Math.max(1, cols)));
      const colW = Math.max(56, Math.min(84, Math.floor(availW / want)));
      setFitVars((prev) => (prev && prev.rowH === rowH && prev.colW === colW && prev.dense === dense ? prev : { rowH, colW, dense }));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [fit, layout, viewportReserve, rowCount, dividerCount, showStats, hasOlderColumn, cols, targetColumns, settingsDisplay]);

  const effectiveMaxH = layout === "page" ? undefined : layout === "viewport" ? viewportMaxH : maxHeight;
  const style = {
    "--jg-cols": cols,
    ...(effectiveMaxH ? { "--jg-max-h": effectiveMaxH } : null),
    ...(settingsDisplay === "menu" ? { "--jg-col-machine": "150px", "--jg-col-stat": "92px" } : null),
    ...(fitVars
      ? {
          "--jg-row-h": `${fitVars.rowH}px`,
          "--jg-col-session": `${fitVars.colW}px`,
          "--jg-head-h": `${fitVars.dense ? 36 : 40}px`,
          // In viewport/fill fits the scroller should BE the available height,
          // not merely be capped by it, so the grid reaches the bottom.
          ...(layout === "viewport" && effectiveMaxH ? { "--jg-min-h": effectiveMaxH } : null),
        }
      : null),
  } as CSSProperties;

  const metricLabel = STAT_LABEL[metric];
  const metricIndex = STAT_ORDER.indexOf(metric);

  return (
    <div
      className={`jg ${layout === "fill" ? "jg--fill" : ""} ${layout === "page" ? "jg--page" : ""}`}
      data-live={live ? "true" : "false"}
      data-stats={showStats ? "true" : "false"}
      data-older={hasOlderColumn ? "true" : "false"}
      data-dense={fitVars?.dense ? "line" : "stack"}
      data-settings={settingsDisplay}
      style={style}
    >
      <div
        ref={scrollerRef}
        className="jg-scroller"
        role="grid"
        aria-label="Client journey"
        aria-rowcount={sections.reduce((n, s) => n + 1 + (s.collapsed ? 0 : s.rows.length), 1)}
        aria-colcount={cols + 1 + (showStats ? 1 : 0) + (hasOlderColumn ? 1 : 0) + (live ? 1 : 0)}
      >
        <div className="jg-grid" data-reorder={live?.reorder ? "1" : "0"}>
          {/* ---------- header row ---------- */}
          <div className="jg-row" role="row">
            {/* Just the word. The "start → now" line under it described the
                Analytics column, which the Active Session turns off -- so on
                the screen a trainer actually stares at for an hour it was a
                caption for something that was not on screen. */}
            <div className="jg-corner" role="columnheader">
              <span className="jg-corner__title">{title}</span>
            </div>

            {showStats && (
              <div className="jg-stat-head" role="columnheader">
                <button
                  type="button"
                  className="jg-stat-head__btn"
                  onClick={cycleMetric}
                  aria-label={`Analytics: ${metricLabel.long}. Tap to show the next metric.`}
                >
                  <span className="jg-stat-head__title" aria-live="polite">
                    {metricLabel.title}
                  </span>
                  <span className="jg-stat-head__sub">{metricLabel.sub}</span>
                  <span className="jg-stat-head__dots" aria-hidden="true">
                    {STAT_ORDER.map((m, i) => (
                      <i key={m} className={i === metricIndex ? "is-on" : ""} />
                    ))}
                    <ChevronsRight size={11} strokeWidth={2.5} />
                  </span>
                </button>
              </div>
            )}

            {hasOlderColumn && (
              <div className="jg-head jg-head--older" role="columnheader">
                <button
                  type="button"
                  className="jg-head__btn"
                  onClick={onLoadOlder}
                  disabled={!canLoadOlder || loadingOlder}
                  aria-label="Load older sessions"
                  style={{ opacity: canLoadOlder ? 1 : 0.4 }}
                >
                  <span>{loadingOlder ? "…" : canLoadOlder ? "‹ Older" : "Start"}</span>
                </button>
              </div>
            )}

            {sessions.map((s) => {
              const isSpot = spot === s.id;
              const isLatest = latestSessionId === s.id;
              return (
                <div
                  key={s.id}
                  className={`jg-head ${isSpot ? "is-spot" : ""} ${isLatest ? "is-latest" : ""}`}
                  role="columnheader"
                  data-session-id={s.id}
                >
                  <button
                    type="button"
                    className="jg-head__btn"
                    aria-pressed={isSpot}
                    aria-label={`Session ${s.sessionNumber}, ${formatLongDate(s.date)}, trainer ${s.trainerName ?? s.trainerInitials}${
                      isLatest ? ", most recent session" : ""
                    }. Tap to spotlight this column.`}
                    onClick={() => toggleSpot(s.id)}
                  >
                    {isLatest && <span className="jg-head__tag">Latest</span>}
                    <span className="jg-head__d">{formatShortDate(s.date)}</span>
                    <span className="jg-head__n">
                      #{s.sessionNumber} · {s.trainerInitials}
                    </span>
                  </button>
                </div>
              );
            })}

            {live && (
              <div className="jg-head jg-head--live" role="columnheader">
                <div
                  className="jg-head__btn"
                  aria-label={`Today, session ${live.session.sessionNumber}, ${formatLongDate(live.session.date)}`}
                >
                  <span className="jg-head__tag">Today</span>
                  <span className="jg-head__d">{formatShortDate(live.session.date)}</span>
                  <span className="jg-head__n">
                    #{live.session.sessionNumber} · {live.session.trainerInitials}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ---------- sections ---------- */}
          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              sessions={sessions}
              history={history}
              stats={stats}
              metric={metric}
              showStats={showStats}
              latestSessionId={latestSessionId}
              spot={spot}
              selected={selected}
              onSelect={toggleSelect}
              onJump={jumpTo}
              onNote={onMachineNote}
              hasOlderColumn={hasOlderColumn}
              live={live}
              settingsDisplay={settingsDisplay}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface SectionBlockProps {
  section: GridSection;
  sessions: JourneySession[];
  history: JourneySession[];
  stats: Map<string, RowStats>;
  metric: StatMetric;
  showStats: boolean;
  latestSessionId: string | null;
  spot: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onJump: (sessionId: string) => void;
  onNote?: (machineId: string) => void;
  hasOlderColumn: boolean;
  live?: LiveColumn;
  settingsDisplay: "inline" | "menu";
}

const SectionBlock = memo(function SectionBlock({
  section,
  sessions,
  history,
  stats,
  metric,
  showStats,
  latestSessionId,
  spot,
  selected,
  onSelect,
  onJump,
  onNote,
  hasOlderColumn,
  live,
  settingsDisplay,
}: SectionBlockProps) {
  const toggle = section.onToggle;
  return (
    <>
      <div
        className={`jg-group ${toggle ? "jg-group--action" : ""}`}
        role="row"
        aria-label={section.label}
        onClick={toggle}
      >
        <span className="jg-group__label">
          {toggle && <span aria-hidden="true">{section.collapsed ? "▸ " : "▾ "}</span>}
          {section.label}
          <span className="jg-group__count">{section.rows.length}</span>
        </span>
      </div>
      {!section.collapsed &&
        section.rows.map((row, i) => (
          <Row
            key={row.machine.id}
            row={row}
            sessions={sessions}
            history={history}
            stats={stats.get(row.machine.id)}
            metric={metric}
            showStats={showStats}
            latestSessionId={latestSessionId}
            spotlightSessionId={spot}
            isSelected={selected === row.machine.id}
            onSelect={onSelect}
            onJump={onJump}
            onNote={onNote}
            hasOlderColumn={hasOlderColumn}
            orderNumber={section.numbered ? i + 1 : undefined}
            live={live}
            liveValue={live?.values[row.machine.id]}
            liveInactive={!!section.inactive}
            settingsDisplay={settingsDisplay}
            band={i % 2 === 1}
          />
        ))}
    </>
  );
});
