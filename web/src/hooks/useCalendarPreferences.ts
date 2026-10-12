import { create } from "@bufbuild/protobuf";
import { useCallback } from "react";
import { type GeneralSettingPatch, useAuth } from "@/contexts/AuthContext";
import { type UserSetting_GeneralSetting_TagStyle, UserSetting_GeneralSetting_TagStyleSchema } from "@/types/proto/api/v1/user_service_pb";

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
