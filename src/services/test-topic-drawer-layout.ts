import assert from 'node:assert/strict';
import {
  getTopicDrawerMaxWidth,
  MAX_TOPIC_DRAWER_WIDTH,
  MIN_MAIN_TIMELINE_WIDTH,
  MIN_TOPIC_DRAWER_WIDTH,
} from '../config/layout';

console.log('=== Topic Drawer Layout Test Suite ===');

assert.equal(MIN_MAIN_TIMELINE_WIDTH, 200);
assert.equal(MIN_TOPIC_DRAWER_WIDTH, 320);
assert.equal(MAX_TOPIC_DRAWER_WIDTH, 900);
console.log('✓ shared layout constants are stable');

assert.equal(getTopicDrawerMaxWidth(1835, 260), 900);
console.log('✓ wide viewport keeps the 900px drawer cap');

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

console.log('All Topic Drawer layout tests passed.');
