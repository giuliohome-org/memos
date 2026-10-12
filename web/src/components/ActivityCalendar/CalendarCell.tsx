import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CalendarDayEntry } from "@/hooks/useTagCalendarData";
import { cn } from "@/lib/utils";
import { DEFAULT_CELL_SIZE, SMALL_CELL_SIZE } from "./constants";
import type { CalendarDayCell, CalendarSize } from "./types";
import { getCellIntensityClass } from "./utils";

export interface CalendarCellProps {
  day: CalendarDayCell;
  maxCount: number;
  tooltipText: string;
  onClick?: (date: string) => void;
  size?: CalendarSize;
  highlight?: boolean;
  tagColors?: string[];
  /** What happens that day, written in the cell when the calendar is wide enough. */
  entries?: CalendarDayEntry[];
}

// Lines of text that fit in a cell; with more memos the last line says how many are left.
const MAX_ENTRY_LINES = 3;

const entryTitle = (entry: CalendarDayEntry) => [entry.tags.map((tag) => tag.label).join(" "), entry.text].filter(Boolean).join(" · ");

const EntryLine = ({ entry }: { entry: CalendarDayEntry }) => {
  const color = entry.tags.find((tag) => tag.color)?.color;
  const tagLabels = entry.tags.map((tag) => tag.label).join(" ");
  return (
    <span className="flex min-w-0 items-stretch gap-1 text-[10px] leading-3 font-normal">
      <span
        className={cn("w-1 shrink-0 rounded-full", !color && "bg-current opacity-40")}
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="truncate text-left">
        {tagLabels && <span className="font-semibold">{tagLabels}</span>}
        {tagLabels && entry.text && " · "}
        {entry.text}
      </span>
    </span>
  );
};

export const CalendarCell = memo((props: CalendarCellProps) => {
  const { day, maxCount, tooltipText, onClick, size = "default", highlight, tagColors, entries } = props;

  const handleClick = () => {
    if (onClick) {
      onClick(day.date);
    }
  };

  const sizeConfig = size === "small" ? SMALL_CELL_SIZE : DEFAULT_CELL_SIZE;
  const smallExtraClasses = size === "small" ? `${SMALL_CELL_SIZE.dimensions} min-h-0` : "";

  const baseClasses = cn(
    "aspect-square w-full flex items-center justify-center text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 select-none",
    sizeConfig.font,
    sizeConfig.borderRadius,
    smallExtraClasses,
  );
  const isInteractive = Boolean(onClick);
  const dayEntries = size === "default" && entries && entries.length > 0 ? entries : undefined;
  const entriesText = dayEntries?.map(entryTitle).join("; ");
  const ariaLabel = [day.isSelected ? `${tooltipText} (selected)` : tooltipText, entriesText].filter(Boolean).join(": ");

  if (!day.isCurrentMonth) {
    return <div className={cn(baseClasses, "text-muted-foreground/30 bg-transparent cursor-default")}>{day.label}</div>;
  }

  const intensityClass = getCellIntensityClass(day, maxCount);

  const buttonClasses = cn(
    baseClasses,
    intensityClass,
    highlight && "bg-chart-1/50 ring-1 ring-chart-1",
    day.isToday && "ring-2 ring-primary/30 ring-offset-1 font-semibold z-10",
    day.isSelected && "ring-2 ring-primary ring-offset-1 font-bold z-10",
    isInteractive ? "cursor-pointer hover:scale-110 hover:shadow-md hover:z-20" : "cursor-default",
  );

  // Deduplicate colors and limit to 4
  const uniqueColors = tagColors ? [...new Set(tagColors)].slice(0, 4) : undefined;
  const visibleEntries = dayEntries
    ? dayEntries.slice(0, dayEntries.length > MAX_ENTRY_LINES ? MAX_ENTRY_LINES - 1 : MAX_ENTRY_LINES)
    : undefined;

  const button = (
    <button
      type="button"
      onClick={handleClick}
      tabIndex={isInteractive ? 0 : -1}
      aria-label={ariaLabel}
      aria-current={day.isToday ? "date" : undefined}
      aria-disabled={!isInteractive}
      className={cn(
        buttonClasses,
        (uniqueColors || dayEntries) && "flex-col gap-0 leading-none p-0.5",
        dayEntries && "@lg:items-stretch @lg:justify-start @lg:gap-1 @lg:p-1.5 overflow-hidden",
      )}
    >
      <span>{day.label}</span>
      {uniqueColors && (
        <span className={cn("flex gap-0.5 justify-center items-center w-full", dayEntries && "@lg:hidden")}>
          {uniqueColors.map((color, i) => (
            <span
              key={i}
              className="rounded-full flex-1"
              style={{
                backgroundColor: color,
                // Single dot: tall bar; more dots: share the space equally
                height: uniqueColors.length <= 2 ? 6 : 4,
                maxWidth: uniqueColors.length === 1 ? "80%" : undefined,
              }}
            />
          ))}
        </span>
      )}
      {visibleEntries && dayEntries && (
        <span className="hidden @lg:flex w-full min-w-0 flex-col gap-0.5">
          {visibleEntries.map((entry, i) => (
            <EntryLine key={i} entry={entry} />
          ))}
          {dayEntries.length > visibleEntries.length && (
            <span className="text-left text-[10px] leading-3 font-normal opacity-80 pl-2">
              +{dayEntries.length - visibleEntries.length}
            </span>
          )}
        </span>
      )}
    </button>
  );

  const shouldShowTooltip = tooltipText && day.count > 0;

  if (!shouldShowTooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className={cn(dayEntries && "font-medium mb-1")}>{tooltipText}</p>
        {dayEntries && (
          <ul className="flex flex-col gap-0.5">
            {dayEntries.map((entry, i) => {
              const color = entry.tags.find((tag) => tag.color)?.color;
              return (
                <li key={i} className="flex items-start gap-1.5">
                  <span
                    className={cn("mt-1 size-2 shrink-0 rounded-full", !color && "bg-current opacity-40")}
                    style={color ? { backgroundColor: color } : undefined}
                  />
                  <span>{entryTitle(entry)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
});

CalendarCell.displayName = "CalendarCell";
