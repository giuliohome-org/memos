import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useCalendarPreferences } from "@/hooks/useCalendarPreferences";
import { useMemos } from "@/hooks/useMemoQueries";
import { useStatsVisibilityFilter } from "@/hooks/useStatsVisibilityFilter";

/** What the calendar writes for one memo of a day. */
export interface CalendarDayEntry {
  /** Tags of the memo that have a calendar style, written with their label. */
  tags: { label: string; color?: string }[];
  /** First line of the memo without tags and markdown; empty when the memo is only tags. */
  text: string;
}

/**
 * First line of a memo that has some text once tags, markdown markers and links are removed:
 * "🇮🇹 Natale #festivo" → "🇮🇹 Natale", "#sw" → "".
 */
export const getMemoCalendarText = (content: string): string => {
  for (const rawLine of content.split("\n")) {
    const line = rawLine
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/(^|\s)#[^\s#]+/g, "$1")
      .replace(/[*_~`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line) return line;
  }
  return "";
};

/**
 * Self-contained hook: what the calendar shows for each date.
 *
 *  1. Reads the tag styles (color and label) from the user's calendar preferences
 *  2. Fetches memos (up to 1000) to know what happens on which date
 *  3. Returns, for a date, one entry per memo (oldest first) and the colors of its styled tags
 */
export const useTagCalendarData = () => {
  const { tagStyles } = useCalendarPreferences();
  const visibilityFilter = useStatsVisibilityFilter();
  const { data: memosResponse } = useMemos({ pageSize: 1000, ...(visibilityFilter && { filter: visibilityFilter }) });

  const entriesByDate = useMemo(() => {
    const byDate: Record<string, { time: number; entry: CalendarDayEntry }[]> = {};
    for (const memo of memosResponse?.memos ?? []) {
      const displayTime = memo.displayTime ? timestampDate(memo.displayTime) : undefined;
      if (!displayTime) continue;

      const tags = (memo.tags ?? [])
        .filter((tag) => tagStyles[tag])
        .map((tag) => ({ label: tagStyles[tag].label || tag, color: tagStyles[tag].color || undefined }));
      let text = getMemoCalendarText(memo.content);
      if (!text && tags.length === 0) {
        text = (memo.tags ?? []).map((tag) => `#${tag}`).join(" ");
      }

      const date = dayjs(displayTime).format("YYYY-MM-DD");
      (byDate[date] ??= []).push({ time: displayTime.getTime(), entry: { tags, text } });
    }

    const result: Record<string, CalendarDayEntry[]> = {};
    for (const [date, items] of Object.entries(byDate)) {
      result[date] = items.sort((a, b) => a.time - b.time).map((item) => item.entry);
    }
    return result;
  }, [memosResponse, tagStyles]);

  const getEntriesForDate = useCallback((date: string): CalendarDayEntry[] | undefined => entriesByDate[date], [entriesByDate]);

  // Unique colors of the styled tags of a date, for the compact calendar
  const getColorsForDate = useCallback(
    (date: string): string[] | undefined => {
      const colors: string[] = [];
      for (const entry of entriesByDate[date] ?? []) {
        for (const tag of entry.tags) {
          if (tag.color && !colors.includes(tag.color)) colors.push(tag.color);
        }
      }
      return colors.length > 0 ? colors : undefined;
    },
    [entriesByDate],
  );

  return { getEntriesForDate, getColorsForDate };
};
