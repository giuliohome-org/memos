# Plan for Highlighting Memo Dates in Calendar View

This document outlines the plan to implement a feature where selecting memos (e.g., by searching or clicking on a hashtag) will cause the corresponding date cells in the calendar view to be "selected" (e.g., with a different color, a box, or a star inside them).

## The Plan

1.  **Fetch Filtered Memos in `MainLayout.tsx`**: We'll use the `useMemos` and `useMemoFilters` hooks in the main layout file. This will give us the list of memos that are currently being displayed to the user after all filters (like tags, text search, etc.) have been applied.

2.  **Pass Memos to Sidebar**: We'll pass the list of filtered memos down as a new property (e.g., `memos`) to the `MemoExplorer` and `MemoExplorerDrawer` components, which act as the sidebar.

3.  **Pass Memos to Statistics View**: Inside the `MemoExplorer` component, we will forward this list of memos to the `StatisticsView` component.

4.  **Extract Memo Dates**: In `StatisticsView`, we will process the list of memos to extract their creation dates. This will result in a list of `Date` objects, one for each visible memo.

5.  **Pass Dates to Calendar**: We'll pass this list of dates down to the `MonthCalendar` component.

6.  **Highlight Dates in the Calendar**: In the `MonthCalendar` component, we will modify it to receive the list of dates. We will then pass a new prop `highlight` to each `CalendarCell` if the date of the cell is in the list of dates to highlight.

7.  **Visually Mark Highlighted Dates**: Finally, in the `CalendarCell` component, we'll update its rendering logic. If the `highlight` prop is true, we'll add a specific CSS class to visually mark the cell (e.g., change its background color, add a border, or put a small dot inside it).

This will result in the desired behavior: when the user filters the memos, the calendar will update to highlight the dates of the memos that are currently visible.
