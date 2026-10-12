import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useMemo } from "react";
import { MonthCalendar } from "@/components/ActivityCalendar";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useDateFilterNavigation } from "@/hooks";
import { useCalendarPreferences } from "@/hooks/useCalendarPreferences";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import type { StatisticsData } from "@/types/statistics";
import { MonthNavigator } from "./MonthNavigator";

interface Props {
  statisticsData: StatisticsData;
  memos?: Memo[];
}

const StatisticsView = (props: Props) => {
  const { statisticsData, memos } = props;
  const { activityStats } = statisticsData;
  const navigateToDateFilter = useDateFilterNavigation();
  const { visibleMonth: visibleMonthString, setVisibleMonth: setVisibleMonthString } = useMemoFilterContext();
  const { workdaysOnly, setWorkdaysOnly, monthOnly, setMonthOnly } = useCalendarPreferences();

  const maxCount = useMemo(() => {
    const counts = Object.values(activityStats);
    return Math.max(...counts, 1);
  }, [activityStats]);
  const highlightedDays = useMemo(
    () =>
      new Set(
        (memos || [])
          .map((memo) => (memo.displayTime ? timestampDate(memo.displayTime) : undefined))
          .filter((date): date is Date => date !== undefined)
          .map((date) => dayjs(date).format("YYYY-MM-DD")),
      ),
    [memos],
  );

  return (
    <div className="group w-full mt-2 flex flex-col text-muted-foreground animate-fade-in">
      <MonthNavigator
        visibleMonth={visibleMonthString}
        onMonthChange={setVisibleMonthString}
        activityStats={activityStats}
        workdaysOnly={workdaysOnly}
        onWorkdaysOnlyChange={setWorkdaysOnly}
        monthOnly={monthOnly}
        onMonthOnlyChange={setMonthOnly}
      />

      <div className="w-full animate-scale-in">
        <MonthCalendar
          month={visibleMonthString}
          data={activityStats}
          maxCount={maxCount}
          onClick={navigateToDateFilter}
          highlightedDays={highlightedDays}
          workdaysOnly={workdaysOnly}
        />
      </div>
    </div>
  );
};

export default StatisticsView;
