import { matchPath, useLocation } from "react-router-dom";
import useCurrentUser from "@/hooks/useCurrentUser";
import { Routes } from "@/router";

/**
 * Returns the visibility filter that calendar and tag stats must apply on the Explore page,
 * so they only count the memos Explore actually lists (never the current user's private ones).
 * Returns undefined on every other page.
 */
export const useStatsVisibilityFilter = (): string | undefined => {
  const location = useLocation();
  const currentUser = useCurrentUser();

  if (!matchPath(Routes.EXPLORE, location.pathname)) {
    return undefined;
  }
  return currentUser ? `visibility in ["PUBLIC", "PROTECTED"]` : `visibility in ["PUBLIC"]`;
};
