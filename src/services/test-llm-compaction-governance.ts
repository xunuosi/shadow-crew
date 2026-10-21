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

// 2. 测试 2026 主流前沿模型与经典基座的安全预算分配
console.log('\n2️⃣ 测试 2026 主流大模型的上下文规格解析与安全预算 (getModelSafeContextBudget)');
{
  // 2.1 智谱 GLM-5.3 (1M 原生上下文，放宽输出)
  const glmBudget = getModelSafeContextBudget({
    provider: 'openai_compatible',
    modelId: 'glm-5.3',
  });
  assert(glmBudget.maxContextTokens === 1_000_000, '智谱 GLM-5.3 成功解析 1M 原生上下文 (1,000,000)');
  assert(glmBudget.reservedForOutput === 65536, '智谱 GLM-5.3 默认预留 64K 输出空间');
  assert(glmBudget.historyTokenBudget === 512000, '智谱 GLM-5.3 桌面稳态预算达到 512K Tokens');

  // 2.2 月之暗面 Kimi K3 (2M 原生上下文)
  const kimiBudget = getModelSafeContextBudget({
    provider: 'openai_compatible',
    modelId: 'kimi-k3-max',
  });
  assert(kimiBudget.maxContextTokens === 2_000_000, 'Kimi K3 Max 成功解析 2M 原生上下文 (2,000,000)');
  assert(kimiBudget.historyTokenBudget === 512000, 'Kimi K3 Max 桌面稳态预算受控在 512K Tokens 安全线');

  // 2.3 阿里通义千问 Qwen 3.8 (1M 原生上下文)
  const qwenBudget = getModelSafeContextBudget({
    provider: 'openai_compatible',
    modelId: 'qwen3.8-2.4t-a95b',
  });
  assert(qwenBudget.maxContextTokens === 1_000_000, 'Qwen 3.8 万亿 MoE 成功解析 1M 上下文');

  // 2.4 DeepSeek V4.1 Flash (1M 原生上下文)
  const dsBudget = getModelSafeContextBudget({
    provider: 'deepseek',
    modelId: 'deepseek-v4.1-flash',
  });
  assert(dsBudget.maxContextTokens === 1_000_000, 'DeepSeek V4.1 Flash 成功解析 1M 原生上下文');
  assert(dsBudget.reservedForOutput >= 65536, 'DeepSeek V4 预留充裕生成空间');

  // 2.5 Anthropic Claude 5.5 (1M 原生上下文，128K 输出)
  const claudeBudget = getModelSafeContextBudget({
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5-2026',
  });
  assert(claudeBudget.maxContextTokens === 1_000_000, 'Claude Sonnet 5.5 成功解析 1M 原生上下文');
  assert(claudeBudget.reservedForOutput === 131072, 'Claude Sonnet 5.5 默认预留 128K 输出空间');

  // 2.6 Google Gemini 4 Argon (2M 原生上下文)
  const geminiBudget = getModelSafeContextBudget({
    provider: 'openai_compatible',
    modelId: 'gemini-4-argon',
  });
  assert(geminiBudget.maxContextTokens === 2_000_000, 'Gemini 4 Argon 成功解析 2M 原生上下文');

  // 2.7 OpenAI GPT-5.6 Sol (1M 原生上下文)
  const gpt5Budget = getModelSafeContextBudget({
    provider: 'openai_compatible',
    modelId: 'gpt-5.6-sol',
  });
  assert(gpt5Budget.maxContextTokens === 1_000_000, 'GPT-5.6 Sol 成功解析 1M 原生上下文');

  // 2.8 本地轻量级模型 (Ollama: 8K 严格小窗口)
  const ollamaBudget = getModelSafeContextBudget({
    provider: 'ollama',
    modelId: 'llama3.3',
  });
  assert(ollamaBudget.maxContextTokens === 8192, 'Ollama 模型默认分配较小的上下文上限 (8192)');
  assert(ollamaBudget.historyTokenBudget <= 4096, 'Ollama 历史预算严格受控在安全线以下 (2867)');

  // 2.9 用户显式指定 contextWindowTokens / customContextBudget 优先级最高
  const customBudget = getModelSafeContextBudget({
    provider: 'custom',
    modelId: 'custom-private-model',
    contextWindowTokens: 500_000,
    customContextBudget: 300_000,
  });
  assert(customBudget.maxContextTokens === 500_000, '用户显式指定的 contextWindowTokens 生效');
  assert(customBudget.historyTokenBudget === 300_000, '用户显式指定的 customContextBudget 生效');
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
