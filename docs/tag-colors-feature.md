# Feature: Per-Hashtag Color Selection with Calendar Visualization

## Overview

This feature allows users to assign a color to each hashtag and displays
colored bars in the monthly calendar view, making it easy to see at a glance
which tags are associated with memos on any given day.

## Architecture

### Data Flow

```
localStorage ("tag-colors")
       │
       ▼
useTagColors()                          useTagCalendarData()
  (read/write tag→color)                  (self-contained hook)
       │                                    │          │
       ▼                                    │  uses    │ fetches memos
TagsSection                                 │  ┌──────┘  (pageSize: 1000)
  (color picker UI via                      ▼  ▼
   TagColorPicker component)          MonthCalendar
                                      calls getColorsForDate(date)
                                            │
                                            ▼
                                      CalendarCell
                                      (renders colored bars)
```

**Key design choice:** The `MonthCalendar` component calls `useTagCalendarData()`
directly — no prop drilling through intermediate components. The hook is
self-contained: it reads tag colors from localStorage, fetches memos internally,
and exposes a single `getColorsForDate(date)` function that resolves tag→color
mappings on the fly for any date/month.

### Files

#### 1. `web/src/hooks/useTagColors.ts`

Manages tag→color persistence in `localStorage`.

**Design choices:**
- Uses `useSyncExternalStore` (React 18) for cross-component consistency.
  When one component changes a color, all consumers re-render immediately
  without prop drilling.
- "External store" pattern with `cachedColors` + `listeners` avoids parsing
  JSON from localStorage on every render.
- `TAG_COLOR_PALETTE`: 8 predefined colors from the Tailwind palette, chosen
  for good contrast on both light and dark themes.

```typescript
const { tagColors, setTagColor } = useTagColors();

setTagColor("work", "#3b82f6");  // assign blue
setTagColor("work", null);       // remove
```

#### 2. `web/src/hooks/useTagCalendarData.ts`

Self-contained hook consumed directly by `MonthCalendar`. Encapsulates:
1. Reading tag→color mapping via `useTagColors()`
2. Fetching memos (`pageSize: 1000`) to build a date→tags index
3. Exposing `getColorsForDate(date)` that maps tags to their assigned colors

This hook eliminates the need to thread `tagsByDate` and `tagColors` through
5 layers of components (MainLayout → MemoExplorer → StatisticsView →
MonthCalendar → CalendarCell).

**Limitation:** Covers up to 1000 most recent memos. For users with more
memos, older dates won't show colored bars. A backend endpoint returning
per-date tag data would remove this limit entirely.

#### 3. `web/src/components/MemoExplorer/TagsSection.tsx`

Contains the `TagColorPicker` component: a Radix `Popover` (portal-based)
that opens on **right-click** and renders a palette of 8 color circles.

**Interaction model:**
- **Left click** on a tag → filter memos by that tag (original behavior preserved)
- **Right click** on the tag icon (# or colored dot) → opens the color picker
  in a portal overlay, never clipped by sidebar bounds
- Clicking a selected color again removes it (toggle)
- X button explicitly removes the assigned color

The `Popover` uses `side="right"` to open toward the content area, avoiding
the sidebar edge.

#### 4. `web/src/components/ActivityCalendar/CalendarCell.tsx`

Renders colored bars below the day number.

**Adaptive sizing with `flex-1`:**
- Bars use `flex-1` to share available width equally
- 1 bar: stretches to ~80% of cell width (via `maxWidth`), height 6px
- 2 bars: each takes half the width, height 6px
- 3-4 bars: each takes a quarter, height 4px
- Maximum 4 bars per cell (colors are deduplicated)

**Layout:** The button switches to `flex-col` layout when bars are present,
with the day number above and bars centered below.

#### 5. `web/src/components/ActivityCalendar/MonthCalendar.tsx`

Calls `useTagCalendarData()` directly and passes
`getColorsForDate(day.date)` to each `CalendarCell`. No external props needed
for tag color data.

#### 6. `web/src/layouts/MainLayout.tsx`

- Sidebar widened: `w-96` (384px) on `lg`, `w-72` (288px) on `md`
  (previously `w-72` / `w-56`) to give the calendar more room

#### 7. `web/src/components/ActivityCalendar/constants.ts`

Calendar cell font increased from `text-xs` to `text-sm` for the default size.

## Known Limitations

- **Max 1000 memos**: `useTagCalendarData` loads up to 1000 memos to build the
  date→tags index. For users with more memos, older dates won't display colored
  bars. A dedicated backend endpoint would solve this.
- **Colors in localStorage**: not synced across devices. Cross-device sync
  would require storing colors as a `user_setting` in the database.
- **Flat view only**: the color picker works in the flat tag list, not in
  tree mode.
