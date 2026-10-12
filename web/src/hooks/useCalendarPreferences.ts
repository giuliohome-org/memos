import { create } from "@bufbuild/protobuf";
import { useCallback, useEffect, useRef } from "react";
import { type GeneralSettingPatch, useAuth } from "@/contexts/AuthContext";
import {
  type UserSetting_GeneralSetting_TagStyle,
  UserSetting_GeneralSetting_TagStyleSchema,
  UserSetting_GeneralSettingSchema,
} from "@/types/proto/api/v1/user_service_pb";

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

export type TagStyles = Record<string, UserSetting_GeneralSetting_TagStyle>;

const NO_TAG_STYLES: TagStyles = {};

/**
 * Calendar preferences of the signed-in user (tag colors and labels, workdays only, month only).
 * They live in the user's general setting, so every browser sees the same ones.
 */
export const useCalendarPreferences = () => {
  const { userGeneralSetting, updateGeneralSetting } = useAuth();
  const tagStyles = userGeneralSetting?.tagStyles ?? NO_TAG_STYLES;

  const save = useCallback(
    (patch: GeneralSettingPatch, field: string) => {
      // AuthContext logs the failure and reloads the saved settings.
      updateGeneralSetting(patch, [field]).catch(() => undefined);
    },
    [updateGeneralSetting],
  );

  const setTagStyle = useCallback(
    (tag: string, style: { color?: string; label?: string }) => {
      const current = tagStyles[tag];
      const color = style.color ?? current?.color ?? "";
      const label = (style.label ?? current?.label ?? "").trim();
      const next = { ...tagStyles };
      if (!color && !label) {
        delete next[tag];
      } else {
        next[tag] = create(UserSetting_GeneralSetting_TagStyleSchema, { color, label });
      }
      save({ tagStyles: next }, "tag_styles");
    },
    [tagStyles, save],
  );

  const setWorkdaysOnly = useCallback((value: boolean) => save({ calendarWorkdaysOnly: value }, "calendar_workdays_only"), [save]);
  const setMonthOnly = useCallback((value: boolean) => save({ calendarAllMonths: !value }, "calendar_all_months"), [save]);

  return {
    tagStyles,
    setTagStyle,
    workdaysOnly: userGeneralSetting?.calendarWorkdaysOnly ?? false,
    setWorkdaysOnly,
    monthOnly: !(userGeneralSetting?.calendarAllMonths ?? false),
    setMonthOnly,
  };
};

// Keys used before the preferences moved to the database.
const LEGACY_TAG_COLORS = "tag-colors";
const LEGACY_WORKDAYS_ONLY = "calendar-workdays-only";
const LEGACY_MONTH_ONLY = "calendar-month-only";

const readLegacy = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/**
 * Moves the calendar preferences that this browser still keeps in localStorage into the user's
 * settings, without overwriting what is already saved there, then forgets the local copy.
 */
export const useMigrateLocalCalendarPreferences = () => {
  const { currentUser, userGeneralSetting, updateGeneralSetting } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !currentUser) return;
    started.current = true;

    const saved = userGeneralSetting ?? create(UserSetting_GeneralSettingSchema);
    const patch: GeneralSettingPatch = {};
    const fields: string[] = [];

    const colors = readLegacy(LEGACY_TAG_COLORS);
    if (colors && typeof colors === "object") {
      const styles = { ...saved.tagStyles };
      let added = false;
      for (const [tag, color] of Object.entries(colors)) {
        if (typeof color === "string" && color && !styles[tag]) {
          styles[tag] = create(UserSetting_GeneralSetting_TagStyleSchema, { color });
          added = true;
        }
      }
      if (added) {
        patch.tagStyles = styles;
        fields.push("tag_styles");
      }
    }
    if (readLegacy(LEGACY_WORKDAYS_ONLY) === true && !saved.calendarWorkdaysOnly) {
      patch.calendarWorkdaysOnly = true;
      fields.push("calendar_workdays_only");
    }
    if (readLegacy(LEGACY_MONTH_ONLY) === false && !saved.calendarAllMonths) {
      patch.calendarAllMonths = true;
      fields.push("calendar_all_months");
    }

    const forget = () => {
      for (const key of [LEGACY_TAG_COLORS, LEGACY_WORKDAYS_ONLY, LEGACY_MONTH_ONLY]) {
        try {
          localStorage.removeItem(key);
        } catch {
          // Nothing to clean up without localStorage.
        }
      }
    };

    if (fields.length === 0) {
      forget();
      return;
    }
    updateGeneralSetting(patch, fields).then(forget, () => {
      // Try again on the next mount; the local copy is still there.
      started.current = false;
    });
  }, [currentUser, userGeneralSetting, updateGeneralSetting]);
};
