/**
 * 长列表窗口化区间计算（纯函数，供 ChatTimeline 使用）。
 *
 * 语义契约：
 * - 未实测行按「已实测行均值」估算；完全没有实测时退化为 `estimatedRowHeight + gapPx`。
 * - 每个已渲染行实际占用 `height + gapPx`（对应容器 `space-y-*` 的相邻间距）。
 * - 首尾占位高度扣除自身会额外获得的 gap，保证占位总高与未渲染内容一致。
 * - `pinnedIndex` 指定的行必须落在窗口内（滚动定位目标行可能远离视口）。
 */
export interface VirtualWindowResult {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export interface VirtualWindowParams {
  ids: readonly string[];
  heights: ReadonlyMap<string, number>;
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
  estimatedRowHeight: number;
  gapPx: number;
  pinnedIndex?: number;
}

export function computeVirtualWindow(params: VirtualWindowParams): VirtualWindowResult {
  const {
    ids,
    heights,
    scrollTop,
    viewportHeight,
    overscanPx,
    estimatedRowHeight,
    gapPx,
    pinnedIndex,
  } = params;
  const count = ids.length;
  if (count === 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }

  let measuredSum = 0;
  let measuredCount = 0;
  for (const id of ids) {
    const height = heights.get(id);
    if (height !== undefined) {
      measuredSum += height + gapPx;
      measuredCount += 1;
    }
  }
  const estimate =
    measuredCount > 0
      ? measuredSum / measuredCount
      : estimatedRowHeight + gapPx;

  const prefix = new Array<number>(count + 1);
  prefix[0] = 0;
  for (let i = 0; i < count; i++) {
    const height = heights.get(ids[i]);
    prefix[i + 1] = prefix[i] + (height === undefined ? estimate : height + gapPx);
  }

  const windowTop = Math.max(0, scrollTop - overscanPx);
  const windowBottom = scrollTop + viewportHeight + overscanPx;

  let start = 0;
  while (start < count && prefix[start + 1] <= windowTop) start += 1;
  // 滚动到内容底部时 windowTop 可能越过最后一行，必须回退一行，
  // 否则 start === count 会导致窗口为空、末行永远不可见。
  if (start >= count) start = count - 1;
  let end = start;
  while (end < count && prefix[end] < windowBottom) end += 1;
  end = Math.min(count, Math.max(start + 1, end));

  if (pinnedIndex !== undefined && pinnedIndex >= 0 && pinnedIndex < count) {
    start = Math.min(start, pinnedIndex);
    end = Math.max(end, pinnedIndex + 1);
  }

  return {
    start,
    end,
    topPad: Math.max(0, prefix[start] - gapPx),
    bottomPad: Math.max(0, prefix[count] - prefix[end] - gapPx),
  };
}
