/**
 * Main chat/composer column minimum width.
 * Keep this aligned with the Topic Drawer max-width reservation.
 */
export const MIN_MAIN_TIMELINE_WIDTH = 200;

/** Right-side Topic Drawer minimum usable width. */
export const MIN_TOPIC_DRAWER_WIDTH = 320;

/**
 * Reserve the actual workspace offset (normally the left sidebar) and the
 * main timeline's minimum width before sizing the right drawer.
 */
export function getTopicDrawerMaxWidth(
  viewportWidth: number,
  workspaceLeftOffset = 0
): number {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const safeWorkspaceLeftOffset = Number.isFinite(workspaceLeftOffset)
    ? Math.max(0, workspaceLeftOffset)
    : 0;
  const availableWidth = Math.floor(
    safeViewportWidth - safeWorkspaceLeftOffset - MIN_MAIN_TIMELINE_WIDTH
  );

  return Math.max(
    MIN_TOPIC_DRAWER_WIDTH,
    availableWidth
  );
}

/** Default reading width bounds for the topic drawer (long-form debate text). */
export const MIN_TOPIC_DRAWER_DEFAULT_WIDTH = 520;
export const MAX_TOPIC_DRAWER_DEFAULT_WIDTH = 760;

/**
 * First-open width of the topic drawer: a viewport-proportional reading width
 * instead of the former cramped fixed value. Users can still drag/resize or use
 * focus mode; this only decides the untouched default.
 */
export function getTopicDrawerDefaultWidth(viewportWidth: number): number {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const proportional = Math.round(safeViewportWidth * 0.46);
  return Math.min(
    MAX_TOPIC_DRAWER_DEFAULT_WIDTH,
    Math.max(MIN_TOPIC_DRAWER_DEFAULT_WIDTH, proportional)
  );
}
