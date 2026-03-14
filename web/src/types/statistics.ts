export interface StatisticsViewProps {
  className?: string;
}

export interface MonthNavigatorProps {
  visibleMonth: string;
  onMonthChange: (month: string) => void;
  activityStats: Record<string, number>;
  workdaysOnly?: boolean;
  onWorkdaysOnlyChange?: (workdaysOnly: boolean) => void;
}

export interface StatisticsData {
  activityStats: Record<string, number>;
}
