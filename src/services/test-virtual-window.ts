import assert from 'node:assert/strict';
import { computeVirtualWindow } from '../utils/virtualWindow';

// 契约：窗口区间必须覆盖视口 ± overscan；首尾占位与未渲染内容高度一致；定位目标行强制进入窗口。

const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
const heights = new Map<string, number>(ids.map((id) => [id, 100]));
const base = {
  ids,
  heights,
  overscanPx: 0,
  estimatedRowHeight: 100,
  gapPx: 10,
};

// 空列表
assert.deepEqual(
  computeVirtualWindow({ ...base, ids: [], heights: new Map(), scrollTop: 0, viewportHeight: 500 }),
  { start: 0, end: 0, topPad: 0, bottomPad: 0 },
  '空列表不得产生窗口'
);

// 单行
assert.deepEqual(
  computeVirtualWindow({ ...base, ids: ['only'], heights: new Map([['only', 100]]), scrollTop: 0, viewportHeight: 500 }),
  { start: 0, end: 1, topPad: 0, bottomPad: 0 },
  '单行必须渲染且无占位'
);

// 未实测时按 estimatedRowHeight + gapPx 估算：每行 110px，视口 220px → 渲染 2 行
const estimated = computeVirtualWindow({
  ...base,
  heights: new Map(),
  scrollTop: 0,
  viewportHeight: 220,
});
assert.equal(estimated.start, 0, '顶部不得跳过首行');
assert.equal(estimated.end, 2, '未实测行按估算高度覆盖视口');
assert.equal(estimated.topPad, 0, '顶部无占位');
assert.equal(estimated.bottomPad, 10 * 110 - 2 * 110 - 10, '底部占位需扣除自身 gap');

// 滚动到中部：视口恰好落在第 4~5 行（每行 110px，含 gap）
const middle = computeVirtualWindow({ ...base, scrollTop: 440, viewportHeight: 220 });
assert.equal(middle.start, 4, '窗口起止按累加高度对齐');
assert.equal(middle.end, 6, '窗口起止按累加高度对齐');
assert.equal(middle.topPad, 4 * 110 - 10, '顶部占位扣除自身 gap');
assert.equal(middle.bottomPad, 10 * 110 - 6 * 110 - 10, '底部占位扣除自身 gap');

// 真实 DOM 高度（容器 space-y-10）：topPad + gap + 行 + gap + 行 + gap + bottomPad
const renderedRows = middle.end - middle.start;
const renderedHeight = renderedRows * 100 + (renderedRows - 1) * 10;
const boundaryGaps = 2 * 10;
assert.equal(
  middle.topPad + boundaryGaps + renderedHeight + middle.bottomPad,
  10 * 100 + 9 * 10,
  '窗口化后的真实 DOM 高度必须等于全量列表高度，滚动条不得跳动'
);

// 实测行参与估算：混合实测/未实测不应崩溃且区间合法
const mixed = computeVirtualWindow({
  ...base,
  heights: new Map([['m0', 400], ['m1', 60]]),
  scrollTop: 0,
  viewportHeight: 300,
});
assert.ok(mixed.start === 0 && mixed.end >= 1 && mixed.end <= 10, '混合实测行区间必须合法');

// overscan 扩展：同样视口，带 overscan 应渲染更多行
const noOverscan = computeVirtualWindow({ ...base, heights: new Map(ids.map((id) => [id, 100])), scrollTop: 440, viewportHeight: 110 });
const withOverscan = computeVirtualWindow({ ...base, heights: new Map(ids.map((id) => [id, 100])), scrollTop: 440, viewportHeight: 110, overscanPx: 220 });
assert.ok(withOverscan.end >= noOverscan.end, 'overscan 不得缩小窗口');
assert.ok(withOverscan.start <= noOverscan.start, 'overscan 不得缩小窗口');

// 定位目标行（视口外）必须被强制纳入窗口
const pinned = computeVirtualWindow({ ...base, scrollTop: 0, viewportHeight: 110, pinnedIndex: 7 });
assert.ok(pinned.start <= 7 && pinned.end >= 8, 'pinnedIndex 指定的行必须在窗口内');
assert.equal(pinned.start, 0, '不得丢掉窗口原有起始行');

// 非法的 pinnedIndex 不得破坏窗口
const badPinned = computeVirtualWindow({ ...base, scrollTop: 0, viewportHeight: 110, pinnedIndex: 99 });
assert.notEqual(badPinned.end, 0, '越界 pinnedIndex 不得产生空窗口');

// 底部滚动到底：end 必须等于总数，bottomPad 为 0
const bottom = computeVirtualWindow({ ...base, scrollTop: 110 * 10, viewportHeight: 220 });
assert.equal(bottom.end, 10, '滚动到底必须渲染末行');
assert.equal(bottom.bottomPad, 0, '滚动到底底部无占位');

console.log('✅ virtual-window: 14 条窗口化布局契约断言全部通过');
