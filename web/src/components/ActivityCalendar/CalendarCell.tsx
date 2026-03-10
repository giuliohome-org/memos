import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
}

export const CalendarCell = memo((props: CalendarCellProps) => {
  const { day, maxCount, tooltipText, onClick, size = "default", highlight, tagColors } = props;

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
  const ariaLabel = day.isSelected ? `${tooltipText} (selected)` : tooltipText;

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

  const button = (
    <button
      type="button"
      onClick={handleClick}
      tabIndex={isInteractive ? 0 : -1}
      aria-label={ariaLabel}
      aria-current={day.isToday ? "date" : undefined}
      aria-disabled={!isInteractive}
      className={cn(buttonClasses, uniqueColors && "flex-col gap-0 leading-none")}
    >
      <span>{day.label}</span>
      {uniqueColors && (
        <span className="flex gap-px justify-center">
          {uniqueColors.map((color, i) => (
            <span
              key={i}
              className="inline-block rounded-full"
              style={{
                backgroundColor: color,
                width: size === "small" ? 4 : 5,
                height: size === "small" ? 4 : 5,
              }}
            />
          ))}
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
      <TooltipContent side="top">
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
});

CalendarCell.displayName = "CalendarCell";
