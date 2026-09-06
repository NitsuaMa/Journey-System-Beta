import React from "react";
import { Moon, Bell, Settings } from "lucide-react";
import { MaxStrengthLogo } from "./MaxStrengthLogo";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  variant: "light" | "dark";
  trainerInitials?: string;
  studioName?: string;
  onStudioClick?: () => void;
  onSettingsClick?: () => void;
  rightControls?: React.ReactNode;
  trainerDropdown?: React.ReactNode;
  /**
   * Optional global search control. It sits in the flexible middle band of
   * the header so it can widen on tablet widths without pushing the icon
   * cluster around. Only the app shell passes this; nested headers (e.g. the
   * workout tracker) leave it out so a live session never shows a search box.
   */
  searchSlot?: React.ReactNode;
}

export function AppHeader({
  variant,
  trainerInitials,
  studioName = "SOLON",
  onStudioClick,
  onSettingsClick,
  rightControls,
  trainerDropdown,
  searchSlot,
}: AppHeaderProps) {
  const isLight = variant === "light";

  return (
    <header
      className={cn(
        "h-14 shrink-0 border-b flex items-center justify-between px-4 z-20",
        isLight ? "bg-white border-div-l" : "bg-bg-dark-2 border-div-d",
      )}
    >
      {/* min-w-0 is what lets this cluster shrink at all. Without it the flex
          item refuses to go below its content width, so a long studio name
          CLIPS instead of truncating — which is how the end of a name went
          missing with no ellipsis to say it had. */}
      <div className="flex items-center gap-3 min-w-0">
        <MaxStrengthLogo
          size="md"
          showText={false}
          className={cn("shrink-0", isLight ? "text-ink-l1" : "text-white")}
        />
        <button
          onClick={onStudioClick}
          // This control SWITCHES STUDIOS. A half-rendered name is genuinely
          // ambiguous across a franchise with similar location names, so the
          // full one has to stay recoverable.
          title={studioName}
          aria-label={
            onStudioClick
              ? `Studio: ${studioName}. Change studio.`
              : `Studio: ${studioName}`
          }
          className={cn(
            // ch, not px: the cap scales with the font so it holds across the
            // whole text-xs -> sm:text-lg -> md:text-xl ramp instead of
            // clipping at only some sizes. max-w-37.5 (150px) was tuned for
            // one size and cut mid-word at the others.
            //
            // pe-[0.22em] + leading-tight (Sep 5): `truncate` is
            // overflow:hidden, and Saira Condensed ITALIC leans past its own
            // advance width — so the last glyph's right edge ("SOLON" lost
            // the leg of its N) and the tops of tall caps were shaved off
            // even when the name fit. The trailing padding gives the slant
            // room to land; the taller line box stops the vertical clip.
            // Ellipsis behaviour for long names is unchanged.
            "font-display italic text-xs sm:text-lg md:text-xl leading-tight uppercase justify-center transition-opacity text-left truncate pe-[0.22em] max-w-[14ch] sm:max-w-[20ch] lg:max-w-[28ch]",
            isLight ? "text-ink-l3" : "text-white",
            onStudioClick
              ? "hover:opacity-75 cursor-pointer"
              : "cursor-default",
          )}
        >
          {studioName}
        </button>
      </div>

      {/* Flexible middle band: the search grows into whatever width is free. */}
      {searchSlot && (
        <div className="flex-1 min-w-0 flex items-center justify-end px-2 sm:px-4">
          {searchSlot}
        </div>
      )}

      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {rightControls || (
          <>
            {!isLight && (
              <button className="text-ink-d2 hover:text-white transition-colors min-w-8 min-h-8 sm:min-w-11 sm:min-h-11 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark">
                <Moon className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
              </button>
            )}
            <button
              onClick={onSettingsClick}
              className={cn(
                "transition-colors min-w-8 min-h-8 sm:min-w-11 sm:min-h-11 flex items-center justify-center",
                isLight
                  ? "text-ink-l3 hover:text-ink-l1"
                  : "text-ink-d2 hover:text-white",
              )}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              className={cn(
                "transition-colors min-w-8 min-h-8 sm:min-w-11 sm:min-h-11 flex items-center justify-center",
                isLight
                  ? "text-cyan hover:text-cyan/80"
                  : "text-ink-d2 hover:text-white",
              )}
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </>
        )}

        <div
          className={cn(
            "w-px h-6",
            isLight ? "bg-div-l" : "bg-div-d",
          )}
        />

        {trainerDropdown || (
          <button
            className={cn(
              "w-8 h-8 sm:w-11 sm:h-11 rounded-full font-display italic text-xs sm:text-sm flex items-center justify-center cursor-pointer shadow-sm mx-auto shrink-0",
              isLight
                ? "bg-primary text-primary-foreground"
                : "bg-primary text-primary-foreground border border-div-d",
            )}
          >
            {trainerInitials}
          </button>
        )}
      </div>
    </header>
  );
}
