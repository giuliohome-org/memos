import { BriefcaseIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { YearCalendar } from "@/components/ActivityCalendar";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import i18n from "@/i18n";
import { addMonths, formatMonth, getMonthFromDate, getYearFromDate, setYearAndMonth } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { MonthNavigatorProps } from "@/types/statistics";

export const MonthNavigator = ({ visibleMonth, onMonthChange, activityStats, workdaysOnly, onWorkdaysOnlyChange }: MonthNavigatorProps) => {
  const t = useTranslate();
  const [isOpen, setIsOpen] = useState(false);
  const currentMonth = new Date(visibleMonth);
  const currentYear = getYearFromDate(visibleMonth);
  const currentMonthNum = getMonthFromDate(visibleMonth);

  const handlePrevMonth = () => {
    onMonthChange(addMonths(visibleMonth, -1));
  };

  const handleNextMonth = () => {
    onMonthChange(addMonths(visibleMonth, 1));
  };

  const handleDateClick = (date: string) => {
    onMonthChange(formatMonth(date));
    setIsOpen(false);
  };

  const handleYearChange = (year: number) => {
    onMonthChange(setYearAndMonth(year, currentMonthNum));
  };

  return (
    <div className="w-full mb-2 flex flex-row justify-between items-center gap-1">
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <button className="px-2 py-1 -ml-2 rounded-md hover:bg-secondary/50 text-sm text-foreground font-semibold transition-colors flex items-center gap-1 select-none group">
            {currentMonth.toLocaleString(i18n.language, { year: "numeric", month: "long" })}
            <ChevronDownIcon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </DialogTrigger>
        <DialogContent className="p-0 border-none bg-background md:max-w-4xl" size="2xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Select Month</DialogTitle>
          <YearCalendar selectedYear={currentYear} data={activityStats} onYearChange={handleYearChange} onDateClick={handleDateClick} workdaysOnly={workdaysOnly} />
        </DialogContent>
      </Dialog>
      <div className="flex justify-end items-center shrink-0 gap-0.5">
        <button
          className={cn(
            "p-1 rounded-md transition-all mr-1",
            workdaysOnly ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onWorkdaysOnlyChange?.(!workdaysOnly)}
          title={workdaysOnly ? t("common.show-all-days") : t("common.show-workdays-only")}
        >
          <BriefcaseIcon className="w-4 h-4" />
        </button>
        <button
          className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-all"
          onClick={handlePrevMonth}
          aria-label="Previous month"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <button
          className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-all"
          onClick={handleNextMonth}
          aria-label="Next month"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
