import React, { useState, useRef, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronDown, X } from 'lucide-react';
import { BodyStateTag, BodyRegionState } from '../types';
import { BODY_REGIONS } from '../data/body-regions';
import { cn } from '../lib/utils';

interface BodyStateTrackerProps {
  value: BodyStateTag[];
  onChange: (next: BodyStateTag[]) => void;
  disabled?: boolean;
  className?: string;
}

type View = 'region' | 'state';

export function BodyStateTracker({
  value,
  onChange,
  disabled,
  className,
}: BodyStateTrackerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('region');
  const [pendingRegion, setPendingRegion] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside / Escape dismiss
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closePopover();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closePopover = () => {
    setOpen(false);
    setView('region');
    setPendingRegion(null);
  };

  const handleSelectRegion = (region: string) => {
    setPendingRegion(region);
    setView('state');
  };

  const handleSelectState = (state: BodyRegionState) => {
    if (!pendingRegion) return;
    // Dedupe: if region already tagged, replace its state.
    const next = value.filter((t) => t.region !== pendingRegion);
    next.push({ region: pendingRegion, state });
    onChange(next);
    closePopover();
  };

  const handleRemoveTag = (region: string) => {
    onChange(value.filter((t) => t.region !== region));
  };

  const taggedRegions = new Set(value.map((t) => t.region));

  return (
    <div className={cn('relative w-full', className)} ref={containerRef}>
      {/* Chips row */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((tag) => (
            <button
              key={tag.region}
              type="button"
              onClick={() => handleRemoveTag(tag.region)}
              className={cn(
                'inline-flex items-center gap-2 h-11 min-w-[140px] px-3 rounded-xl border text-[13px] font-medium uppercase tracking-wide transition-all active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan',
                tag.state === 'stiff'
                  ? 'bg-red/15 text-red border-red/40 hover:bg-red/25'
                  : 'bg-green/15 text-green border-green/40 hover:bg-green/25'
              )}
              aria-label={`Remove ${tag.region} (${tag.state})`}
            >
              <span className="pointer-events-none truncate">{tag.region}</span>
              <span className="pointer-events-none text-[11px] opacity-70">·</span>
              <span className="pointer-events-none">
                {tag.state === 'stiff' ? 'Stiff' : 'Prime'}
              </span>
              <span className="pointer-events-none ml-auto opacity-70">
                <X className="w-4 h-4" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center justify-between w-full h-11 px-4 rounded-xl bg-surface-2 border border-div-d text-ink-d2 text-[13px] font-medium uppercase tracking-wide transition-all',
          'hover:bg-bg-dark-3 hover:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          open && 'ring-2 ring-cyan'
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Tag Body Region
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Modal Overlay */}
      {open && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={closePopover}
        >
          <div
            role="dialog"
            aria-label="Body region picker"
            className="w-full max-w-sm max-h-[85dvh] bg-surface-1 border border-div-d rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {view === 'region' ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="px-4 py-3 border-b border-div-d flex-shrink-0 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-widest text-ink-d2 font-bold">
                    Select Region
                  </span>
                  <button type="button" onClick={closePopover} className="text-ink-d2 hover:text-white transition-colors" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="overflow-y-auto py-1">
                  {BODY_REGIONS.map((region) => {
                    const isTagged = taggedRegions.has(region);
                    return (
                      <button
                        key={region}
                        type="button"
                        onClick={() => handleSelectRegion(region)}
                        className={cn(
                          'flex items-center justify-between w-full h-12 px-4 text-left text-[14px] font-medium transition-colors',
                          'hover:bg-bg-dark-3 focus-visible:outline-none focus-visible:bg-bg-dark-3',
                          isTagged ? 'text-ink-d3' : 'text-ink-d1'
                        )}
                      >
                        <span>{region}</span>
                        {isTagged && (
                          <span className="text-[10px] uppercase tracking-widest text-cyan font-bold">
                            Update
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-2 border-b border-div-d flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setView('region');
                      setPendingRegion(null);
                    }}
                    className="flex items-center justify-center w-11 h-11 rounded-lg text-ink-d2 hover:bg-bg-dark-3 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    aria-label="Back to region list"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-[13px] font-medium uppercase tracking-wide text-ink-d1">
                    {pendingRegion}
                  </span>
                  <div className="ml-auto flex items-center pr-2">
                     <button type="button" onClick={closePopover} className="text-ink-d2 hover:text-white transition-colors p-1" aria-label="Close">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-3 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => handleSelectState('stiff')}
                    className="w-full h-14 rounded-xl bg-red/15 border border-red/40 text-red text-[14px] font-bold uppercase tracking-widest hover:bg-red/25 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    Stiff / Fatigued
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectState('prime')}
                    className="w-full h-14 rounded-xl bg-green/15 border border-green/40 text-green text-[14px] font-bold uppercase tracking-widest hover:bg-green/25 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    Prime / Fresh
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
