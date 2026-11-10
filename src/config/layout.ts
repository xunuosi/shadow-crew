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
