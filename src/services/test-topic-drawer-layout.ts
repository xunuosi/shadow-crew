import assert from 'node:assert/strict';
import {
  getTopicDrawerDefaultWidth,
  getTopicDrawerMaxWidth,
  MAX_TOPIC_DRAWER_DEFAULT_WIDTH,
  MIN_MAIN_TIMELINE_WIDTH,
  MIN_TOPIC_DRAWER_DEFAULT_WIDTH,
  MIN_TOPIC_DRAWER_WIDTH,
} from '../config/layout';

console.log('=== Topic Drawer Layout Test Suite ===');

assert.equal(MIN_MAIN_TIMELINE_WIDTH, 200);
assert.equal(MIN_TOPIC_DRAWER_WIDTH, 320);
console.log('✓ shared layout constants are stable');

assert.equal(getTopicDrawerMaxWidth(1835, 260), 1375);
assert.equal(getTopicDrawerMaxWidth(2200, 0), 2000);
console.log('✓ wide viewports let the topic drawer consume all available space');

const initialExpandedViewport = getTopicDrawerMaxWidth(1366, 0);
const furtherExpandedViewport = getTopicDrawerMaxWidth(1910, 0);
assert.equal(initialExpandedViewport, 1166);
assert.equal(furtherExpandedViewport, 1710);
assert.ok(furtherExpandedViewport > initialExpandedViewport);
console.log('✓ expanding the whole window keeps increasing the topic drawer limit');

assert.equal(getTopicDrawerMaxWidth(1360, 260), 900);
console.log('✓ 1360px viewport still leaves exactly 200px for messages');

assert.equal(getTopicDrawerMaxWidth(1200, 260), 740);
assert.equal(getTopicDrawerMaxWidth(1120, 260), 660);
console.log('✓ drawer width reserves the actual sidebar offset and 200px timeline');

assert.equal(getTopicDrawerMaxWidth(900, 0), 700);
assert.equal(getTopicDrawerMaxWidth(640, 0), 440);
console.log('✓ collapsed-sidebar viewport uses all available desktop space');

assert.equal(getTopicDrawerMaxWidth(400, 0), MIN_TOPIC_DRAWER_WIDTH);
assert.equal(getTopicDrawerMaxWidth(Number.NaN, Number.NaN), MIN_TOPIC_DRAWER_WIDTH);
assert.equal(getTopicDrawerMaxWidth(-100, -20), MIN_TOPIC_DRAWER_WIDTH);
console.log('✓ tiny and invalid viewport values clamp safely');

// 首次打开的默认宽度：按视口比例留出长文本阅读宽度，且始终落在安全区间内
assert.equal(getTopicDrawerDefaultWidth(1440), 662);
assert.equal(getTopicDrawerDefaultWidth(1920), MAX_TOPIC_DRAWER_DEFAULT_WIDTH);
assert.equal(getTopicDrawerDefaultWidth(800), 520);
assert.equal(getTopicDrawerDefaultWidth(0), MIN_TOPIC_DRAWER_DEFAULT_WIDTH);
assert.equal(getTopicDrawerDefaultWidth(Number.NaN), MIN_TOPIC_DRAWER_DEFAULT_WIDTH);
assert.equal(getTopicDrawerDefaultWidth(-100), MIN_TOPIC_DRAWER_DEFAULT_WIDTH);
console.log('✓ default drawer width is proportional, bounded, and safe on invalid input');

// 专注阅读：桌面视口下最大化宽度必须显著大于默认阅读宽度
assert.ok(getTopicDrawerMaxWidth(1440, 260) > getTopicDrawerDefaultWidth(1440));
assert.ok(getTopicDrawerMaxWidth(1920, 260) > getTopicDrawerDefaultWidth(1920));
console.log('✓ focus mode max width expands beyond the default reading width');

console.log('All Topic Drawer layout tests passed.');
