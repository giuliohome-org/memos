import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "tag-colors";

// Predefined color palette for tags
export const TAG_COLOR_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

type TagColors = Record<string, string>;

let cachedColors: TagColors | null = null;

const getColors = (): TagColors => {
  if (cachedColors) return cachedColors;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    cachedColors = stored ? JSON.parse(stored) : {};
  } catch {
    cachedColors = {};
  }
  return cachedColors!;
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifyListeners = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const useTagColors = () => {
  const colors = useSyncExternalStore(subscribe, getColors, getColors);

  const setTagColor = useCallback((tag: string, color: string | null) => {
    const current = { ...getColors() };
    if (color === null) {
      delete current[tag];
    } else {
      current[tag] = color;
    }
    cachedColors = current;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    notifyListeners();
  }, []);

  return { tagColors: colors, setTagColor };
};
