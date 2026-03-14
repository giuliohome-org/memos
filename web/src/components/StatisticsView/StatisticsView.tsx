import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import useLocalStorage from "react-use/lib/useLocalStorage";
import { MonthCalendar } from "@/components/ActivityCalendar";
import { useDateFilterNavigation } from "@/hooks";
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
  const [visibleMonthString, setVisibleMonthString] = useState(dayjs().format("YYYY-MM"));
  const [workdaysOnly, setWorkdaysOnly] = useLocalStorage<boolean>("calendar-workdays-only", false);

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
