import assert from 'node:assert/strict';
import type { Agent } from '../types';
import {
  isSimpleQuestion,
  pickFastPathAgent,
  resolveFastPathResponder,
} from './intentRouter';

function makeAgent(id: string, status: Agent['status']): Agent {
  return {
    id,
    name: id,
    handle: `@${id}`,
    avatar: '🥷',
    status,
    tags: [],
    modelBadge: 'Local',
  } as unknown as Agent;
}

const cases: Array<{ text: string; expected: boolean; why: string }> = [
  { text: '这个函数是干什么的？', expected: true, why: '短中文疑问句' },
  { text: '如何配置 ACP 端点？', expected: true, why: '疑问词开头且很短' },
  { text: 'how do I reset the session?', expected: true, why: '英文疑问句' },
  { text: '请评审一下这个重构方案？', expected: false, why: '评审/重构属于复杂诉求' },
  { text: '分析一下整个项目的数据库并发架构？', expected: false, why: '复杂意图关键词' },
  { text: '看看这段代码：```ts\nconst a = 1;\n```', expected: false, why: '含代码块' },
  { text: '@bob 这个函数干什么？', expected: false, why: '显式点名必须尊重用户选择' },
  { text: '这是一个很长的问题'.repeat(30) + '？', expected: false, why: '超长文本' },
  { text: '你好', expected: false, why: '非疑问句' },
  { text: '', expected: false, why: '空输入' },
];

for (const item of cases) {
  assert.equal(
    isSimpleQuestion(item.text),
    item.expected,
    `isSimpleQuestion 判定错误：${item.why} (${JSON.stringify(item.text.slice(0, 40))})`
  );
}

const offline = makeAgent('offline', 'idle');
const online = makeAgent('online', 'running');
assert.equal(pickFastPathAgent([]), null, '空候选应返回 null');
assert.equal(pickFastPathAgent([offline])?.id, 'offline', '无在线 Agent 时应回退第一个');
assert.equal(pickFastPathAgent([offline, online])?.id, 'online', '应优先在线 Agent');

const candidates = [makeAgent('a1', 'running'), makeAgent('a2', 'running')];
assert.equal(resolveFastPathResponder('如何启用会话恢复？', candidates)?.id, 'a1', '简单问题应收窄为单 Agent');
assert.equal(resolveFastPathResponder('请对比两种架构并给出选型建议？', candidates), null, '复杂问题不得走快答');

console.log('✅ intent-router: 10 条问题判定 + 3 条 Agent 选择断言全部通过');
