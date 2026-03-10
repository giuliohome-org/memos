import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useMemos } from "@/hooks/useMemoQueries";
import { useTagColors } from "@/hooks/useTagColors";

/**
 * Self-contained hook: computes per-date tag colors for the calendar.
 *
 * Logic:
 *  1. Reads the tag→color mapping from localStorage (useTagColors)
 *  2. Fetches memos (up to 1000) to know which tags appear on which date
 *  3. Returns getColorsForDate(date) that looks up tags for that date
 *     and maps them to their assigned colors on the fly
 */
export const useTagCalendarData = () => {
  const { tagColors } = useTagColors();
  const { data: memosResponse } = useMemos({ pageSize: 1000 });

  // Build date→tags mapping from loaded memos
  const tagsByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!memosResponse?.memos) return map;

    for (const memo of memosResponse.memos) {
      const displayTime = memo.displayTime ? timestampDate(memo.displayTime) : undefined;
      if (!displayTime || !memo.tags || memo.tags.length === 0) continue;

      const dateStr = dayjs(displayTime).format("YYYY-MM-DD");
      if (!map[dateStr]) map[dateStr] = [];
      for (const tag of memo.tags) {
        if (!map[dateStr].includes(tag)) {
          map[dateStr].push(tag);
        }
      }
    }
    return map;
  }, [memosResponse]);

  // On-the-fly: given a date, return the unique colors for its tags
  const getColorsForDate = useCallback(
    (date: string): string[] | undefined => {
      const tags = tagsByDate[date];
      if (!tags) return undefined;

      const colors: string[] = [];
      for (const tag of tags) {
        const c = tagColors[tag];
        if (c && !colors.includes(c)) colors.push(c);
      }
      return colors.length > 0 ? colors : undefined;
    },
    [tagsByDate, tagColors],
  );

  return { getColorsForDate };
};
