/**
 * 直连大模型上下文紧缩（Compaction）与 Token 治理单元测试
 * 运行命令：npx tsx src/services/test-llm-compaction-governance.ts
 */

import {
  estimateTokenCount,
  getModelSafeContextBudget,
  compactConversationHistory,
  clearLlmSessionHistory,
} from './llmService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${msg}`);
    failed++;
  }
}

console.log('===================================================================');
console.log('🧪 Shadow Crew 直连大模型上下文压缩 (Context Compaction) 验证套件');
console.log('===================================================================\n');

// 1. 测试 Token 估算器
console.log('1️⃣ 测试轻量级加权 Token 估算器 (estimateTokenCount)');
{
  const emptyTokens = estimateTokenCount('');
  assert(emptyTokens === 0, '空文本估算结果为 0');

  const enText = 'Hello world, this is a clean test.';
  const enTokens = estimateTokenCount(enText);
  assert(enTokens > 5 && enTokens < 15, `纯英文文本 Token 估算合理 (chars: ${enText.length}, tokens: ${enTokens})`);

  const zhText = '多智能体博弈协同系统上下文治理与确定性仲裁';
  const zhTokens = estimateTokenCount(zhText);
  assert(zhTokens >= 20 && zhTokens <= 25, `纯中文文本 Token 估算合理 (chars: ${zhText.length}, tokens: ${zhTokens})`);

  const mixedText = 'Claude Code CLI 与 Rust stdio 进程通过 session/prompt 交互，处理 <delta-events>';
  const mixedTokens = estimateTokenCount(mixedText);
  assert(mixedTokens > 20 && mixedTokens < 50, `混合文本 Token 估算合理 (tokens: ${mixedTokens})`);
}

// 2. 测试模型安全预算分配
console.log('\n2️⃣ 测试不同模型的上下文安全预算分配 (getModelSafeContextBudget)');
{
  const ollamaBudget = getModelSafeContextBudget({
    provider: 'ollama',
    modelId: 'llama3.3',
  });
  assert(ollamaBudget.maxContextTokens === 8192, 'Ollama 模型默认分配较小的上下文上限 (8192)');
  assert(ollamaBudget.historyTokenBudget <= 4096, 'Ollama 历史预算严格受控在安全线以下');

  const claudeBudget = getModelSafeContextBudget({
    provider: 'anthropic',
    modelId: 'claude-3-7-sonnet-20250219',
  });
  assert(claudeBudget.maxContextTokens === 128000, 'Claude 3.7 模型分配大上下文上限 (128000)');
  assert(claudeBudget.historyTokenBudget > 50000, 'Claude 历史预算充裕');
}

// 3. 测试上下文紧缩算法 (compactConversationHistory)
console.log('\n3️⃣ 测试上下文紧缩算法与角色交替不变量');
{
  // 3.1 少量对话不压缩
  const smallHistory = [
    { role: 'user' as const, content: '请设计网关鉴权' },
    { role: 'assistant' as const, content: '推荐使用 JWT 配合 Redis 校验' },
  ];
  const compactedSmall = compactConversationHistory(smallHistory, 4000);
  assert(compactedSmall.length === 2, '未超预算且未超轮数时，历史保持原样不动，以保持 KV Cache');

  // 3.2 制造超长多轮历史
  const longHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 1; i <= 10; i++) {
    longHistory.push({
      role: 'user',
      content: `[轮次 ${i} 提问]: 这是关于模块 ${i} 的详细需求描述，涉及接口设计与数据模型变更，包含大段说明：` + 'A'.repeat(300),
    });
    longHistory.push({
      role: 'assistant',
      content: `[轮次 ${i} 回复]: 针对模块 ${i} 的架构落地建议，方案如下：` + 'B'.repeat(500),
    });
  }

  const budget = 1200; // 设置较紧的预算触发压缩
  const compacted = compactConversationHistory(longHistory, budget, 4);

  assert(compacted.length < longHistory.length, `长对话被成功压缩 (原始 ${longHistory.length} 条 -> 压缩后 ${compacted.length} 条)`);
  assert(compacted[0].content.includes('<compacted-summary'), '首轮为生成的 <compacted-summary> 折叠摘要块');
  assert(compacted[0].role === 'user', '压缩首条消息保持 user 角色');
  assert(compacted[1].role === 'assistant', '压缩次条消息保持 assistant 角色');

  // 校验严格交替
  let isAlternating = true;
  for (let i = 0; i < compacted.length; i++) {
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (compacted[i].role !== expected) {
      isAlternating = false;
      break;
    }
  }
  assert(isAlternating, '压缩后的整个消息序列严格满足 user / assistant 交替约束，杜绝 API 拒绝报错');

  // 校验最近的活跃工作轮次完整保留
  const lastMsg = compacted[compacted.length - 1];
  assert(lastMsg.content.includes('[轮次 10 回复]'), '最近一轮的关键 assistant 回复被完整保留');

  // 3.3 测试多次连续压缩不会嵌套 <compacted-summary>
  const recompacted = compactConversationHistory(compacted, 600, 2);
  const nestedCount = (recompacted[0].content.match(/<compacted-summary/g) || []).length;
  assert(nestedCount === 1, '多次连续压缩时，旧的摘要被平铺合并，不发生嵌套标签失控');
}

console.log('\n===================================================================');
console.log(`🎯 测试汇总: ${passed} passed, ${failed} failed`);
console.log('===================================================================');

if (failed > 0) {
  process.exit(1);
}
