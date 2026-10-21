/**
 * 直连大模型上下文紧缩（Compaction）与 Token 治理单元测试
 * 运行命令：npx tsx src/services/test-llm-compaction-governance.ts
 */

import {
  estimateTokenCount,
  getModelSafeContextBudget,
  compactConversationHistory,
  clearLlmSessionHistory,
  foldMessageContentToTokenBudget,
  extractStructuredMemoryKeyPoints,
  isModelVisionCapable,
} from './llmService';
import {
  parseTokenInputWithUnits,
  formatTokensHumanReadable,
  formatTokenUnitOnly,
  DEFAULT_REASONING_LEVELS,
  REASONING_EFFORT_OPTIONS,
} from '../components/ModelContextConfigPanel';
import { buildUnifiedSessionKey, buildAgentSessionKey } from './acpClient';

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

// 4. 测试带单位输入解析与人类可读换算 (parseTokenInputWithUnits / formatTokensHumanReadable)
console.log('\n4️⃣ 测试带单位输入解析与人性化换算 (如 384K, 1M, 2M)');
{
  // 4.1 换算解析
  const p384k = parseTokenInputWithUnits('384k');
  assert(p384k === 393216, '正确解析 "384k" -> 393,216 Tokens');

  const p384KUpper = parseTokenInputWithUnits('384K');
  assert(p384KUpper === 393216, '正确解析大写 "384K" -> 393,216 Tokens');

  const p1m = parseTokenInputWithUnits('1m');
  assert(p1m === 1000000, '正确解析 "1m" -> 1,000,000 Tokens');

  const p2m = parseTokenInputWithUnits('2M');
  assert(p2m === 2000000, '正确解析 "2M" -> 2,000,000 Tokens');

  const pNum = parseTokenInputWithUnits('384000');
  assert(pNum === 384000, '正确解析纯数值 "384000" -> 384,000 Tokens');

  const pEmpty = parseTokenInputWithUnits('');
  assert(pEmpty === undefined, '空字符串输入返回 undefined');

  // 4.2 人性化显示
  const f384k = formatTokensHumanReadable(393216);
  assert(f384k.includes('384K'), `393,216 Tokens 成功格式化为带 "384K" 标签 (实测: ${f384k})`);

  const f1m = formatTokensHumanReadable(1000000);
  assert(f1m.includes('1M'), `1,000,000 Tokens 成功格式化为带 "1M" 标签 (实测: ${f1m})`);
}

// 5. 测试极端超长消息在极小预算下的硬数学兜底保证 (Hard Budget Invariant)
console.log('\n5️⃣ 测试极端超长消息在小预算下的硬预算兜底与行内核折叠');
{
  // 构造用户指出的极端场景：预算 100 tokens，2 条各 5000 字的超长消息
  const hugeUserMsg = '【系统超长需求分析】' + '甲'.repeat(5000);
  const hugeAssistantMsg = '【架构超长推演响应】' + '乙'.repeat(5000);
  const extremeHistory = [
    { role: 'user' as const, content: hugeUserMsg },
    { role: 'assistant' as const, content: hugeAssistantMsg },
  ];

  const initialTokens = extremeHistory.reduce((acc, m) => acc + estimateTokenCount(m.content), 0);
  assert(initialTokens > 9000, `原始超长消息 Token 巨大 (实测: ${initialTokens} Tokens)`);

  const hardBudget = 100;
  const compactedExtreme = compactConversationHistory(extremeHistory, hardBudget, 4);

  const finalTokens = compactedExtreme.reduce((acc, m) => acc + estimateTokenCount(m.content), 0);
  assert(
    finalTokens <= hardBudget,
    `硬预算断言通过: 压缩后最终 Tokens (${finalTokens}) 严格 <= 预算上限 (${hardBudget})`
  );
  assert(compactedExtreme.length >= 2, `压缩后依然保持有效的多轮上下文交替结构 (条数: ${compactedExtreme.length})`);
  assert(
    compactedExtreme[0].role === 'user' && compactedExtreme[1].role === 'assistant',
    '极端压缩后严格保证 user / assistant 交替'
  );
  const hasFoldingNotice = compactedExtreme.some((m) => m.content.includes('已折叠'));
  assert(hasFoldingNotice, '内容过长时触发了行内核折叠说明');

  // 单条消息折叠函数单测
  const folded = foldMessageContentToTokenBudget('张三李四'.repeat(200), 50);
  const foldedTokens = estimateTokenCount(folded);
  assert(foldedTokens <= 50, `foldMessageContentToTokenBudget 保证单条输出严格 <= 预算 (实测: ${foldedTokens} <= 50)`);

  // 边界强化测试: 8 条超长中文消息在 33 ~ 200 极小预算区间的硬数学不变量验证
  const eightMessagesHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 1; i <= 4; i++) {
    eightMessagesHistory.push({
      role: 'user',
      content: `这是用户关于高并发分布式架构的复杂需求详细描述与接口规范 ${i} ` + '测'.repeat(500),
    });
    eightMessagesHistory.push({
      role: 'assistant',
      content: `这是助手关于架构方案推演与落地代码实现补丁生成的长文本回复 ${i} ` + '试'.repeat(500),
    });
  }

  const testBudgets = [33, 50, 80, 100, 150, 200];
  for (const b of testBudgets) {
    const compacted = compactConversationHistory(eightMessagesHistory, b, 4);
    const actualTokens = compacted.reduce((acc, m) => acc + estimateTokenCount(m.content), 0);
    assert(
      actualTokens <= b,
      `8条超长消息极小预算边界断言通过: 预算 ${b} Tokens -> 实测 ${actualTokens} Tokens (严格 <= ${b})`
    );
  }
}

// 6. 测试结构化 Memory 关键要点提炼与保留 (而非简单掐头去尾截断)
console.log('\n6️⃣ 测试结构化 Memory 关键要点提取器 (extractStructuredMemoryKeyPoints)');
{
  const richOlderHistory = [
    {
      role: 'user' as const,
      content: '针对本次分布式高并发网关，团队已确定选用 SQLite WAL 模式与 BWM 运筹求解，作为核心架构决议。',
    },
    {
      role: 'assistant' as const,
      content: '收到。关于关键参数与约束限制：历史稳态 Token 预算上限设为 512K，端口限制 8080，超时阈值设为 30 秒。',
    },
    {
      role: 'user' as const,
      content: '请注意未决争议与待办：必须排查死锁风险与并发水位线越界隐患，存在状态机竞争风险。',
    },
    {
      role: 'assistant' as const,
      content: '已完成 10 篇核心论文与源码映射矩阵落地，工程补丁已成功合入。',
    },
  ];

  const extracted = extractStructuredMemoryKeyPoints(richOlderHistory);
  assert(extracted.decisions.length > 0, `成功提取架构与技术决议 (${extracted.decisions.length} 条)`);
  assert(extracted.decisions.some((d) => d.includes('确定选用') || d.includes('架构')), '决议内容准确保留');

  assert(extracted.constraints.length > 0, `成功提取核心参数与工程约束 (${extracted.constraints.length} 条)`);
  assert(extracted.constraints.some((c) => c.includes('预算') || c.includes('端口')), '参数与约束准确保留');

  assert(extracted.risksAndTodos.length > 0, `成功提取未决争议与待办 (${extracted.risksAndTodos.length} 条)`);
  assert(extracted.risksAndTodos.some((r) => r.includes('死锁') || r.includes('风险')), '风险与待办准确保留');

  assert(extracted.deliverables.length > 0, `成功提取重要执行成果 (${extracted.deliverables.length} 条)`);
  assert(extracted.deliverables.some((d) => d.includes('已完成') || d.includes('合入')), '成果要点准确保留');

  // 将此历史经过 compactConversationHistory 折叠，验证生成的 <compacted-summary> 包含了这些结构化维度
  const compacted = compactConversationHistory(
    [
      ...richOlderHistory,
      { role: 'user', content: '现在请进入新一轮推演' },
      { role: 'assistant', content: '好的，请给出指令' },
    ],
    400,
    2
  );

  const summaryMsg = compacted[0].content;
  assert(summaryMsg.includes('【架构与技术决议】'), '生成的折叠摘要包含【架构与技术决议】');
  assert(summaryMsg.includes('【关键参数与约束】'), '生成的折叠摘要包含【关键参数与约束】');
  assert(summaryMsg.includes('【未决争议与待办】'), '生成的折叠摘要包含【未决争议与待办】');
  assert(summaryMsg.includes('【重要执行结果】'), '生成的折叠摘要包含【重要执行结果】');
}

// 7. 测试统一 Session Key 协议与模式物理隔离 (buildUnifiedSessionKey & buildAgentSessionKey)
console.log('\n7️⃣ 测试统一 Session Key 协议规范与模式物理隔离 (buildUnifiedSessionKey & buildAgentSessionKey)');
{
  // 7.1 私聊规范: dm:{agentId}:{threadId}
  const dmKey = buildUnifiedSessionKey({
    agentId: 'agent-alice',
    roomId: 'thread-dm-101',
    isDm: true,
  });
  assert(dmKey === 'dm:agent-alice:thread-dm-101', `私聊 key 规范符合预期: ${dmKey}`);

  // 7.2 议题标准模式规范: topic:{channelId}:{topicId}:standard (严格对齐原始字符串规范，单 Agent 内部不冗余 agentId)
  const topicStdKey = buildUnifiedSessionKey({
    roomId: 'topic-99',
    channelId: 'chan-arch',
    discussionMode: 'standard',
  });
  assert(topicStdKey === 'topic:chan-arch:topic-99:standard', `Rust 底层议题标准模式 key 符合原始字符串规范: ${topicStdKey}`);

  // 7.3 议题博弈模式规范: topic:{channelId}:{topicId}:game_theoretic
  const topicGameKey = buildUnifiedSessionKey({
    roomId: 'topic-99',
    channelId: 'chan-arch',
    discussionMode: 'game_theoretic',
  });
  assert(topicGameKey === 'topic:chan-arch:topic-99:game_theoretic', `Rust 底层议题博弈模式 key 符合原始字符串规范: ${topicGameKey}`);

  // 7.4 验证模式切换物理隔离性：同一议题不同模式下生成的 sessionKey 完全不相等
  assert(topicStdKey !== topicGameKey, '同一议题标准模式与博弈模式的 sessionKey 严格正交隔离，杜绝继承污染');

  // 7.5 频道主消息流规范: channel:{channelId}:{threadId}
  const chanKey = buildUnifiedSessionKey({
    roomId: 'chan-arch',
    channelId: 'chan-arch',
  });
  assert(chanKey === 'channel:chan-arch:chan-arch', `Rust 底层频道主流 key 符合原始字符串规范: ${chanKey}`);

  // 7.6 前端多 Agent 水位线与直连单例 LLM 缓存复合键: buildAgentSessionKey
  const agentTopicStdKey = buildAgentSessionKey({
    agentId: 'agent-bob',
    roomId: 'topic-99',
    channelId: 'chan-arch',
    discussionMode: 'standard',
  });
  assert(agentTopicStdKey === 'topic:chan-arch:topic-99:standard:agent-bob', `前端 Agent 专属复合键符合预期: ${agentTopicStdKey}`);
}

// 8. 测试直接紧凑单位格式化 (formatTokenUnitOnly: 1M, 2M, 128K, 384K 等)
console.log('\n8️⃣ 测试直接紧凑单位格式化 (formatTokenUnitOnly)');
{
  assert(formatTokenUnitOnly(1_000_000) === '1M', '1,000,000 成功格式化为紧凑 "1M"');
  assert(formatTokenUnitOnly(2_000_000) === '2M', '2,000,000 成功格式化为紧凑 "2M"');
  assert(formatTokenUnitOnly(131_072) === '128K', '131,072 成功格式化为紧凑 "128K"');
  assert(formatTokenUnitOnly(393_216) === '384K', '393,216 成功格式化为紧凑 "384K"');
  assert(formatTokenUnitOnly(65_536) === '64K', '65,536 成功格式化为紧凑 "64K"');
  assert(formatTokenUnitOnly(8_192) === '8K', '8,192 成功格式化为紧凑 "8K"');
  assert(formatTokenUnitOnly(4_096) === '4K', '4,096 成功格式化为紧凑 "4K"');
  assert(formatTokenUnitOnly(undefined) === '', 'undefined 返回空字符串');
}

// 9. 测试模型图片输入模态配置 (supportsImage / inputTypes)
console.log('\n9️⃣ 测试多模态图片输入支持 (supportsImage & inputTypes)');
{
  // 9.1 用户显式允许图片
  const configWithImage = {
    provider: 'openai_compatible' as const,
    modelId: 'glm-5.2',
    supportsImage: true,
    inputTypes: ['text' as const, 'image' as const],
  };
  assert(isModelVisionCapable(configWithImage) === true, '用户显式启用图片时 isModelVisionCapable 返回 true');

  // 9.2 用户显式禁用图片
  const configNoImage = {
    provider: 'openai_compatible' as const,
    modelId: 'glm-5.2',
    supportsImage: false,
    inputTypes: ['text' as const],
  };
  assert(isModelVisionCapable(configNoImage) === false, '用户显式禁用图片时 isModelVisionCapable 返回 false');

  // 9.3 缺省智能推导 Vision 视觉模型
  const autoVisionConfig = {
    provider: 'openai_compatible' as const,
    modelId: 'qwen-vl-max',
  };
  assert(isModelVisionCapable(autoVisionConfig) === true, '模型包含 vl 自动推断支持图片');
}

// 🔟 测试思考强度配置与默认选项 (Reasoning levels & default effort)
console.log('\n🔟 测试思考强度配置与默认选项 (Reasoning levels & default effort)');
{
  assert(DEFAULT_REASONING_LEVELS.length === 4, '默认包含 4 级基础映射 (off, low, medium, high)');
  assert(DEFAULT_REASONING_LEVELS[0].level === 'off', '第 1 级为 off');
  assert(DEFAULT_REASONING_LEVELS[1].level === 'low' && DEFAULT_REASONING_LEVELS[1].apiValue === 'low', '第 2 级为 low -> low');
  assert(DEFAULT_REASONING_LEVELS[2].level === 'medium' && DEFAULT_REASONING_LEVELS[2].apiValue === 'medium', '第 3 级为 medium -> medium');
  assert(DEFAULT_REASONING_LEVELS[3].level === 'high' && DEFAULT_REASONING_LEVELS[3].apiValue === 'high', '第 4 级为 high -> high');

  const defaultOption = REASONING_EFFORT_OPTIONS.find((o) => o.value === 'medium');
  assert(Boolean(defaultOption), '存在 medium 作为默认选项');
  assert(defaultOption?.label.includes('默认'), 'medium 选项标明了默认标识');
}

console.log('\n===================================================================');
console.log(`🎯 测试汇总: ${passed} passed, ${failed} failed`);
console.log('===================================================================');

if (failed > 0) {
  process.exit(1);
}
