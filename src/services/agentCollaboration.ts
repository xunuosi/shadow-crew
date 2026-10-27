import { useState, useRef, useCallback } from 'react';
import { matchesSessionScope } from './acpClient';
import { 
  Agent, 
  Channel,
  Thread,
  Message,
  DiscussionMode, 
  GameRolesConfig, 
  GameRoleType, 
  GameTheoreticStage,
  McdaCriterion,
  McdaDecisionPayload,
  MinorityReport,
  SprtGovernorState,
  DisputeSpanPacket,
  ArgumentNode,
  GroundingEvidence,
  SycophancyEvaluation,
  ModelDiversityEvaluation,
  ModularOrchestrationState,
  TaskModuleSlice,
  SharedInterfaceContract,
  MessageKind,
} from '../types';
import {
  solveDeterministicBwm,
  solveExactBwmOptionB,
  stepSprtGovernor,
  fitSprtCalibrationParams,
  estimateRoundAlignmentScore,
  compileMinorityReport,
  extractArgumentNodes,
  localizeEarliestDispute,
  dehydrateContextToCommittedStates,
  dehydrateContextWithAlert,
  logGameTheoreticTelemetry,
  getMetricBaselineSummary,
  getMetricBaselineReport,
  validateStageContract,
  validateModuleScopeContract,
  STAGE_CONTRACT_MAX_RETRIES,
  tieredGroundingGovernor,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
  detectModelFamily,
  calculateModelDiversity,
  calculateConfidenceMatrix,
  buildArgumentDag,
  calculateAffectedSubgraph,
  localizeGraphDiffDispute,
  calculateColMadContributions,
  estimateModulePriorRisk,
  sanitizeModuleDependencyDAG,
  initializeModularOrchestrationState,
  updateModuleBeliefWithFeedback,
  getNextSchedulableModule,
  advanceModularOrchestration,
  stepModularStageTransition,
  computeEntropyReductionRatio,
  buildDefaultDecompositionFromTopic,
} from './cogno';

export interface CollaborationCascade {
  cascadeId: string;
  rootMessageId: string;
  roomId: string;
  originalPrompt: string;
  depth: number; // 1 表示首位响应者，2 表示第二跳响应者，依此类推
  maxDepth: number; // 安全兜底跳数限制 (默认为 12)
  visitedAgentIds: string[];
  agentCallCounts: Record<string, number>;
  isAborted: boolean;
  terminationReason?: 'max_depth_reached' | 'loop_detected' | 'user_abort' | 'none';
}

/**
 * 单词与标识符延续字符 (用于判断 @mention 边界，严格防止前缀重叠与词中误伤)
 * 英文字母、数字、下划线、短横线均视为标识符构成字符
 */
export const IDENTIFIER_CHAR_REGEX = /[a-zA-Z0-9_\-]/;

/**
 * 根据 Agent 名称生成规范化的唯一通信 Handle (@handle)
 * 强制保持 handle 与 name 严格对齐（如 GlmClaude-01 -> @glmclaude-01），
 * 彻底杜绝改名后遗留历史旧 handle（如 @glmclaude）导致跨 Agent 误识别
 */
export function normalizeAgentHandle(name: string, agentId?: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '@agent';
  if (agentId === 'agent-shinobi-core' && trimmed === 'Shinobi Core (Rust)') {
    return '@shinobi-core';
  }
  const clean = trimmed.replace(/^@+/, '').toLowerCase().replace(/\s+/g, '-');
  return `@${clean}`;
}

/**
 * 获取 Agent 的有效规范化 Handle：
 * - 若 handle 缺失、包含已移除的「副本」后缀、或因改名遗留了缺失编号后缀的旧前缀（如 GlmClaude-01 残留 @glmclaude），
 *   则强制对齐至基于当前 name 生成的规范化 handle (@glmclaude-01)。
 */
export function resolveEffectiveAgentHandle(agent: Pick<Agent, 'id' | 'name' | 'handle'>): string {
  const canonical = normalizeAgentHandle(agent.name, agent.id);
  const raw = (agent.handle || '').trim();
  if (!raw) return canonical;

  const rawWithAt = (raw.startsWith('@') ? raw : `@${raw}`).toLowerCase();
  if (rawWithAt === canonical) return canonical;

  // 1. 历史「副本」残留清理
  if (rawWithAt.includes('副本') && !canonical.includes('副本')) {
    return canonical;
  }

  // 2. 改名增补数字编号后缀后遗留的旧短前缀（例如 GlmClaude 改名为 GlmClaude-01 后，旧 handle 仍残留 @glmclaude）
  if (
    /[-_]\d+$/.test(canonical) &&
    canonical.replace(/[-_]\d+$/, '') === rawWithAt
  ) {
    return canonical;
  }

  return rawWithAt;
}

/**
 * 全员点名匹配正则：必须具备独立的词法边界，防止类似 contact@all.com 或 overall 误触发
 */
export const ALL_MENTION_REGEX = /(?:^|[^a-zA-Z0-9_\-])@(all|所有人|team)(?:$|[^a-zA-Z0-9_\-])/i;

/**
 * 判断内容是否包含合法的全员点名 (@all / @所有人 / @team)
 */
export function isAllMention(content: string): boolean {
  if (!content) return false;
  return ALL_MENTION_REGEX.test(content);
}

/**
 * 从文本中提取所有被 @ 提到的有效 Agent
 * 自动排除发言者自己，且仅识别当前候选范围已准入的 Agent
 *
 * 核心机制：
 * 1. 严格词法与标识符边界检测 (Word/Token Boundary)：
 *    - @ 前不能为标识符字符 [a-zA-Z0-9_\-] (防止 email@domain 或 abc-@mention 误伤)；
 *    - 匹配串后不能为标识符字符 [a-zA-Z0-9_\-]，或域名后缀 (.com, .ai 等) 或路径前缀 (/repo)；
 *    - 完美支持句末标点符号 (@agent. 或 @agent，)、空格 (@agent ) 以及中文无空格连缀 (@agent请从逃逸红队视角开始攻击)。
 * 2. 最长匹配优先 (Longest Match First) 与区间占用锁定 (Range Reservation)：
 *    - 降序排序所有候选模式 (如 @mycodex-02 / @mycodex-副本 优先于 @mycodex)；
 *    - 匹配成功后锁定字符区间 [start, end)，杜绝短子串在长 handle 中产生前缀冲突或重叠误领。
 * 3. 彻底废除破环性字符裁剪 (禁止 replace(/[^a-z0-9]/g, ''))，完整保留 CJK 中文别名与符号。
 */
export function parseAgentMentions(
  content: string,
  availableAgents: Agent[],
  currentAgentId?: string
): Agent[] {
  if (!content || !availableAgents || availableAgents.length === 0) {
    return [];
  }

  // 若存在独立边界的 @all / @所有人 / @team，将候选范围除自己外的全部 Agent 纳入
  if (isAllMention(content)) {
    return availableAgents.filter((a) => a.id !== currentAgentId);
  }

  const lowerContent = content.toLowerCase();

  // 1. 为每个候选 Agent 收集所有合法的 @ 提及候选模式
  interface AgentPattern {
    pattern: string;
    agent: Agent;
  }

  const patterns: AgentPattern[] = [];

  for (const agent of availableAgents) {
    if (currentAgentId && agent.id === currentAgentId) {
      continue;
    }

    const candidateStrings: string[] = [];

    // 模式 A: 有效规范化 handle (如 @mycodex, @mycodex-02, @glmclaude-01)
    // 若 Agent 因改名残留了缺失后缀的旧 handle（如 GlmClaude-01 残留 @glmclaude），强制使用对齐后的规范化 handle
    const effectiveHandle = resolveEffectiveAgentHandle(agent);
    if (effectiveHandle) {
      candidateStrings.push(effectiveHandle.toLowerCase());

      // 若 handle 带有短横线，补充空格别名 (如 @shinobi-core -> @shinobi core)
      if (effectiveHandle.includes('-')) {
        candidateStrings.push(`@${effectiveHandle.replace(/^@/, '').replace(/-/g, ' ')}`.toLowerCase());
      }
    }

    // 模式 B: 显式 @name (如 @MyCodex, @GlmClaude-01, @架构师)
    const rawName = (agent.name || '').trim();
    if (rawName) {
      const nameWithAt = rawName.startsWith('@') ? rawName : `@${rawName}`;
      candidateStrings.push(nameWithAt.toLowerCase());

      // 若名称包含空格，补充短横线别名 (如 @Claude Code -> @claude-code)
      if (rawName.includes(' ')) {
        candidateStrings.push(`@${rawName.replace(/\s+/g, '-')}`.toLowerCase());
      }
    }

    // 去重并写入列表
    const uniquePatterns = Array.from(new Set(candidateStrings)).filter((p) => p.length > 1);
    for (const p of uniquePatterns) {
      patterns.push({ pattern: p, agent });
    }
  }

  // 2. 最长匹配优先：按模式长度降序排序，确保长 handle (@mycodex-02 / @mycodex-副本) 优先占用字符区间
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);

  // 3. 区间占用锁定与边界校验
  const claimedRanges: { start: number; end: number }[] = [];
  const matchedAgents: Agent[] = [];

  for (const { pattern, agent } of patterns) {
    let searchIndex = 0;

    while (searchIndex < lowerContent.length) {
      const matchIndex = lowerContent.indexOf(pattern, searchIndex);
      if (matchIndex === -1) {
        break;
      }

      const endIndex = matchIndex + pattern.length;

      // 检查前置边界：必须为字符串开头，或者前一个字符不是标识符字符 [a-zA-Z0-9_\-]
      const isStartValid = matchIndex === 0 || !IDENTIFIER_CHAR_REGEX.test(lowerContent[matchIndex - 1]);

      // 检查后置边界：必须为字符串末尾，或者下一个字符不是标识符字符 [a-zA-Z0-9_\-]
      const nextChar = lowerContent[endIndex];
      let isEndValid = nextChar === undefined || !IDENTIFIER_CHAR_REGEX.test(nextChar);

      // 特殊情况：如果下一个字符是 . 或 /，且紧随其后依然是字母数字 (例如 @mycodex.com 或 @mycodex/repo)，属于域名/路径，非合法提及
      if (
        isEndValid &&
        (nextChar === '.' || nextChar === '/') &&
        endIndex + 1 < lowerContent.length &&
        /[a-zA-Z0-9]/.test(lowerContent[endIndex + 1])
      ) {
        isEndValid = false;
      }

      // 检查是否与已被更长模式占用的区间冲突
      const isOverlapping = claimedRanges.some(
        (range) => Math.max(range.start, matchIndex) < Math.min(range.end, endIndex)
      );

      if (isStartValid && isEndValid && !isOverlapping) {
        claimedRanges.push({ start: matchIndex, end: endIndex });
        if (!matchedAgents.some((m) => m.id === agent.id)) {
          matchedAgents.push(agent);
        }
      }

      searchIndex = matchIndex + 1;
    }
  }

  return matchedAgents;
}

export interface LoopGuardResult {
  allowed: boolean;
  reason?: string;
  isSilentEnd?: boolean;
}

/**
 * 协同防护检查 (对标 Buzz 静默收敛哲学)：
 * 1. 废除生硬的低轮次回环熔断 (原 currentCount >= 2 导致多 Agent 正常辩论在第 3-4 步被强行掐断并弹刺眼卡片)；
 * 2. 达到深度或频次安全兜底上限时，采用静默收敛 (isSilentEnd: true)，静悄悄终止级联，不向用户投递刺眼的熔断警报卡片；
 * 3. 唯有人工显式中止时才显式标记并通知。
 */
export function checkLoopGuard(
  cascade: CollaborationCascade,
  targetAgentId: string
): LoopGuardResult {
  if (cascade.isAborted) {
    return { allowed: false, reason: '用户已手动终止多智能体协同', isSilentEnd: false };
  }

  // 1. 深度安全兜底 (Max Depth Invisible Backstop - 对标 Buzz 设计，静默兜底)
  if (cascade.depth >= cascade.maxDepth) {
    return {
      allowed: false,
      reason: `多智能体协同已达安全轮次兜底上限 (${cascade.maxDepth} 轮)，静默收敛`,
      isSilentEnd: true,
    };
  }

  // 2. 异常失控循环兜底 (单链内单 Agent 调用达到 8 次以上的极端异常兜底)
  const currentCount = cascade.agentCallCounts[targetAgentId] || 0;
  if (currentCount >= 8) {
    return {
      allowed: false,
      reason: `目标 Agent 在本轮链条中已响应 ${currentCount} 次，触发极端异常兜底`,
      isSilentEnd: true,
    };
  }

  return { allowed: true };
}

/**
 * 为任意提示词注入当前频道团队花名册与协同召唤指南
 * 注入【Shadow Crew 平台协同公约 (对标 Buzz 真实增量价值与静默收敛哲学)】：
 * 1. 明确告知 Agent 由宿主调度器负责消息路由与级联分发
 * 2. 严禁且无需在本地运行工具搜索其它 Agent
 * 3. 真实增量价值准则：唯有产生漏洞纠错、架构减法或实施落地才发言接力，严禁虚假增量（自造框架/玩弄术语）
 * 4. 做减法即是增量 · 静默即成功：共识达成时直接输出方案，严禁 @ 任何成员，自然结题
 * 5. 严禁裸确认：禁止「收到/已对齐」等无意义社交客套
 * 6. 严禁复读流程元话语：正文纯净，严禁出现调度器流程控制黑话
 */
export function buildCrewRosterGuidance(
  availableAgents: Agent[],
  currentAgentId?: string
): string {
  const peers = availableAgents.filter((a) => a.id !== currentAgentId);
  const hasPeers = peers.length > 0;

  const peerList = hasPeers
    ? peers
        .map((p) => `• ${resolveEffectiveAgentHandle(p)} (${p.name} · ${p.role}): ${p.description ? p.description : '团队协同专家'}`)
        .join('\n')
    : '• (当前频道/会话中暂无其他协作 Agent。本轮推演由你独立完成，无需且严禁 @ 任何未列出的外部成员)';

  const exampleHandle = hasPeers ? resolveEffectiveAgentHandle(peers[0]) : '@agent';

  const collaborationDirective = hasPeers
    ? `3. 【频道内 @ 协同接力】：若你需要向当前频道内的其他成员协作推演、请求代码审查或分工，**只需在你的回复文本中自然写出对方的 @handle**（例如「${exampleHandle} 请对此方案进行底层安全性与并发审查...」）。注意：**你只能 @ 上方【可用协同团队成员列表】中明确列出的当前频道成员，严禁 @ 任何未列出的外部 Agent**。平台的级联调度器会在你回复后自动提取有效 @ 并接力投递给目标成员！\n` +
      `4. 【真实工程增量准则 (Real Engineering Delta Only)】：\n` +
      `   • 真正的高价值技术增量仅包括以下四类：\n` +
      `     ① 发现漏洞与边界失效工况（明确指出在何种并发、故障或边界数据下前人方案会崩溃/失真）；\n` +
      `     ② 架构减法与简化（明确指出前人方案哪些层级是过度设计，如何用更少代码、更简单机制达成相同目标）；\n` +
      `     ③ 可量化的权衡决策（明确指出“选择 A 需承受什么具体成本，选择 B 放弃什么”）；\n` +
      `     ④ 具体实施细节（给出可落地的接口契约、配置示例、代码 Patch 或检验测试用例）。\n` +
      `   • 严禁虚假增量（Negative Deltas）：严禁通过重新分类、玩弄生僻术语、发明未经行业公认的新理论/新多层模型来伪造增量！\n` +
      `5. 【做减法即是增量 · 达成共识自然收敛 (Silence as Success)】：如果你认同前序方案且无硬伤漏洞可挑，或者方案已足够完备，**直接给出你的最终落地总结与行动建议，切勿在正文中 @ 任何成员**。不要为了“证明自己有思考”而硬塞新概念，回复中不含任何成员的 @handle 即代表协同圆满收敛交付！\n` +
      `6. 【严禁裸确认与客套回复 (No Bare Acks)】：严禁发送纯粹的礼貌性确认、赞同或声明自己不再回复的内容（如「收到」、「已对齐」、「完全赞同，我不再回复」、「${exampleHandle} 已知悉」等）。任何不含实质内容的回复都会再次唤醒其他 Agent 造成无效震荡。\n` +
      `7. 【叙述性提及请勿加 @】：仅在真正需要对方介入推演时才使用 @handle。在叙述方案背景或引用他人观点时（例如「正如 ${peers[0]?.name || '专家'} 刚才所分析的架构」），请直接写成员姓名而**不要添加 @ 符号**，避免系统误触级联唤醒。\n` +
      `8. 【严禁在正文中复读流程元话语 (Anti-Meta-Talk)】：正文是直接面向人类用户与协作同伴的专业探讨，**严禁在正文中出现「第 N 轮接力」、「根据协同公约第 4 条」、「本轮无新增增量」、「静默收敛即成功」等任何系统调度器控制词汇**！\n\n`
    : `3. 【独立推演原则】：当前频道仅有你一名 Agent 在线。你应当独立完成本次任务推演与技术方案产出，**无需且严禁在回复中 @ 任何未加入当前频道的外部 Agent**。\n\n`;

  return (
    `\n\n[🛡️ Shadow Crew 平台智能体协同公约 (Agent Collaboration Directive)]:\n` +
    `1. 【多智能体中枢调度】：本工作区具备多智能体级联调度能力。团队成员属于独立的 Agent 进程或远程端点，由平台（Shadow Crew）统一接管消息分发与级联路由。\n` +
    `2. 【严禁本地工具搜查】：你**无需且绝对不要**在自身本地环境中使用 tools（如 sessions_list, conversations_list, openclaw agents list, bash grep/find 等）去排查、寻找或建立与其他 Agent 的私有连接。这会导致严重超时与资源浪费。\n` +
    collaborationDirective +
    `[👥 可用协同团队成员列表]:\n` +
    peerList
  );
}

/**
 * 构造 Agent 自身第一人称专属专精人设 (Agent Persona & System Instruction)
 * 深度绑定 agent.name, agent.role, agent.description
 * 确立 description 为最高能力契约与职责边界，引入费曼沟通法则与双轨表达 (BLUF 结论先行)
 */
export function buildAgentPersonaPrompt(agent: Agent): string {
  const roleTitle = agent.role?.trim() || '技术专家 / 架构师';
  const descText = agent.description?.trim()
    ? agent.description.trim()
    : '协助团队与开发者进行深度技术推演、方案论证与工程实现。';

  return (
    `[🤖 智能体专属专精人设与认知规范 (Agent Identity & System Instruction)]:\n` +
    `• 你的代号与称呼：${agent.name} (${resolveEffectiveAgentHandle(agent)})\n` +
    `• 核心专业角色：${roleTitle}\n` +
    `• 核心专长描述与职责边界 (Competency & Boundary Contract · 最高行为依归):\n` +
    `${descText}\n\n` +
    `【行为准则、表达哲学与输出风格硬性约束】:\n` +
    `1. 【职责锚定与严禁越界 (Scope Guard)】：上方【核心专长描述与职责边界】是你在团队中的唯一立足根本与审查边界！你必须且仅基于该专精领域进行深度推演和审查；严禁脱离上述专长越界空谈不相关的宏大架构，严禁借通用角色（如 ${roleTitle}）脱离专长描述泛泛而谈；\n` +
    `2. 【费曼沟通法则与讲人话 (Feynman Principle)】：顶尖架构师的真正水准体现在“把极其复杂的底层逻辑讲得极简清晰”。你的底层知识库是你的思考底色，但在向团队陈述时，严禁生硬堆砌生僻术语。遇到专业机制，必须用“通俗大白话/形象类比 + 直白因果”拆解其作用与代价；\n` +
    `3. 【结论先行，受众友好 (BLUF)】：每次陈词前必须在置顶处给出【💡 核心结论 (通俗版)】（用 2~3 句话说明“做不做、怎么做、最直接的好处/代价是什么”，确保使用者能直接听懂），随后再展开必要的技术推演；\n` +
    `4. 【拒绝伪框架 (Anti-Over-modeling)】：严禁为了证明专业度而凭空发明新理论、新层级机制（如自造 N 层模型、N 步判据）或晦涩缩写。直接谈具体选型、具体边界、具体风险与代码/配置方案；\n` +
    `5. 【清晰句法硬约束】：多用短句和动宾结构，单句尽量控制在 30 字以内，杜绝嵌套式长难定语从句；禁止整段大面积加粗，加粗仅限核心关键词。`
  );
}

/**
 * 构造全会话场景统一的复合系统提示词 (Composite System Prompt)
 * 组合：Agent 自身人设 (Self Persona) + 可选的团队协同公约花名册 (Roster Guidance)
 */
export function buildCompositeSystemPrompt(options: {
  agent: Agent;
  availableAgents?: Agent[];
  includeRoster?: boolean;
}): string {
  const persona = buildAgentPersonaPrompt(options.agent);
  if (options.includeRoster && options.availableAgents && options.availableAgents.length > 0) {
    const roster = buildCrewRosterGuidance(options.availableAgents, options.agent.id);
    return `${persona}\n\n${roster}`;
  }
  return persona;
}

// 对标 Buzz: 别名导出为立足上下文 (Standing Context)
export const buildStandingContext = buildCrewRosterGuidance;

/**
 * 构造跨智能体协同接力的结构化提示词
 * 对标 Buzz 最佳实践：
 * 1. 专注纯净业务接力信息（发起人、原议题、前序结论、具体审查诉求）
 * 2. 坚决不复读 30 行系统级平台公约，避免上下文膨胀与指令稀释
 * 3. 仅附带单行轻量协同提示
 */
export interface TopicPromptContext {
  topicId: string;
  title: string;
  description?: string;
  channelName?: string;
  status?: string;
  discussionMode?: DiscussionMode;
  gameRoles?: GameRolesConfig;
  gameStage?: GameTheoreticStage;
  targetProposalText?: string;
  targetChallengeText?: string;
  targetVerificationText?: string;
  targetDefenseText?: string;
  modularState?: ModularOrchestrationState;
  participatingAgents?: Agent[];
  recentHistory?: Array<{ author: string; content: string; isAgent?: boolean }>;
}

/**
 * G-Frame 微观团队博弈 (Team Game) 模块级上下文物理隔离编译器
 * 仅注入只读《公共接口契约》、上游已冻结模块摘要与当前 activeModule 的单一职责和 allowedFiles 白名单，
 * 物理屏蔽其他未相关模块的讨论上下文，压制条件信息熵与 KL 散度。
 */
export function buildScopedModulePrompt(options: {
  activeModule: TaskModuleSlice;
  sharedContract?: SharedInterfaceContract;
  allModules?: TaskModuleSlice[];
}): string {
  const { activeModule, sharedContract, allModules = [] } = options;

  const signatureSection =
    sharedContract?.typeSignatures && sharedContract.typeSignatures.trim().length > 0
      ? `\n• 共享契约签名/协议定义:\n\`\`\`\n${sharedContract.typeSignatures}\n\`\`\``
      : '';

  const contractBlock = sharedContract
    ? `【🧭 跨模块只读公共契约 (Shared Contract · 严禁私自篡改)】:
• 契约摘要: ${sharedContract.summary}${signatureSection}
• 全局不变量约束:
${sharedContract.invariants.map((inv, idx) => `  ${idx + 1}. ${inv}`).join('\n')}\n`
    : '';

  const upstreamFrozenModules = allModules.filter(
    (m) =>
      activeModule.dependsOnModuleIds.includes(m.moduleId) &&
      m.status === 'frozen'
  );

  const upstreamBlock =
    upstreamFrozenModules.length > 0
      ? `\n【🔒 上游已冻结模块结论摘要 (Read-Only Frozen Dependencies)】:\n${upstreamFrozenModules
          .map(
            (m) =>
              `• [${m.title}]: ${(m.frozenProposalSnippet || m.responsibility).slice(0, 160)}`
          )
          .join('\n')}\n`
      : '';

  const otherModulesExcluded = allModules
    .filter((m) => m.moduleId !== activeModule.moduleId)
    .map((m) => m.title)
    .join('、');

  const scopeFilesLine =
    activeModule.allowedFiles && activeModule.allowedFiles.length > 0
      ? `• 关联文件/产物白名单 (allowedFiles): ${activeModule.allowedFiles.join(', ')}\n`
      : '';

  return `\n[🧩 G-Frame 模块化上下文物理隔离沙箱 (Scoped Module Sandbox)]
${contractBlock}${upstreamBlock}【📦 当前聚焦模块沙箱】: ${activeModule.title} (${activeModule.moduleId})
• 单一模块职责: ${activeModule.responsibility}
${scopeFilesLine}• 贝叶斯风险信念: P_prior=${activeModule.belief.priorRisk} → P_posterior=${activeModule.belief.posteriorRisk} (路由模式: ${activeModule.belief.routingMode === 'fast_track' ? '⚡ 快速验证流' : '⚔️ 深度红队对抗流'})
• 【上下文物理隔离铁律 (Entropy & KL-Divergence Control)】:
  1. 你当前处于模块「${activeModule.title}」的独立隔离沙箱中，只需专注解决本模块的单一职责；
  2. 严禁越界展开或篡改其他模块（${otherModulesExcluded || '非本模块'}）的专属职责与受保护范畴；
  3. 跨模块协同必须 100% 遵循上方《公共契约》中的共识与不变量。`;
}

/**
 * 获取 Agent 在 CognoNexus 博弈模式中的角色定位 (4类核心智能体角色)
 */
export function getAgentGameRole(agentId: string, gameRoles?: GameRolesConfig): GameRoleType | null {
  if (!gameRoles) return null;
  if ((gameRoles.proposers || []).includes(agentId)) return 'proposer';
  if ((gameRoles.challengers || []).includes(agentId)) return 'challenger';
  if ((gameRoles.verifiers || []).includes(agentId)) return 'verifier';
  if ((gameRoles.arbiters || []).includes(agentId)) return 'arbiter';
  return null;
}

/**
 * 构造议题（Topic Thread）开题与讨论推演的统一结构化提示词
 * 确保即使在各自独立的 Session 中，Agent 也能完整获取议题标题、目标背景与前序讨论脉络
 */
export function buildTopicPrompt(options: {
  topic: TopicPromptContext;
  userContent: string;
  targetAgent: Agent;
  availableAgents: Agent[];
}): string {
  const { topic, userContent, targetAgent, availableAgents } = options;

  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerList = peers.length > 0
    ? peers.map((p) => `${p.handle} (${p.name} · ${p.role})`).join('、')
    : '(当前仅你独立在线)';

  let historySection = '';
  if (topic.recentHistory && topic.recentHistory.length > 0) {
    const formattedHistory = topic.recentHistory
      .map((h) => {
        const preview = h.content.length > 300 ? `${h.content.slice(0, 300)}...` : h.content;
        return `• [${h.author}]: ${preview}`;
      })
      .join('\n');
    historySection = `\n【议题前序研讨脉络】:\n${formattedHistory}\n`;
  }

  const topicDesc = topic.description?.trim()
    ? topic.description.trim()
    : '（创建者未填写额外背景说明，请紧密围绕议题标题进行深度方案推演）';

  const activeModule =
    topic.modularState?.enabled && topic.modularState.activeModuleId
      ? topic.modularState.modules.find(
          (m) => m.moduleId === topic.modularState?.activeModuleId
        )
      : undefined;

  const scopedModuleDirective = activeModule
    ? buildScopedModulePrompt({
        activeModule,
        sharedContract: topic.modularState?.sharedContract,
        allModules: topic.modularState?.modules,
      })
    : '';

  let gameModeDirective = '';
  if (topic.discussionMode === 'game_theoretic' && topic.gameRoles) {
    const role = getAgentGameRole(targetAgent.id, topic.gameRoles);
    const stage = topic.gameStage || (role === 'proposer' ? 'proposal' : role === 'challenger' ? 'challenge' : role === 'verifier' ? 'verification' : 'arbitration');

    const verificationSection = topic.targetVerificationText
      ? `\n\n【🔍 接地验证实证检验结论 (Grounding Truth)】:\n<<<GROUNDING_VERIFICATION_START>>>\n${topic.targetVerificationText}\n<<<GROUNDING_VERIFICATION_END>>>`
      : '';

    if (role === 'proposer') {
      if (stage === 'decomposition') {
        gameModeDirective = `\n\n【博弈编排 - 🧭 阶段 0: G-Frame 模块拓扑拆解与公共契约锚定 (Decomposition)】:
你是本议题的提案构想者 (Proposer)。为压制长链生成的信息熵与 KL 散度，请根据本议题的实际领域属性（无论是业务战略、产品规划、流程风控还是软件研发），将任务拆解为 2~4 个职责单一、正交隔离的原子模块，并锁定跨模块只读《公共契约》。
优先调用宿主 \`submit_module_decomposition\` 工具，或在回复末尾附带结构化拆解块（若为非代码类业务讨论，\`type_signatures\` 可留空 \`""\`，\`allowed_files\` 可留空 \`[]\`）：
<<<MODULE_DECOMPOSITION>>>
{
  "shared_contract": {
    "summary": "跨模块目标边界与核心假设简述",
    "type_signatures": "",
    "invariants": ["各模块严禁越界偏离单一职责或违背全局前置约束"]
  },
  "modules": [
    {
      "module_id": "mod-1",
      "title": "模块 1：核心子模块标题",
      "responsibility": "单一职责与边界说明",
      "allowed_files": [],
      "depends_on": [],
      "complexity_level": "low_deterministic"
    }
  ]
}
<<<MODULE_DECOMPOSITION_END>>>
无需在正文 @ 任何人。`;
      } else if (stage === 'defense') {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 4: 提案者答辩与防御修正 (Defense v2)】:
红队挑战者已对你的初始提案提出针对性反例与边界质询，且接地验证智能体已提供物理实证检验（见下方靶点数据）。
请针对挑战者指出的失效场景与接地检验结论做出正面答辩：
1. 事实澄清与评估：认可还是反驳挑战方的失效推演？指出其推演中的合理之处或边界误判；
2. 架构补丁与修正方案 (Patch v2)：若漏洞属实，提出具体的容灾、降级、锁机制或重构设计；
3. 性能/复杂度折中说明：补丁方案对原架构的延迟、吞吐与维护成本有何影响；
4. 交付准备：给出可供仲裁官定案评估的最终建议。
【防谄媚守则 (Anti-Sycophancy)】: 严禁无原则全盘顺从或空洞认错！你必须以客观工程事实、防御补丁（Patch）或架构权衡进行自洽答辩，杜绝“您说得对、全盘放弃原案”式的敷衍认输。
无需在正文 @ 任何人，平台状态机将自动汇总攻防论据并提交仲裁。

【红队反例质询 (攻击靶点)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '（详见前序讨论脉络中的挑战者发言）'}
<<<CHALLENGER_CRITIQUE_END>>>${verificationSection}`;
      } else {
        gameModeDirective = `\n\n【博弈编排 - 🏛️ 阶段 1: 提案智能体独立立论起草 (Proposer)】:
你是本议题的提案构想者 (Proposer)。请基于议题目标与需求，在独立沙箱中设计全局架构首选技术方案，明确关键选型、核心接口、组件拆分与设计假设。
注意：你的方案落库后将被平台直接递交至红队对抗智能体进行极限反例压测与反从众审查，请尽可能清晰完备地陈述方案逻辑与潜在风险边界。无需在正文 @ 任何人，平台状态机将自动递交方案。`;
      }
    } else if (role === 'challenger') {
      gameModeDirective = `\n\n【博弈编排 - ⚔️ 阶段 2: 红队对抗反例压测与反向质询 (Red Team)】:
你是本议题佩戴黑帽的红队对抗智能体 (Red Team / Challenger)。提案官已提交初始立论方案（见下方【攻击标的方案】）。
【作战守则】:
强制运行反从众批判模式，寻找隐藏假设漏洞、极端并发死锁、网络抖动失效场景或过度设计问题。严禁盲目附和与套话认同！
请必须遵循以下四部曲批判契约：
1. [质疑靶点]: 明确指出提案方案中的具体选型、代码设计或逻辑假设；
2. [失效反例]: 构造具体的极端工况、恶意并发、故障注入或边界数据场景；
3. [连锁反应]: 推演在此场景下系统为何崩溃、数据如何失真；
4. [防御检验]: 要求提案官提供补丁防御设计或实证说明。
无需在正文 @ 任何人，平台将自动流转至接地验证/抗辩阶段。

【被质询提案方案 (攻击标的)】:
<<<PROPOSER_SOLUTION_START>>>
${topic.targetProposalText || '（暂未提取到前序提案方案，请围绕前序讨论脉络展开边界质询）'}
<<<PROPOSER_SOLUTION_END>>>`;
    } else if (role === 'verifier') {
      gameModeDirective = `\n\n【博弈编排 - 🔍 阶段 3: 接地实证与反事实检验 (Grounding Verifier)】:
你是本议题客观物理世界与事实逻辑的接地验证智能体 (Grounding Verifier)。
【守则与职责】:
1. 坚决不参与任何主观文本辩论与空洞口水战！
2. 你的唯一任务是对红队提出的极端失效反例与提案方案的前提假设，执行确定性的反事实与实证逻辑检验；
3. 给出具体的工具调用执行记录（如：ast_grep, static_analyzer, rag_search 或 code_sandbox）；
4. 输出确定性结论：该反例工况在真实代码/系统环境下究竟是否成立 (PASS / FAIL / 证实 / 证伪)；
5. 【必须输出结构化实证结果】：在陈词结尾附带标准 JSON 证据块：
\`\`\`json
{
  "evidences": [
    {
      "sourceTool": "ast_grep",
      "inputQueryOrCode": "具体的检验代码、查询命令或测试用例",
      "rawOutput": "执行输出摘要或观测结果",
      "truthValue": true,
      "confidence": 0.9,
      "verifierReport": "精炼客观的实证推演结论"
    }
  ]
}
\`\`\`
无需在正文 @ 任何人。

【待验证提案方案】:
<<<PROPOSER_SOLUTION_START>>>
${topic.targetProposalText || '详见前序脉络'}
<<<PROPOSER_SOLUTION_END>>>

【红队指出的失效反例争议切片】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '详见前序脉络'}
<<<CHALLENGER_CRITIQUE_END>>>`;
    } else if (role === 'arbiter') {
      const defenseSection = topic.targetDefenseText
        ? `\n\n【提案方防御答辩与架构补丁 (Defense v2)】:\n<<<PROPOSER_DEFENSE_START>>>\n${topic.targetDefenseText}\n<<<PROPOSER_DEFENSE_END>>>`
        : '';

      gameModeDirective = `\n\n【博弈编排 - ⚖️ 阶段 5: 中立综合协调与权衡决策 (Synthesizer / Arbiter)】:
你是本议题的中立流程综合官与决策协调者 (Synthesizer / Arbiter)。提案方案、红队反例、接地实证及答辩补丁已进入终局仲裁。
【仲裁守则与交付契约】:
保持客观中立，依据可行性、健壮性与 ROI：
1. 【💡 通俗定案置顶 (Executive Summary)】：回复首段必须先用 2~3 句话以大白话给出《终局裁决核心摘要》（明确“采纳哪套方案、核心依据是什么、承受了何种折中代价”），确保非技术决策者一眼看懂；
2. 梳理双方分歧焦点与核心论据，拒绝空泛套话与过度抽象的伪理论，紧扣具体代码/配置工程实际；
3. 全面审视红队的反例质疑、接地验证智能体的物理实证报告以及提案官的防御修正/补丁方案；
4. 提炼客观的《架构决策权衡矩阵 (Trade-off Matrix)》；
5. 【结构化裁决书交付 (直通宿主 ADR 画布与仲裁法槌)】：
   优先调用宿主 \`submit_arbitration_ruling\` 工具；或在回复末尾附带标准裁决草案块：
<<<RULING_DRAFT>>>
{
  "decision_type": "adopt_proposer", // "adopt_proposer" | "reject_rebuild" | "trade_off_matrix"
  "summary": "简明定案陈词与核心决策动因",
  "trade_off_points": [
    "优先保障... (权重 ...)，适度折中...",
    "建立...机制防范红队提出的边界缺陷"
  ],
  "impacted_files": ["src/..."],
  "solution": "落地工程实施或架构补丁要求"
}
<<<RULING_DRAFT_END>>>
无需在正文 @ 任何人。

【立论方案 (Proposal v1)】:
<<<PROPOSER_PROPOSAL_START>>>
${topic.targetProposalText || '详见前序脉络'}
<<<PROPOSER_PROPOSAL_END>>>

【红队反例质询 (Red Team Challenge)】:
<<<CHALLENGER_CRITIQUE_START>>>
${topic.targetChallengeText || '详见前序脉络'}
<<<CHALLENGER_CRITIQUE_END>>>${verificationSection}${defenseSection}`;
    }
  }

  const roleDescriptionAddon = targetAgent.description?.trim()
    ? `\n【个人专精定位与知识设定】：\n${targetAgent.description.trim()}\n`
    : '';

  return `[📌 议题研讨推演任务 (Topic Discussion Context)]
【所属频道】: #${topic.channelName || '频道'}
【议题编号】: ${topic.topicId}
【议题模式】: ${topic.discussionMode === 'game_theoretic' ? '♟️ 博弈讨论模式 (三元制衡：主导/挑战/仲裁)' : '标准研讨模式'}
【议题标题】: ${topic.title}
【议题背景与需求目标】:
${topicDesc}
【参与研讨成员】: ${peerList}
${scopedModuleDirective}${historySection}
【用户开题 / 本轮诉求指令】:
"${userContent}"
${gameModeDirective}

请恪守你的专精定位【${targetAgent.name} (${targetAgent.handle}) · ${targetAgent.role}】${roleDescriptionAddon}针对上述议题目标与用户诉求展开技术推演与方案陈述：首段先给出 2 句话通俗结论，遵循费曼表达法则，多用短句并直指落地实现。`;
}

export interface BuildCascadePromptOptions {
  targetAgent: Agent;
  invokingAgent: Agent;
  originalUserPrompt: string;
  invokingAgentReply: string;
  cascade: CollaborationCascade;
  availableAgents: Agent[];
  topic?: TopicPromptContext;
  isQueuedByUserInput?: boolean;
}

/**
 * 构造跨智能体协同接力的结构化提示词
 * 对标 Buzz 最佳实践：
 * 1. 专注纯净业务接力信息（发起人、原议题、前序结论、具体审查诉求）
 * 2. 坚决不复读 30 行系统级平台公约，避免上下文膨胀与指令稀释
 * 3. 支持议题元数据带入与用户排队 @all / 串行接力语义区分
 */
export function buildCascadePrompt(options: BuildCascadePromptOptions): string {
  const {
    targetAgent,
    invokingAgent,
    originalUserPrompt,
    invokingAgentReply,
    cascade,
    availableAgents,
    topic,
    isQueuedByUserInput = false,
  } = options;

  const currentHop = cascade.depth + 1;
  const isGameTheoretic = topic?.discussionMode === 'game_theoretic';
  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerList =
    peers.length > 0
      ? (isGameTheoretic
          ? `\n\n[💡 博弈编排协议：当前议题处于主导-挑战-仲裁三元制衡流转中，方案提交后平台协调器将自动按协议推动下一阶段，无需在正文手动 @ 任何人]`
          : `\n\n[💡 协同收敛指引：若完成本轮推演/审查后方案已成熟收敛或各方达成共识，请直接给出最终落地结论，**切勿 @ 任何人**（没有 @ 即代表协同圆满收敛完成）；若确实需要其他特定专家继续提供不可或缺的实质性增量，可精准 @ 对应成员：${peers.map((p) => p.handle).join(', ')}]`)
      : '';

  const topicHeader = topic
    ? `【所属议题】: 【${topic.title}】 (ID: ${topic.topicId})\n【议题模式】: ${topic.discussionMode === 'game_theoretic' ? '♟️ 博弈讨论模式' : '标准研讨模式'}\n【议题背景与目标】:\n${topic.description?.trim() || topic.title}\n\n`
    : '';

  let gameRoleAddon = '';
  if (topic?.discussionMode === 'game_theoretic' && topic.gameRoles) {
    const role = getAgentGameRole(targetAgent.id, topic.gameRoles);
    if (role === 'proposer') {
      gameRoleAddon = `\n【你的博弈定位】: 🏛️ 提案官 (Proposer)。请主导技术方案的架构设计与关键路径，并就挑战者提出的质疑进行技术抗辩与落地修正。无需手动 @，平台将自动流转。`;
    } else if (role === 'challenger') {
      gameRoleAddon = `\n【你的博弈定位】: ⚔️ 红队对抗 / 挑战官 (Challenger)。请执行反从众对抗性挑错，寻找极端边界缺陷与隐藏风险，拒绝盲目认同。无需手动 @，平台将自动流转。`;
    } else if (role === 'arbiter') {
      gameRoleAddon = `\n【你的博弈定位】: ⚖️ 流程综合官 (Synthesizer / Arbiter)。请综合提案、红队与答辩三方论据，提炼权衡矩阵，提供公正客观的仲裁裁决建议。无需手动 @。`;
    }
  }

  // 区分：是由前序 Agent 显式点名请求代码审查，还是由用户 @all / 批量点名排队顺延陈述
  const conclusionTip = isGameTheoretic
    ? '若当前阶段方案或反例已输出完毕，直接输出专业分析（平台协调器将按协议自动推动下一阶段，无需手动 @）'
    : '若方案已完备或形成最终共识，直接给出落地实施步骤（切勿 @ 任何人，以使协同自然交付结题）；仅在确实需要特定成员接力时才 @ 对应成员';

  const requestSection = isQueuedByUserInput
    ? `【多智能体协同陈述 (用户排队协作)】:
用户在上述讨论中同时指派了多位成员共同陈述观点。
前序成员 (${invokingAgent.name}) 已完成其视角阐述（见上方结论）。现请基于你的专属专精职责（见系统认知设定）：${gameRoleAddon}
1. 【💡 通俗结论置顶】：首段必须先用 2 句话以大白话给出你的核心判断与方案态度，确保非技术使用者一眼看懂；
2. 【恪守专精边界】：严格立足你的专精能力范围提供审查或架构减法；严禁脱离专长越界空谈宏大架构，严禁为了发言而自创未经行业公认的新理论、新层级模型或堆砌生僻黑话；严禁纯客套的裸确认；
3. ${conclusionTip}；
4. 【杜绝流程黑话】：正文面向人类与同伴，严禁出现“第 N 轮接力”、“协同收敛协议”等调度控制词汇。`
    : `【对你的协作诉求】:
${invokingAgent.name} 在上述方案中点名了你 (${targetAgent.handle}) 请求技术审查与协作。
现请基于你的专属专精职责（见系统认知设定）：${gameRoleAddon}
1. 【💡 通俗结论置顶】：首段必须先用 2 句话以大白话说明你的审查结论与方案态度，确保非技术使用者一眼看懂；
2. 【针对性审查与减法】：严格立足你的专精能力指出潜在失效漏洞、边界风险或提出架构减法；严禁自造抽象框架或堆砌黑话；严禁仅做「收到/已对齐」的裸确认；
3. ${conclusionTip}；
4. 【杜绝流程黑话】：正文面向人类与同伴，严禁出现“第 N 轮接力”、“协同收敛”等调度控制词汇。`;

  return `[🤝 团队协同协作请求 (第 ${currentHop}/${cascade.maxDepth} 轮接力)]

${topicHeader}【发起协同者】: ${invokingAgent.handle} (${invokingAgent.name} · ${invokingAgent.role})
【原始用户议题/需求】:
"${originalUserPrompt}"

【前序推演方案与结论】(由 ${invokingAgent.name} 产出):
"""
${invokingAgentReply}
"""

${requestSection}${peerList}`;
}

/**
 * ---------------------------------------------------------------------------
 * Buzz 范式普通模式优化：语义边界包裹 (Semantic Framing) + 水位线增量冲刷 (Delta FlushBatch)
 * + 轮次同步屏障与提及去重合并 (Turn Barrier & Mention Deduplication)
 * 对标 crates/buzz-acp/src/{prompt_framing.rs, queue.rs, scope.rs}
 * ---------------------------------------------------------------------------
 */

/**
 * 单次增量批次冲刷的最大事件数上限 (对标 Buzz queue.rs MAX_BATCH_EVENTS = 50)
 */
export const MAX_DELTA_BATCH_EVENTS = 50;

/**
 * 转义嵌入在语义标签内部的非受信文本，防止消息正文中的 `</delta-events>` 或 `<system>` 破坏提示词语义边界
 * (对标 Buzz prompt_framing.rs::escape_semantic_text)
 */
export function escapeSemanticText(value: string): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 使用成对的显式 XML 语义边界包裹上下文片段，属性值自动转义，正文保持原样或由调用方按需转义
 * (对标 Buzz prompt_framing.rs::semantic_section_with_attributes)
 */
export function wrapSemanticSection(
  tag: string,
  content: string,
  attributes?: Record<string, string | number | undefined>
): string {
  const attrStr = attributes
    ? Object.entries(attributes)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => ` ${k}="${escapeSemanticText(String(v)).replace(/"/g, '&quot;')}"`)
        .join('')
    : '';
  return `<${tag}${attrStr}>\n${content}\n</${tag}>`;
}

/**
 * 房间/线程消息轻量投影项（用于计算每个 (roomId, agentId) 的未读增量批次）
 */
export interface RoomTranscriptEntry {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle?: string;
  content: string;
  isAgent?: boolean;
  timestamp?: string;
  isPending?: boolean;
  agentBadge?: string;
  kind?: MessageKind;
}

export interface DeltaBatchResult {
  /** 自上次水位线以来该 Agent 尚未读取的新增消息批次 */
  deltaMessages: RoomTranscriptEntry[];
  /** 本次提取时刻房间内最新一条有效消息的 ID（用于更新该 Agent 的水位线） */
  latestWatermarkMessageId?: string;
  /** 该 Agent 在当前会话 Scope 是否已完成首次冷启动（存在历史水位线即为热会话） */
  isWarmSession: boolean;
}

/**
 * 判断一条房间消息是否为平台守卫/熔断等系统控制卡片（不应作为业务上下文注入给 Agent）
 */
function isSystemControlMessage(msg: RoomTranscriptEntry): boolean {
  // 1. 优先根据显式消息类型判断
  if (msg.kind === 'system_control' || msg.kind === 'guard' || msg.kind === 'rollup' || msg.kind === 'error') {
    return true;
  }
  if (msg.authorId === 'system') return true;
  if (msg.isPending) return true;
  if (!msg.content || !msg.content.trim()) return true;

  // 2. 兜底判断历史遗留或第三方未标明 kind 的系统卡片
  if (
    msg.agentBadge &&
    (msg.agentBadge.includes('Guard') ||
      msg.agentBadge.includes('Communication Required') ||
      msg.agentBadge.includes('Circuit Breaker') ||
      msg.agentBadge === 'System')
  ) {
    return true;
  }
  return false;
}

/**
 * 将当前轮次刚产出的触发消息/并发回复按 ID 幂等合并进房间消息快照中
 *
 * 解决核心竞态问题：
 * 在 React 18/19 自动批处理 (Automatic Batching) 下，当上一跳的完成回调紧挨着 `setActiveExecutions` 调用 `setMessages(prev => ...)` 时，
 * React 会将 `setMessages` 的 updater 推迟到下一帧渲染阶段执行，而 `Promise.allSettled` 微任务会在此之前立即唤醒下一跳。
 * 通过在提取 `<delta-events>` 前显式将本轮触发消息 (`triggerMessages`) 与本轮 Agent 产出 (`turnOutputs`) 幂等合并入快照，
 * 确保被点名的下一跳 Agent 100% 能够读到刚刚触发它的那条消息，且水位线 (`latestWatermarkMessageId`) 同步推进到该触发消息。
 */
export function mergeTurnOutputsIntoTranscript(
  messages: RoomTranscriptEntry[],
  turnOutputs?: TurnAgentOutput[],
  triggerMessages?: RoomTranscriptEntry[]
): RoomTranscriptEntry[] {
  const base = (messages || []).map((m) => ({ ...m }));
  const indexById = new Map<string, number>();
  base.forEach((m, idx) => {
    indexById.set(m.id, idx);
  });

  if (triggerMessages && triggerMessages.length > 0) {
    for (const trig of triggerMessages) {
      if (!trig || !trig.id || !trig.content?.trim()) continue;
      const existingIdx = indexById.get(trig.id);
      if (existingIdx !== undefined) {
        if (base[existingIdx].isPending || !base[existingIdx].content?.trim()) {
          base[existingIdx] = { ...base[existingIdx], ...trig, isPending: false };
        }
      } else {
        indexById.set(trig.id, base.length);
        base.push({ ...trig, isPending: false });
      }
    }
  }

  if (turnOutputs && turnOutputs.length > 0) {
    for (const out of turnOutputs) {
      if (!out || !out.messageId || !out.replyContent?.trim()) continue;
      const entry: RoomTranscriptEntry = {
        id: out.messageId,
        authorId: out.agent.id,
        authorName: out.agent.name,
        authorHandle: out.agent.handle,
        content: out.replyContent,
        isAgent: true,
        isPending: false,
      };
      const existingIdx = indexById.get(out.messageId);
      if (existingIdx !== undefined) {
        if (base[existingIdx].isPending || !base[existingIdx].content?.trim()) {
          base[existingIdx] = { ...base[existingIdx], ...entry };
        }
      } else {
        indexById.set(out.messageId, base.length);
        base.push(entry);
      }
    }
  }

  return base;
}

/**
 * 基于 `(roomId, agentId)` 水位线提取未读增量事件批次 (对标 Buzz EventQueue::flush)
 *
 * 核心不变量：
 * 1. 水位线 `lastWatermarkMessageId` 记录的是「上一次向该 Agent 派发 Prompt 时，房间内最后一条有效消息的 ID」；
 * 2. 即使首轮多个 Agent 并发执行、各自回复以任意乱序落库，下一轮唤醒某 Agent 时，
 *    只要从其上次派发水位线 `lastWatermarkMessageId` 往后切片，并排除该 Agent 自己产出的消息 (`excludeAuthorId`)，
 *    就能 100% 精确捕获并发期间其他所有同事产出的回复，绝不漏读、绝不重复投递！
 * 3. 若传入 `turnOutputs` 或 `triggerMessages`，会在切片前先按消息 ID 去重合并进快照，杜绝异步状态尚未落库导致漏读触发消息。
 */
export function extractUnreadDeltaMessages(options: {
  messages: RoomTranscriptEntry[];
  /** 本轮刚刚完成并触发下一跳的 Agent 回复列表（防御 React 异步批处理导致 messagesRef 尚未落盘的竞态） */
  turnOutputs?: TurnAgentOutput[];
  /** 显式触发本次派发的消息列表（如首轮用户刚发送的消息） */
  triggerMessages?: RoomTranscriptEntry[];
  lastWatermarkMessageId?: string;
  /** 冷启动（尚无水位线）时的起始锚点消息 ID（包含该条消息），防止把频道内数天前已完结的历史讨论一股脑灌入新会话 */
  coldStartSinceMessageId?: string;
  excludeAuthorId?: string;
  maxBatchEvents?: number;
}): DeltaBatchResult {
  const {
    messages,
    turnOutputs,
    triggerMessages,
    lastWatermarkMessageId,
    coldStartSinceMessageId,
    excludeAuthorId,
    maxBatchEvents = MAX_DELTA_BATCH_EVENTS,
  } = options;

  const mergedMessages = mergeTurnOutputsIntoTranscript(messages, turnOutputs, triggerMessages);
  const validMessages = mergedMessages.filter((m) => !isSystemControlMessage(m));
  const latestWatermarkMessageId =
    validMessages.length > 0 ? validMessages[validMessages.length - 1].id : lastWatermarkMessageId;

  let watermarkIndex = -1;
  if (lastWatermarkMessageId) {
    watermarkIndex = validMessages.findIndex((m) => m.id === lastWatermarkMessageId);
  }

  const isWarmSession = Boolean(lastWatermarkMessageId && watermarkIndex !== -1);
  let unreadSlice: RoomTranscriptEntry[];
  if (watermarkIndex !== -1) {
    unreadSlice = validMessages.slice(watermarkIndex + 1);
  } else if (coldStartSinceMessageId) {
    const anchorIdx = validMessages.findIndex((m) => m.id === coldStartSinceMessageId);
    unreadSlice = anchorIdx !== -1 ? validMessages.slice(anchorIdx) : validMessages;
  } else {
    unreadSlice = validMessages;
  }

  const filteredDelta = excludeAuthorId
    ? unreadSlice.filter((m) => m.authorId !== excludeAuthorId)
    : unreadSlice;

  const boundedDelta =
    filteredDelta.length > maxBatchEvents
      ? filteredDelta.slice(filteredDelta.length - maxBatchEvents)
      : filteredDelta;

  return {
    deltaMessages: boundedDelta,
    latestWatermarkMessageId,
    isWarmSession,
  };
}

export interface BuildNormalModeTurnPromptOptions {
  targetAgent: Agent;
  availableAgents: Agent[];
  roomId: string;
  isWarmSession: boolean;
  deltaMessages: RoomTranscriptEntry[];
  triggerContent?: string;
  hop?: number;
  maxHops?: number;
  invokingAgents?: Agent[];
  topic?: TopicPromptContext;
  isDm?: boolean;
  isParallelFirstTurn?: boolean;
}

/**
 * 格式化单条增量消息为紧凑语义行
 */
function formatDeltaEntryLine(entry: RoomTranscriptEntry): string {
  const handlePart = entry.authorHandle ? ` (${entry.authorHandle})` : '';
  const roleTag = entry.isAgent ? 'Agent' : 'User';
  const timePart = entry.timestamp ? ` @ ${entry.timestamp}` : '';
  return `[${roleTag}: ${entry.authorName}${handlePart}${timePart}]:\n${escapeSemanticText(entry.content.trim())}`;
}

/**
 * 构造普通模式（Channel 主时间轴 / Topic 标准研讨模式）下的精简增量提示词
 *
 * 对标 Buzz 架构优势：
 * 1. 【冷启动 (Cold Start, isWarmSession = false)】：
 *    首次进入当前会话 Scope 时，注入一次 `<topic-context>`（若为议题）及初始消息流，建立完整基线；
 * 2. 【热会话增量投递 (Warm Session Delta, isWarmSession = true)】：
 *    复用底层 ACP Session 已持有的上下文记忆，**彻底剔除重复的议题背景、原始问题复读与 15 行冗余指令模板**，
 *    仅投递 `<delta-events>` 未读增量消息批次 + 单行轻量收敛指引，大幅节省上下文窗口并最大化 Prefix KV Cache 命中率；
 * 3. 【首轮并行防风暴指引 (Parallel Fan-out Guard)】：
 *    当多位 Agent 在首轮并行发言时，提醒其独立亮明专业观点，避免盲目群发 @ 导致级联风暴。
 */
export function buildNormalModeTurnPrompt(options: BuildNormalModeTurnPromptOptions): string {
  const {
    targetAgent,
    availableAgents,
    roomId,
    isWarmSession,
    deltaMessages,
    triggerContent = '',
    hop = 1,
    maxHops = 12,
    invokingAgents = [],
    topic,
    isDm = false,
    isParallelFirstTurn = false,
  } = options;

  // 1. 私聊 (DM) 极简直通：若为热会话且存在多条未读增量则包裹 delta-events，否则直传最新消息
  if (isDm) {
    if (isWarmSession && deltaMessages.length > 1) {
      const body = deltaMessages.map(formatDeltaEntryLine).join('\n\n');
      return wrapSemanticSection('delta-events', body, {
        scope: roomId,
        count: deltaMessages.length,
      });
    }
    return triggerContent || deltaMessages[deltaMessages.length - 1]?.content || '';
  }

  const peers = availableAgents.filter((a) => a.id !== targetAgent.id);
  const peerHandles = peers.map((p) => resolveEffectiveAgentHandle(p)).join(', ');
  const targetEffectiveHandle = resolveEffectiveAgentHandle(targetAgent);

  const trimmedTrigger = triggerContent.trim();
  const hasTriggerInDelta =
    !trimmedTrigger || deltaMessages.some((m) => m.content.trim() === trimmedTrigger);

  const fallbackTriggerEntry: RoomTranscriptEntry | null =
    trimmedTrigger && !hasTriggerInDelta
      ? hop > 1 && invokingAgents.length > 0
        ? {
            id: 'trigger-inline-agent',
            authorId: invokingAgents[0].id,
            authorName: invokingAgents.map((a) => a.name).join(' & '),
            authorHandle: invokingAgents[0].handle,
            content: trimmedTrigger,
            isAgent: true,
          }
        : {
            id: 'trigger-inline-user',
            authorId: 'user',
            authorName: 'User',
            content: trimmedTrigger,
            isAgent: false,
          }
      : null;

  const effectiveEntries: RoomTranscriptEntry[] = fallbackTriggerEntry
    ? [...deltaMessages, fallbackTriggerEntry]
    : deltaMessages;

  const deltaBody = effectiveEntries.map(formatDeltaEntryLine).join('\n\n');
  const deltaSection = wrapSemanticSection('delta-events', deltaBody, {
    scope: roomId,
    hop,
    count: effectiveEntries.length,
  });

  // 2. 热会话 (Warm Session)：仅投递水位线之后的新增消息批次 (<delta-events>) + 单行收敛指引
  if (isWarmSession) {
    const invokersLabel =
      invokingAgents.length > 0
        ? invokingAgents.map((a) => `${a.name} (${resolveEffectiveAgentHandle(a)})`).join('、')
        : '团队成员';

    const directiveLine =
      hop > 1
        ? `[🤝 协同探讨指引 (来自 ${invokersLabel} 的探讨)] 请结合当前会话上下文与上方 <delta-events> 中的最新同伴发言，恪守你已绑定的专精职责展开回应：\n` +
          `• 💡 结论置顶：首段必须先用 2 句话以大白话讲清核心结论与主张（确保非技术使用者一眼看懂）；\n` +
          `• 🛠️ 真实增量：若有实质漏洞请指出具体失效工况，或给出架构减法/极简落地步骤，严禁自造抽象理论与生僻黑话；\n` +
          `• 🎯 自然收束：若方案已可行或共识已达成，直接给出最终实施方案且**切勿 @ 任何成员**${peers.length > 0 ? `（仅在确需特定同伴接力时才精准 @：${peerHandles}）` : ''}；\n` +
          `• 🛡️ 纯净表达：正文中严禁复读“Hop/轮次/增量批次/静默即成功”等调度控制词汇。`
        : `[💬 会话更新] 请结合当前会话上下文与上方 <delta-events> 中的最新消息，恪守你的专精职责推进解答：首段先给出 2 句话通俗结论，推演语言保持平实精炼，直指落地实现${peers.length > 0 ? `（如需协作可精准 @：${peerHandles}；若已完备切勿 @ 任何人）` : ''}。`;

    return `${deltaSection}\n\n${directiveLine}`;
  }

  // 3. 冷启动 (Cold Start)：当前 Agent 在该会话 Scope 的首次唤醒
  const sections: string[] = [];

  if (topic) {
    const peerSummary =
      peers.length > 0
        ? peers.map((p) => `${resolveEffectiveAgentHandle(p)} (${p.name} · ${p.role})`).join('、')
        : '(当前仅你独立在线)';
    const topicDesc = topic.description?.trim()
      ? escapeSemanticText(topic.description.trim())
      : '（围绕议题标题进行深度方案推演）';

    const topicBody =
      `所属频道: #${topic.channelName || 'channel'}\n` +
      `议题编号: ${topic.topicId}\n` +
      `议题标题: ${escapeSemanticText(topic.title)}\n` +
      `议题背景与目标: ${topicDesc}\n` +
      `参与研讨成员: ${peerSummary}`;

    sections.push(
      wrapSemanticSection('topic-context', topicBody, {
        id: topic.topicId,
        mode: 'standard',
      })
    );
  }

  sections.push(deltaSection);

  if (hop > 1 && invokingAgents.length > 0) {
    const invokersLabel = invokingAgents.map((a) => `${a.name} (${resolveEffectiveAgentHandle(a)})`).join('、');
    sections.push(
      `[🤝 协同探讨邀请 (来自 ${invokersLabel})] 请审阅上方上下文与最新讨论，恪守你已绑定的专精职责给出回应：\n` +
      `1. 【💡 结论置顶】：首段先用 2 句话通俗讲清核心态度与方案主张，确保非技术使用者一眼看懂；\n` +
      `2. 【针对审查与减法】：针对性审查漏洞或给出极简落地步骤，严禁自造新框架或堆砌生僻术语；\n` +
      `3. 【自然收束交付】：若方案已成熟收敛，直接输出落地总结且**切勿 @ 任何成员**${peers.length > 0 ? `（仅在确需特定成员继续接力时才精准 @：${peerHandles}）` : ''}；\n` +
      `4. 【杜绝流程黑话】：正文严禁出现“Hop/第几跳/增量公约”等流程元话语。`
    );
  } else if (isParallelFirstTurn && peers.length > 0) {
    sections.push(
      `[⚡ 首轮多专家并行独立推演 (Parallel Fan-out)] 当前多位频道专家正并发独立回应用户诉求。请恪守你已绑定的专精职责给出独立方案：\n` +
      `1. 【💡 结论置顶】：首段先用 2 句话通俗总结你的方案核心（确保非技术使用者一眼看懂）；\n` +
      `2. 【克制平实推演】：围绕你的专精领域展开平实且严谨的推演，拒绝堆砌黑话或自造抽象模型；\n` +
      `3. 【精准接力】：仅在你明确需要某位特定队友在下一轮做针对性协同审查时才使用 @handle（切勿盲目群发 @），若无需他人接力请勿添加 @。`
    );
  } else {
    sections.push(
      `请恪守你的专精职责定位【${targetAgent.name} (${targetEffectiveHandle})】回应上方诉求：首段先给出 2 句话通俗结论，语言通俗精炼，直指落地实现${peers.length > 0 ? `（如需特定同伴接力可精准 @：${peerHandles}；若方案已完备无需他人接力，请勿在正文中 @ 任何人）` : ''}。`
    );
  }

  return sections.join('\n\n');
}

export interface TurnAgentOutput {
  agent: Agent;
  messageId: string;
  replyContent: string;
}

export interface AggregatedMentionTarget {
  targetAgent: Agent;
  invokingAgents: Agent[];
  sourceMessageIds: string[];
  combinedReplies: Array<{ agent: Agent; messageId: string; content: string }>;
}

export interface TurnBarrierResolution {
  /** 去重合并后的下一轮待唤醒目标 Agent 列表 */
  nextTargets: AggregatedMentionTarget[];
  /** 尝试越界 @ 未加入当前频道/议题的外部 Agent 拦截记录 */
  uninvitedMentions: Array<{ invokingAgent: Agent; uninvitedAgents: Agent[] }>;
}

/**
 * 轮次同步屏障 (Turn Barrier) 提及汇聚与去重合并器
 *
 * 解决并发发言下的三大工程问题：
 * 1. 【抑制级联风暴 (Anti-Fanout Explosion)】：
 *    当同轮并发的 Agent A 和 Agent C 同时在回复中 `@AgentB` 时，屏障将其合并为对 `AgentB` 的 **单次唤醒**，
 *    并在 `invokingAgents` 中同时记录 `[AgentA, AgentC]`，杜绝同一 Agent 在同一跳被重复并发调用；
 * 2. 【兼容用户初始排队队列】：
 *    若本轮没有任何 Agent 主动发出 `@mention`，但存在残留的 `queuedCollaborators`，则平滑消费队列；
 * 3. 【越界准入统一审计】：
 *    集中检测本轮各 Agent 是否尝试点名未加入当前频道的外部 Agent，供宿主统一渲染准入拦截提示。
 */
export function aggregateTurnBarrierMentions(options: {
  turnOutputs: TurnAgentOutput[];
  candidateAgents: Agent[];
  allWorkspaceAgents: Agent[];
  isDm?: boolean;
  queuedCollaborators?: Agent[];
}): TurnBarrierResolution {
  const {
    turnOutputs,
    candidateAgents,
    allWorkspaceAgents,
    isDm = false,
    queuedCollaborators = [],
  } = options;

  const targetMap = new Map<string, AggregatedMentionTarget>();
  const uninvitedMentions: Array<{ invokingAgent: Agent; uninvitedAgents: Agent[] }> = [];

  for (const output of turnOutputs) {
    const { agent: invokingAgent, messageId, replyContent } = output;
    if (!replyContent || !replyContent.trim()) continue;

    // 1. 检查是否存在越界点名未受邀外部 Agent
    if (!isDm) {
      const isReplyAll = isAllMention(replyContent);
      if (!isReplyAll) {
        const outsiders = parseAgentMentions(replyContent, allWorkspaceAgents, invokingAgent.id).filter(
          (a) => !candidateAgents.some((ca) => ca.id === a.id)
        );
        if (outsiders.length > 0) {
          uninvitedMentions.push({
            invokingAgent,
            uninvitedAgents: outsiders,
          });
        }
      }
    }

    // 2. 从当前频道/议题准入的候选成员中提取显式 @ 的目标
    const mentionedInReply = parseAgentMentions(replyContent, candidateAgents, invokingAgent.id);
    for (const target of mentionedInReply) {
      const existing = targetMap.get(target.id);
      if (existing) {
        if (!existing.invokingAgents.some((ia) => ia.id === invokingAgent.id)) {
          existing.invokingAgents.push(invokingAgent);
        }
        if (messageId && !existing.sourceMessageIds.includes(messageId)) {
          existing.sourceMessageIds.push(messageId);
        }
        existing.combinedReplies.push({
          agent: invokingAgent,
          messageId,
          content: replyContent,
        });
      } else {
        targetMap.set(target.id, {
          targetAgent: target,
          invokingAgents: [invokingAgent],
          sourceMessageIds: messageId ? [messageId] : [],
          combinedReplies: [
            {
              agent: invokingAgent,
              messageId,
              content: replyContent,
            },
          ],
        });
      }
    }
  }

  // 3. 若本轮无任何显式 @，且存在兼容排队协作者，则提取队首
  if (targetMap.size === 0 && queuedCollaborators.length > 0 && turnOutputs.length > 0) {
    const nextQueued = queuedCollaborators[0];
    const lastOutput = turnOutputs[turnOutputs.length - 1];
    targetMap.set(nextQueued.id, {
      targetAgent: nextQueued,
      invokingAgents: [lastOutput.agent],
      sourceMessageIds: lastOutput.messageId ? [lastOutput.messageId] : [],
      combinedReplies: [
        {
          agent: lastOutput.agent,
          messageId: lastOutput.messageId,
          content: lastOutput.replyContent,
        },
      ],
    });
  }

  return {
    nextTargets: Array.from(targetMap.values()),
    uninvitedMentions,
  };
}

export interface BuildExecutionPromptOptions {
  topic: TopicPromptContext;
  executorAgent: Agent;
  decision: {
    summary: string;
    solution?: string;
    tradeOffPoints?: string[];
    impactedFiles?: string[];
  };
}

/**
 * 构造仲裁定案/共识合流后落地实施阶段的执行提示词
 * 由落地 Agent 根据任务真实属性交付产物（工程代码 Diff、规范文档、脚本或执行报告）并输出结构化 UI 描述契约
 */
export function buildExecutionPrompt(options: BuildExecutionPromptOptions): string {
  const { topic, executorAgent, decision } = options;

  const filesList = decision.impactedFiles && decision.impactedFiles.length > 0
    ? decision.impactedFiles.map((f) => `• \`${f}\``).join('\n')
    : '• (未强制限定特定文件；若任务涉及代码/文档/配置落盘请自行指定路径，若属纯方案/排查结论可直接输出报告)';

  const tradeOffs = decision.tradeOffPoints && decision.tradeOffPoints.length > 0
    ? `\n【关键权衡折中约束 (Trade-off Constraints)】:\n${decision.tradeOffPoints.map((p) => `• ${p}`).join('\n')}\n`
    : '';

  const roleDescriptionAddon = executorAgent.description?.trim()
    ? `\n【执行人专精定位与知识设定】：\n${executorAgent.description.trim()}\n`
    : '';

  return `[🛠️ 议题定案决议落地执行任务 (Post-Resolution Execution & Deliverable)]
【执行负责人】: ${executorAgent.name} (${executorAgent.handle} · ${executorAgent.role})${roleDescriptionAddon}
【所属议题】: 【${topic.title}】 (ID: ${topic.topicId})
【议题背景与需求】:
${topic.description?.trim() || topic.title}

【终局裁定结论 (Resolution Summary)】:
${decision.summary}
${decision.solution ? `\n【落地方案与执行要求】:\n${decision.solution}` : ''}${tradeOffs}
【涉及受影响文件参考】:
${filesList}

【落地实施与 UI 契约输出要求】:
1. 你已被指派为本议题定案决议的**落地执行智能体**。请依据上述定案结论与你的专职角色，直接产出真实的落地交付物（如工程代码变更、架构/需求规范文档、配置/SQL 脚本或专项执行报告）；
2. 若本次落地涉及修改或新建工作区文件（代码、文档、配置等），请为每个文件输出标准 Unified Diff 块（使用 \`\`\`diff 包裹，首行注明 \`--- a/文件路径\` 与 \`+++ b/文件路径\`），或在代码块首行注明 \`// filepath: 文件路径\`，以便工作台自动解析并支持一键物理合入；若本议题属于纯方案规划或分析结论、无需改动工作区文件，则直接输出结构化 Markdown 报告，不要强行编造伪代码；
3. **【强制 UI 描述契约】**：为使工作台 UI 动态适配本次交付物的真实业务语义，你**必须**在回复的最末尾附带如下格式的 JSON 元数据块（系统解析后会自动从展示正文中隐藏该块）：
<<<EXECUTION_META>>>
{
  "sectionTitle": "贴合本次交付物性质的章节标题（例如：订单幂等锁实现与单测补丁 / OAuth2 鉴权 ADR 规范落盘 / 慢查询根因排查与止血执行预案）",
  "podTitle": "带 Emoji 的简短落地舱名称（10字以内，例如：🛠️ 幂等锁代码交付 / 📄 鉴权规范落盘 / 📋 止血执行预案）",
  "statusSummary": "一句话交付成果摘要（40字以内，用于主时间轴卡片与系统通知展示）",
  "deliverableKind": "workspace_files 或 report_only（有工作区文件/文档变更时填 workspace_files，纯报告无文件变更时填 report_only）",
  "reviewActionLabel": "审查按钮动态文案（例如：审查代码 Diff / 预览文档变更 / 查看脚本 Diff）",
  "applyActionLabel": "合入按钮动态文案（例如：一键合入本地仓库 / 写入本地文档目录 / 应用配置变更）"
}
<<<EXECUTION_META_END>>>
4. 无需在正文中 @ 任何人，直接交付高质量落地成果！`;
}

interface CriterionCandidate {
  id: string;
  name: string;
  direction: 'maximize' | 'minimize';
  keywords: string[];
}

const CRITERIA_CATALOGUE: CriterionCandidate[] = [
  {
    id: 'rel',
    name: '系统健壮性与容灾抗风险',
    direction: 'maximize',
    keywords: ['健壮', '容灾', '高可用', '崩溃', '单点', '故障', '死锁', '可靠性', '稳定性', '异常'],
  },
  {
    id: 'perf',
    name: '吞吐性能与低延迟表现',
    direction: 'maximize',
    keywords: ['性能', '延迟', '高并发', '吞吐', 'tps', 'qps', '响应时间', '压测', '瓶颈', '毫秒'],
  },
  {
    id: 'comp',
    name: '代码实现与维护复杂度',
    direction: 'minimize',
    keywords: ['复杂度', '开发周期', '维护', '可读性', '技术债', '耦合', '重构成本', '工程量', '难度'],
  },
  {
    id: 'cons',
    name: '数据一致性与状态正确性',
    direction: 'maximize',
    keywords: ['一致性', '幂等', '原子性', '状态机', '事务', '数据丢失', '脏读', '竞争', '锁'],
  },
  {
    id: 'sec',
    name: '安全性与隔离防护机制',
    direction: 'maximize',
    keywords: ['安全', '权限', '攻击', '越权', '隔离', '审计', '防重放', '注入', '凭证'],
  },
  {
    id: 'cost',
    name: '资源开销与基础设施成本',
    direction: 'minimize',
    keywords: ['成本', '资源', '内存', 'cpu', '带宽', '开销', '服务器', '云成本', '配额'],
  },
];

function extractCoreThemeFromText(text?: string, fallback = ''): string {
  if (!text || !text.trim()) return fallback;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const keyLine = lines.find((l) =>
    l.includes('选型') || l.includes('方案') || l.includes('建议') || l.includes('结论') ||
    l.includes('架构') || l.includes('重构') || l.includes('补丁') || l.startsWith('1.')
  );
  if (keyLine) {
    const cleaned = keyLine.replace(/^[0-9.#\-*：:\s【】]+/, '').replace(/[*`_]/g, '').trim();
    if (cleaned.length >= 3) {
      return cleaned.slice(0, 20);
    }
  }
  const boldMatch = text.match(/\*\*([^*]{3,25})\*\*/);
  if (boldMatch) {
    return boldMatch[1].trim().slice(0, 20);
  }
  return lines[0]?.slice(0, 20) || fallback;
}

export interface GenerateMcdaOptions {
  arbiterText?: string;
  proposalText?: string;
  critiqueText?: string;
  defenseText?: string;
  topicTitle?: string;
  topicDescription?: string;
  argumentNodes?: ArgumentNode[];
  evidences?: GroundingEvidence[];
  sycophancy?: SycophancyEvaluation;
  modelDiversity?: ModelDiversityEvaluation;
}

/**
 * 神经符号确定性运筹裁决：结合 Arbiter 意图与真实研讨脉络，输出确定性多属性决策载荷 (LLM + BWM)
 */
export function generateDeterministicMcdaPayload(options: GenerateMcdaOptions): McdaDecisionPayload {
  const {
    arbiterText = '',
    proposalText = '',
    critiqueText = '',
    defenseText = '',
    topicTitle = '',
    topicDescription = '',
    argumentNodes = [],
    evidences = [],
    sycophancy,
    modelDiversity,
  } = options;

  const fullCorpus = [topicTitle, topicDescription, arbiterText, proposalText, critiqueText, defenseText].join('\n').toLowerCase();

  // 1. 动态评分筛选当前议题最关切的准则 (前 4 项)
  const scoredCriteria = CRITERIA_CATALOGUE.map((c) => {
    let count = 0;
    c.keywords.forEach((kw) => {
      const regex = new RegExp(kw.toLowerCase(), 'g');
      const matches = fullCorpus.match(regex);
      if (matches) count += matches.length;
    });
    return { candidate: c, count };
  });

  scoredCriteria.sort((a, b) => b.count - a.count);
  const selectedCandidates = scoredCriteria.slice(0, 4).map((s) => s.candidate);

  // 确保至少有 3 个准则，若不足则使用标准默认准则
  const criteria: McdaCriterion[] = (selectedCandidates.length >= 3 ? selectedCandidates : CRITERIA_CATALOGUE.slice(0, 4)).map((c) => ({
    id: c.id,
    name: c.name,
    direction: c.direction,
  }));

  // 2. 动态抽取候选方案名称
  const propTheme = extractCoreThemeFromText(proposalText, '提案主推方案');
  const critTheme = extractCoreThemeFromText(critiqueText, '红队对抗重构方案');
  const defTheme = extractCoreThemeFromText(defenseText || arbiterText, '架构权衡补丁');

  const altA = `方案A: 提案主导方案 (${propTheme})`;
  const altB = `方案B: 红队对抗方案 (${critTheme})`;
  const altC = `方案C: 架构权衡补丁 (${defTheme})`;
  const alternatives = [altA, altB, altC];

  // 3. 构建方案评分矩阵与证据溯源链 (Audit Provenance)
  const scoreMatrix: Record<string, Record<string, number>> = {
    [altA]: {},
    [altB]: {},
    [altC]: {},
  };
  const scoreProvenance: Record<string, Record<string, string>> = {
    [altA]: {},
    [altB]: {},
    [altC]: {},
  };

  // 计算实证与论点状态对准则的修正因子
  const verifiedT1T2Count = evidences.filter((e) => e.truthValue).length;
  const refutedT1T2Count = evidences.filter((e) => !e.truthValue).length;

  for (const crit of criteria) {
    let scoreA = 7.5;
    let scoreB = 7.0;
    let scoreC = 8.0;

    let provA = '立论基线设计';
    let provB = '红队对抗主张';
    let provC = '中立综合折中';

    // 准则方向与类型适配
    if (crit.id === 'rel' || crit.id === 'cons') {
      scoreA = 7.8;
      scoreB = 8.8;
      scoreC = 8.5;
      if (refutedT1T2Count > 0) {
        scoreA = Math.max(3.5, scoreA - 2.5);
        provA = `实证检验存在 ${refutedT1T2Count} 项未通过/复现反例缺陷`;
        provB = '红队反例获接地实证验证支持';
      } else if (verifiedT1T2Count > 0) {
        scoreA = Math.min(9.5, scoreA + 1.2);
        provA = `接地实证通过 ${verifiedT1T2Count} 项物理检验`;
      }
      if (defenseText.includes('补丁') || defenseText.includes('容灾') || defenseText.includes('降级')) {
        scoreC = Math.min(9.4, scoreC + 0.8);
        provC = '答辩已融入容灾/降级防御补丁';
      }
    } else if (crit.id === 'perf') {
      scoreA = 8.5;
      scoreB = 7.2;
      scoreC = 8.2;
      if (critiqueText.includes('性能') || critiqueText.includes('延迟') || critiqueText.includes('瓶颈')) {
        scoreA = Math.max(4.0, scoreA - 1.5);
        provA = '红队指出极端并发/网络抖动下的延迟抖动隐患';
      }
      if (defenseText.includes('优化') || defenseText.includes('异步') || defenseText.includes('缓存')) {
        scoreC = Math.min(9.2, scoreC + 0.8);
        provC = '答辩补丁引入异步/缓冲优化性能';
      }
    } else if (crit.id === 'comp') {
      // 复杂度越小越好 (minimize)
      scoreA = 4.5; // 相对较小改动
      scoreB = 8.8; // 推倒重构复杂度极高
      scoreC = 5.5; // 补丁折中
      provA = '原方案架构改动最小';
      provB = '推倒重构涉及深层技术栈与历史代码重写';
      provC = '局部补丁修补，工程周期适中';
    } else if (crit.id === 'cost') {
      scoreA = 4.0;
      scoreB = 7.5;
      scoreC = 4.8;
      provA = '复用现有基础设施';
      provB = '引入新架构组件需额外计算/运维资源';
      provC = '局部配置微调，资源增量低';
    } else if (crit.id === 'sec') {
      scoreA = 7.6;
      scoreB = 8.6;
      scoreC = 8.4;
      provA = '常规安全边界设计';
      provB = '隔离性更强但架构开销更大';
      provC = '补充安全鉴权与审计切面';
    }

    // Arbiter 仲裁文本倾向修正
    if (arbiterText.includes('驳回') || arbiterText.includes('推倒重构') || arbiterText.includes('推翻')) {
      scoreB = Math.min(9.6, scoreB + 1.0);
      scoreA = Math.max(3.0, scoreA - 1.5);
      provB += ' (仲裁官重点支持重构路线)';
    } else if (arbiterText.includes('采纳提案') || arbiterText.includes('坚持原案')) {
      scoreA = Math.min(9.5, scoreA + 1.0);
      provA += ' (仲裁官认可原案主体设计)';
    }

    scoreMatrix[altA][crit.id] = Math.round(scoreA * 10) / 10;
    scoreMatrix[altB][crit.id] = Math.round(scoreB * 10) / 10;
    scoreMatrix[altC][crit.id] = Math.round(scoreC * 10) / 10;

    scoreProvenance[altA][crit.id] = provA;
    scoreProvenance[altB][crit.id] = provB;
    scoreProvenance[altC][crit.id] = provC;
  }

  // 4. 依据仲裁陈词动态判定最优准则 (Best) 与最差准则 (Worst)
  let bestCriterionId = criteria[0].id;
  let worstCriterionId = criteria[criteria.length - 1].id;

  let maxBestMentions = -1;
  criteria.forEach((c) => {
    const cand = CRITERIA_CATALOGUE.find((cat) => cat.id === c.id);
    let mentions = 0;
    (cand?.keywords || [c.name]).forEach((kw) => {
      if (arbiterText.includes(kw)) mentions++;
    });
    if (mentions > maxBestMentions && mentions > 0) {
      maxBestMentions = mentions;
      bestCriterionId = c.id;
    }
  });

  const nonBestCriteria = criteria.filter((c) => c.id !== bestCriterionId);
  const costOrComp = nonBestCriteria.find((c) => c.id === 'cost' || c.id === 'comp');
  worstCriterionId = costOrComp ? costOrComp.id : nonBestCriteria[nonBestCriteria.length - 1].id;

  // 5. 构建符合一致性的 BWM 偏好向量
  const bestIdx = criteria.findIndex((c) => c.id === bestCriterionId);
  const worstIdx = criteria.findIndex((c) => c.id === worstCriterionId);

  const bestToOthers: number[] = new Array(criteria.length).fill(2);
  const othersToWorst: number[] = new Array(criteria.length).fill(2);

  bestToOthers[bestIdx] = 1;
  bestToOthers[worstIdx] = Math.min(5, Math.max(3, criteria.length));

  othersToWorst[worstIdx] = 1;
  othersToWorst[bestIdx] = bestToOthers[worstIdx];

  criteria.forEach((c, idx) => {
    if (idx !== bestIdx && idx !== worstIdx) {
      bestToOthers[idx] = 2;
      othersToWorst[idx] = Math.max(1, bestToOthers[worstIdx] - 1);
    }
  });

  // 6. 计算方案-准则置信度矩阵 (ReConcile 置信度动态加权)
  const confidenceMatrix = calculateConfidenceMatrix({
    alternatives,
    criteriaIds: criteria.map((c) => c.id),
    evidences,
    argumentNodes,
    sycophancy,
  });

  return solveDeterministicBwm({
    solverType: 'BWM',
    criteria,
    alternatives,
    scoreMatrix,
    bestCriterionId,
    worstCriterionId,
    bestToOthers,
    othersToWorst,
    scoreProvenance,
    confidenceMatrix,
  });
}

/**
 * 伴生少数派报告提炼
 */
export function extractOrCompileMinorityReport(options: {
  critiqueText: string;
  proposalText?: string;
  dissentingAgentId: string;
  dissentingAgentName: string;
  dissentingAgentModel?: string;
}): MinorityReport {
  return compileMinorityReport({
    dissentingAgentId: options.dissentingAgentId,
    dissentingAgentName: options.dissentingAgentName,
    dissentingAgentModel: options.dissentingAgentModel,
    critiqueText: options.critiqueText,
    proposalText: options.proposalText,
  });
}

/**
 * ---------------------------------------------------------------------------
 * 异步推演代际与停止信号守卫 (Turn Epoch & Abort Guard)
 * 覆盖全局清空历史、单房间/议题手动“停止”、单 Agent 终止以及频道成员变更时的旧轮次失效
 * ---------------------------------------------------------------------------
 */
export interface TurnEpochTracker {
  globalEpoch: number;
  roomEpochs: Map<string, number>;
  channelEpochs: Map<string, number>;
  agentExecutionEpochs: Map<string, number>;
}

export interface TurnEpochSnapshot {
  globalEpoch: number;
  roomId: string;
  roomEpoch: number;
  channelId?: string;
  channelEpoch: number;
  agentId?: string;
  agentExecEpoch: number;
}

export function createTurnEpochTracker(): TurnEpochTracker {
  return {
    globalEpoch: 0,
    roomEpochs: new Map<string, number>(),
    channelEpochs: new Map<string, number>(),
    agentExecutionEpochs: new Map<string, number>(),
  };
}

export function captureTurnEpochSnapshot(
  tracker: TurnEpochTracker,
  options: {
    roomId: string;
    channelId?: string;
    agentId?: string;
  }
): TurnEpochSnapshot {
  const { roomId, channelId, agentId } = options;
  const execKey = agentId ? `${roomId}:${agentId}` : '';
  return {
    globalEpoch: tracker.globalEpoch,
    roomId,
    roomEpoch: tracker.roomEpochs.get(roomId) || 0,
    channelId,
    channelEpoch: channelId ? tracker.channelEpochs.get(channelId) || 0 : 0,
    agentId,
    agentExecEpoch: execKey ? tracker.agentExecutionEpochs.get(execKey) || 0 : 0,
  };
}

export function isTurnEpochStale(
  tracker: TurnEpochTracker,
  snapshot: TurnEpochSnapshot
): boolean {
  if (snapshot.globalEpoch !== tracker.globalEpoch) {
    return true;
  }
  if ((tracker.roomEpochs.get(snapshot.roomId) || 0) !== snapshot.roomEpoch) {
    return true;
  }
  if (
    snapshot.channelId &&
    (tracker.channelEpochs.get(snapshot.channelId) || 0) !== snapshot.channelEpoch
  ) {
    return true;
  }
  if (snapshot.agentId) {
    const execKey = `${snapshot.roomId}:${snapshot.agentId}`;
    if ((tracker.agentExecutionEpochs.get(execKey) || 0) !== snapshot.agentExecEpoch) {
      return true;
    }
  }
  return false;
}

export function bumpGlobalEpoch(tracker: TurnEpochTracker): number {
  tracker.globalEpoch += 1;
  return tracker.globalEpoch;
}

export function bumpRoomEpoch(tracker: TurnEpochTracker, roomId: string): number {
  const next = (tracker.roomEpochs.get(roomId) || 0) + 1;
  tracker.roomEpochs.set(roomId, next);
  return next;
}

export function bumpChannelEpoch(
  tracker: TurnEpochTracker,
  channelId: string,
  relatedRoomIds: string[] = []
): number {
  const next = (tracker.channelEpochs.get(channelId) || 0) + 1;
  tracker.channelEpochs.set(channelId, next);
  for (const roomId of relatedRoomIds) {
    bumpRoomEpoch(tracker, roomId);
  }
  return next;
}

export function bumpAgentExecutionEpoch(
  tracker: TurnEpochTracker,
  roomId: string,
  agentId: string,
  alsoBumpRoom = false
): number {
  const execKey = `${roomId}:${agentId}`;
  const next = (tracker.agentExecutionEpochs.get(execKey) || 0) + 1;
  tracker.agentExecutionEpochs.set(execKey, next);
  if (alsoBumpRoom) {
    bumpRoomEpoch(tracker, roomId);
  }
  return next;
}

export interface AbortableExecutionItem {
  agentId: string;
  threadId: string;
  topicId?: string;
}

export interface ExecuteAbortAgentOptions<TExec extends AbortableExecutionItem> {
  agentId: string;
  threadId?: string;
  isGameTopic?: boolean;
  activeExecutionsRef: { current: Record<string, TExec> };
  activeCascadesRef: { current: Record<string, CollaborationCascade> };
  turnEpochTracker: TurnEpochTracker;
  inFlightHandovers: Set<string>;
  generationEpochRef?: { current: number };
  setActiveExecutions: (
    updater:
      | Record<string, TExec>
      | ((prev: Record<string, TExec>) => Record<string, TExec>)
  ) => void;
  setActiveCascades: (
    updater:
      | Record<string, CollaborationCascade>
      | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
  ) => void;
  setIsGenerating: (val: boolean) => void;
  setAgents?: (updater: (prev: Agent[]) => Agent[]) => void;
  setMessages?: (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => void;
}

/**
 * 同步执行单 Agent 终止编排（不依赖 React 19 自动批处理下延迟执行的 setState updater 副作用）：
 * 直接基于 activeExecutionsRef.current 同步计算同线程剩余执行数 remainingInThread，
 * 确保当同线程仍有其他 Agent 在并发执行时，仅递增目标 Agent 的 executionEpoch，绝不误停整条线程或级联。
 */
export function executeAbortAgentOrchestration<TExec extends AbortableExecutionItem>(
  options: ExecuteAbortAgentOptions<TExec>
): {
  remainingInThread: number;
  shouldAbortWholeThread: boolean;
} {
  const {
    agentId,
    threadId,
    isGameTopic,
    activeExecutionsRef,
    activeCascadesRef,
    turnEpochTracker,
    inFlightHandovers,
    generationEpochRef,
    setActiveExecutions,
    setActiveCascades,
    setIsGenerating,
    setAgents,
    setMessages,
  } = options;

  let remainingInThread = 0;
  const currentExecs = activeExecutionsRef.current || {};
  const nextExecs: Record<string, TExec> = { ...currentExecs };

  Object.keys(nextExecs).forEach((key) => {
    const item = nextExecs[key];
    const matchesThread = !threadId || item.threadId === threadId || item.topicId === threadId;
    if (item.agentId === agentId && matchesThread) {
      delete nextExecs[key];
    } else if (matchesThread) {
      remainingInThread++;
    }
  });

  activeExecutionsRef.current = nextExecs;
  if (Object.keys(nextExecs).length === 0) {
    setIsGenerating(false);
  }

  setActiveExecutions((prev) => {
    const updated: Record<string, TExec> = { ...prev };
    Object.keys(updated).forEach((key) => {
      const item = updated[key];
      const matchesThread = !threadId || item.threadId === threadId || item.topicId === threadId;
      if (item.agentId === agentId && matchesThread) {
        delete updated[key];
      }
    });
    if (Object.keys(updated).length === 0) {
      setIsGenerating(false);
    }
    activeExecutionsRef.current = updated;
    return updated;
  });

  const shouldAbortWholeThread = !threadId || Boolean(isGameTopic) || remainingInThread === 0;

  if (threadId) {
    bumpAgentExecutionEpoch(
      turnEpochTracker,
      threadId,
      agentId,
      shouldAbortWholeThread
    );
    if (shouldAbortWholeThread) {
      inFlightHandovers.forEach((key) => {
        if (key.startsWith(`${threadId}:`)) {
          inFlightHandovers.delete(key);
        }
      });
    }
  } else {
    if (generationEpochRef) {
      generationEpochRef.current++;
    }
    bumpGlobalEpoch(turnEpochTracker);
    inFlightHandovers.clear();
  }

  if (shouldAbortWholeThread) {
    const currentCascades = activeCascadesRef.current || {};
    const nextCascades: Record<string, CollaborationCascade> = {};
    (Object.entries(currentCascades) as [string, CollaborationCascade][]).forEach(([k, v]) => {
      if (!threadId || v.roomId === threadId) {
        nextCascades[k] = { ...v, isAborted: true };
      } else {
        nextCascades[k] = v;
      }
    });
    activeCascadesRef.current = nextCascades;

    setActiveCascades((prev) => {
      const updated: Record<string, CollaborationCascade> = {};
      (Object.entries(prev) as [string, CollaborationCascade][]).forEach(([k, v]) => {
        if (!threadId || v.roomId === threadId) {
          updated[k] = { ...v, isAborted: true };
        } else {
          updated[k] = v;
        }
      });
      activeCascadesRef.current = updated;
      return updated;
    });
  }

  if (setAgents) {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId && a.status !== 'idle' ? { ...a, status: 'running' } : a))
    );
  }

  if (threadId && setMessages) {
    setMessages((prev) => {
      const list = prev[threadId];
      if (!list || !list.some((m) => m.authorId === agentId && m.isPending)) return prev;
      return {
        ...prev,
        [threadId]: list.map((m) =>
          m.authorId === agentId && m.isPending
            ? {
                ...m,
                isPending: false,
                agentBadge: '已终止',
                content: (m.content || '') + '\n\n*(已由用户手动终止推演)*',
              }
            : m
        ),
      };
    });
  }

  return {
    remainingInThread,
    shouldAbortWholeThread,
  };
}

export interface ExecuteAbortAllOptions<TExec extends AbortableExecutionItem> {
  threadId?: string;
  activeExecutionsRef: { current: Record<string, TExec> };
  activeCascadesRef: { current: Record<string, CollaborationCascade> };
  turnEpochTracker: TurnEpochTracker;
  inFlightHandovers: Set<string>;
  generationEpochRef?: { current: number };
  setActiveExecutions: (
    updater:
      | Record<string, TExec>
      | ((prev: Record<string, TExec>) => Record<string, TExec>)
  ) => void;
  setActiveCascades: (
    updater:
      | Record<string, CollaborationCascade>
      | ((prev: Record<string, CollaborationCascade>) => Record<string, CollaborationCascade>)
  ) => void;
  setIsGenerating: (val: boolean) => void;
  setAgents?: (updater: (prev: Agent[]) => Agent[]) => void;
  setMessages?: (
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) => void;
}

/**
 * 执行指定线程或全局的全部执行终止编排：
 * 1. 递增房间或全局 Epoch 并清理在途交接锁；
 * 2. 标记匹配的级联为 isAborted，同步清理 activeExecutionsRef 与 React state；
 * 3. 将挂起消息标记为「已终止」，并保持 Agent 在线就绪状态 ('running')。
 */
export function executeAbortAllOrchestration<TExec extends AbortableExecutionItem>(
  options: ExecuteAbortAllOptions<TExec>
): void {
  const {
    threadId,
    activeExecutionsRef,
    activeCascadesRef,
    turnEpochTracker,
    inFlightHandovers,
    generationEpochRef,
    setActiveExecutions,
    setActiveCascades,
    setIsGenerating,
    setAgents,
    setMessages,
  } = options;

  if (threadId) {
    bumpRoomEpoch(turnEpochTracker, threadId);
    inFlightHandovers.forEach((key) => {
      if (key.startsWith(`${threadId}:`)) {
        inFlightHandovers.delete(key);
      }
    });
    if (setMessages) {
      setMessages((prev) => {
        const list = prev[threadId];
        if (!list || !list.some((m) => m.isPending)) return prev;
        return {
          ...prev,
          [threadId]: list.map((m) =>
            m.isPending
              ? {
                  ...m,
                  isPending: false,
                  agentBadge: '已终止',
                  content: (m.content || '') + '\n\n*(已由用户手动终止推演)*',
                }
              : m
          ),
        };
      });
    }
  } else {
    if (generationEpochRef) {
      generationEpochRef.current++;
    }
    bumpGlobalEpoch(turnEpochTracker);
    inFlightHandovers.clear();
  }

  const currentCascades = activeCascadesRef.current || {};
  const nextCascades: Record<string, CollaborationCascade> = {};
  (Object.entries(currentCascades) as [string, CollaborationCascade][]).forEach(([k, v]) => {
    if (!threadId || v.roomId === threadId) {
      nextCascades[k] = { ...v, isAborted: true };
    } else {
      nextCascades[k] = v;
    }
  });
  activeCascadesRef.current = nextCascades;

  setActiveCascades((prev) => {
    const next: Record<string, CollaborationCascade> = {};
    (Object.entries(prev) as [string, CollaborationCascade][]).forEach(([k, v]) => {
      if (!threadId || v.roomId === threadId) {
        next[k] = { ...v, isAborted: true };
      } else {
        next[k] = v;
      }
    });
    activeCascadesRef.current = next;
    return next;
  });

  const agentsToReset: string[] = [];
  Object.values(activeExecutionsRef.current || {}).forEach((item) => {
    if (!threadId || item.threadId === threadId || item.topicId === threadId) {
      agentsToReset.push(item.agentId);
    }
  });

  const nextExecs: Record<string, TExec> = { ...(activeExecutionsRef.current || {}) };
  Object.keys(nextExecs).forEach((key) => {
    const item = nextExecs[key];
    if (!threadId || item.threadId === threadId || item.topicId === threadId) {
      delete nextExecs[key];
    }
  });
  activeExecutionsRef.current = nextExecs;
  if (!threadId || Object.keys(nextExecs).length === 0) {
    setIsGenerating(false);
  }

  setActiveExecutions((prev) => {
    const next = { ...prev };
    Object.keys(next).forEach((key) => {
      const item = next[key];
      if (!threadId || item.threadId === threadId || item.topicId === threadId) {
        delete next[key];
      }
    });
    if (!threadId || Object.keys(next).length === 0) {
      setIsGenerating(false);
    }
    activeExecutionsRef.current = next;
    return next;
  });

  if (setAgents) {
    setAgents((prev) =>
      prev.map((a) =>
        agentsToReset.includes(a.id) && a.status !== 'idle' ? { ...a, status: 'running' } : a
      )
    );
  }
}

export interface ExecuteUpdateChannelMembersOptions<TExec extends AbortableExecutionItem> {
  channelId: string;
  updatedMemberIds: string[];
  agents: Agent[];
  threads: Thread[];
  messagesRef: { current: Record<string, Message[]> };
  activeExecutionsRef: { current: Record<string, TExec> };
  turnEpochTracker: TurnEpochTracker;
  deliveredStandingContext: Set<string>;
  sessionWatermarks: Map<string, string>;
  setChannels: (updater: (prev: Channel[]) => Channel[]) => void;
  setThreads: (updater: (prev: Thread[]) => Thread[]) => void;
  onAbortRoom: (roomId: string) => void;
  clearAcpSessionsByPrefix: (
    agentId: string | undefined,
    sessionKeyPrefix: string,
    contextLabel: string
  ) => Promise<void>;
}

/**
 * 执行频道成员更新编排（邀请/移除成员）：
 * 1. 计算归属于该频道的 Thread 与 Topic 列表，立即递增 channelEpoch 与受影响房间 roomEpoch；
 * 2. 若受影响房间存在正在运行的执行，立即调用 onAbortRoom 终止在途旧花名册轮次；
 * 3. 更新 channels 与 threads 的 React 状态；
 * 4. 精确清理该频道及下属议题的 standing context、会话水位线与底层 ACP Session（channel:<id> 与 topic:<id>）。
 */
export async function executeUpdateChannelMembersOrchestration<
  TExec extends AbortableExecutionItem
>(options: ExecuteUpdateChannelMembersOptions<TExec>): Promise<{
  updatedAgentIds: string[];
  affectedRoomIds: string[];
}> {
  const {
    channelId,
    updatedMemberIds,
    agents,
    threads,
    messagesRef,
    activeExecutionsRef,
    turnEpochTracker,
    deliveredStandingContext,
    sessionWatermarks,
    setChannels,
    setThreads,
    onAbortRoom,
    clearAcpSessionsByPrefix,
  } = options;

  const updatedAgentIds = updatedMemberIds.filter((id) => agents.some((a) => a.id === id));
  const channelThreadIds = threads.filter((t) => t.channelId === channelId).map((t) => t.id);
  const channelTopicIds: string[] = [];
  for (const msgList of Object.values(messagesRef.current || {}) as Message[][]) {
    for (const m of msgList) {
      if (m.type === 'topic' && m.topicData?.channelId === channelId) {
        channelTopicIds.push(m.topicData.id);
      }
    }
  }
  const affectedRoomIds = Array.from(new Set([...channelThreadIds, ...channelTopicIds]));

  bumpChannelEpoch(turnEpochTracker, channelId, affectedRoomIds);
  affectedRoomIds.forEach((rid) => {
    const hasActive = Object.values(activeExecutionsRef.current || {}).some(
      (e) => e.threadId === rid || e.topicId === rid
    );
    if (hasActive) {
      onAbortRoom(rid);
    }
  });

  setChannels((prev) =>
    prev.map((c) =>
      c.id === channelId
        ? {
            ...c,
            memberIds: updatedMemberIds,
            assignedAgentIds: updatedAgentIds,
          }
        : c
    )
  );

  setThreads((prev) =>
    prev.map((t) =>
      t.channelId === channelId
        ? { ...t, activeAgentIds: updatedAgentIds }
        : t
    )
  );

  deliveredStandingContext.forEach((key) => {
    if (matchesSessionScope(key, { channelId, deletedThreadIds: affectedRoomIds })) {
      deliveredStandingContext.delete(key);
    }
  });
  Array.from(sessionWatermarks.keys()).forEach((key) => {
    if (matchesSessionScope(key, { channelId, deletedThreadIds: affectedRoomIds })) {
      sessionWatermarks.delete(key);
    }
  });

  await Promise.all([
    clearAcpSessionsByPrefix(undefined, `channel:${channelId}`, '更新频道成员'),
    clearAcpSessionsByPrefix(undefined, `topic:${channelId}`, '更新频道成员'),
  ]);

  return {
    updatedAgentIds,
    affectedRoomIds,
  };
}

export interface UseCollaborationLifecycleControllerInit<
  TExec extends AbortableExecutionItem
> {
  initialAgents: Agent[];
  initialChannels: Channel[];
  initialThreads: Thread[];
  initialMessages: Record<string, Message[]>;
  initialActiveExecutions?: Record<string, TExec>;
  initialActiveCascades?: Record<string, CollaborationCascade>;
  initialStandingContextKeys?: string[];
  initialWatermarks?: Array<[string, string]>;
  isGameTopicResolver?: (threadId: string, messages: Record<string, Message[]>) => boolean;
  clearAcpSessionsFn: (
    agentId?: string,
    sessionKeyPrefix?: string
  ) => Promise<void>;
}

/**
 * 供真实 React 19 组件挂载与生命周期测试复用的协同控制 Hook：
 * 使用原生 React 19 `useState` / `useRef` / `useCallback` 管理 `agents`、`channels`、`threads`、`messages`、
 * `activeExecutions`、`activeCascades` 与 `turnEpochTracker`，暴露与 `App.tsx` 完全一致的
 * `handleAbortAgent`、`handleAbortAll` 与 `handleUpdateChannelMembers` 事件处理器。
 */
export function useCollaborationLifecycleController<
  TExec extends AbortableExecutionItem
>(init: UseCollaborationLifecycleControllerInit<TExec>) {
  const [agents, setAgents] = useState<Agent[]>(init.initialAgents);
  const [channels, setChannels] = useState<Channel[]>(init.initialChannels);
  const [threads, setThreads] = useState<Thread[]>(init.initialThreads);
  const [messages, setMessagesState] = useState<Record<string, Message[]>>(init.initialMessages);
  const [activeExecutions, setActiveExecutionsState] = useState<Record<string, TExec>>(
    init.initialActiveExecutions || {}
  );
  const [activeCascades, setActiveCascadesState] = useState<Record<string, CollaborationCascade>>(
    init.initialActiveCascades || {}
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(
    Object.keys(init.initialActiveExecutions || {}).length > 0
  );
  const [sessionCleanupNotice, setSessionCleanupNotice] = useState<string | null>(null);

  const messagesRef = useRef<Record<string, Message[]>>(init.initialMessages);
  const activeExecutionsRef = useRef<Record<string, TExec>>(init.initialActiveExecutions || {});
  const activeCascadesRef = useRef<Record<string, CollaborationCascade>>(
    init.initialActiveCascades || {}
  );
  const turnEpochTrackerRef = useRef<TurnEpochTracker>(createTurnEpochTracker());
  const inFlightHandoverRef = useRef<Set<string>>(new Set());
  const generationEpochRef = useRef<number>(0);
  const deliveredStandingContextRef = useRef<Set<string>>(
    new Set(init.initialStandingContextKeys || [])
  );
  const sessionWatermarksRef = useRef<Map<string, string>>(
    new Map(init.initialWatermarks || [])
  );

  const commitMessages = useCallback(
    (
      updater:
        | Record<string, Message[]>
        | ((prev: Record<string, Message[]>) => Record<string, Message[]>)
    ) => {
      setMessagesState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        messagesRef.current = next;
        return next;
      });
    },
    []
  );

  const safelyClearAcpSessions = useCallback(
    async (
      agentId: string | undefined,
      sessionKeyPrefix: string,
      contextLabel: string
    ): Promise<void> => {
      try {
        await init.clearAcpSessionsFn(agentId, sessionKeyPrefix);
        setSessionCleanupNotice((prev) => (prev && prev.includes(contextLabel) ? null : prev));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setSessionCleanupNotice(
          `⚠️ ${contextLabel}时底层 ACP 会话清理未完全成功 (${reason})，为防上下文串扰已阻断对应作用域の新请求，请重试清理`
        );
      }
    },
    [init.clearAcpSessionsFn]
  );

  const handleAbortAgent = useCallback(
    (agentId: string, threadId?: string) => {
      const isGameTopic =
        threadId && init.isGameTopicResolver
          ? init.isGameTopicResolver(threadId, messagesRef.current)
          : false;

      return executeAbortAgentOrchestration({
        agentId,
        threadId,
        isGameTopic,
        activeExecutionsRef,
        activeCascadesRef,
        turnEpochTracker: turnEpochTrackerRef.current,
        inFlightHandovers: inFlightHandoverRef.current,
        generationEpochRef,
        setActiveExecutions: setActiveExecutionsState,
        setActiveCascades: setActiveCascadesState,
        setIsGenerating,
        setAgents,
        setMessages: commitMessages,
      });
    },
    [commitMessages, init.isGameTopicResolver]
  );

  const handleAbortAll = useCallback(
    (threadId?: string) => {
      executeAbortAllOrchestration({
        threadId,
        activeExecutionsRef,
        activeCascadesRef,
        turnEpochTracker: turnEpochTrackerRef.current,
        inFlightHandovers: inFlightHandoverRef.current,
        generationEpochRef,
        setActiveExecutions: setActiveExecutionsState,
        setActiveCascades: setActiveCascadesState,
        setIsGenerating,
        setAgents,
        setMessages: commitMessages,
      });
    },
    [commitMessages]
  );

  const handleUpdateChannelMembers = useCallback(
    async (channelId: string, updatedMemberIds: string[]) => {
      return executeUpdateChannelMembersOrchestration({
        channelId,
        updatedMemberIds,
        agents,
        threads,
        messagesRef,
        activeExecutionsRef,
        turnEpochTracker: turnEpochTrackerRef.current,
        deliveredStandingContext: deliveredStandingContextRef.current,
        sessionWatermarks: sessionWatermarksRef.current,
        setChannels,
        setThreads,
        onAbortRoom: handleAbortAll,
        clearAcpSessionsByPrefix: safelyClearAcpSessions,
      });
    },
    [agents, threads, handleAbortAll, safelyClearAcpSessions]
  );

  return {
    agents,
    channels,
    threads,
    messages,
    activeExecutions,
    activeCascades,
    isGenerating,
    sessionCleanupNotice,
    turnEpochTrackerRef,
    deliveredStandingContextRef,
    sessionWatermarksRef,
    inFlightHandoverRef,
    generationEpochRef,
    handleAbortAgent,
    handleAbortAll,
    handleUpdateChannelMembers,
  };
}

// 统一重导出 CognoNexus 服务
export {
  solveDeterministicBwm,
  solveExactBwmOptionB,
  stepSprtGovernor,
  fitSprtCalibrationParams,
  estimateRoundAlignmentScore,
  compileMinorityReport,
  extractArgumentNodes,
  localizeEarliestDispute,
  dehydrateContextToCommittedStates,
  dehydrateContextWithAlert,
  logGameTheoreticTelemetry,
  getMetricBaselineSummary,
  getMetricBaselineReport,
  validateStageContract,
  validateModuleScopeContract,
  STAGE_CONTRACT_MAX_RETRIES,
  tieredGroundingGovernor,
  parseVerifierOutput,
  processVerifierEvidenceChain,
  estimateBaselineSycophancyScore,
  evaluateDynamicSycophancyScore,
  detectSycophanticSurrender,
  applySycophancyDiscountToSprt,
  detectModelFamily,
  calculateModelDiversity,
  calculateConfidenceMatrix,
  buildArgumentDag,
  calculateAffectedSubgraph,
  localizeGraphDiffDispute,
  calculateColMadContributions,
  estimateModulePriorRisk,
  sanitizeModuleDependencyDAG,
  initializeModularOrchestrationState,
  updateModuleBeliefWithFeedback,
  getNextSchedulableModule,
  advanceModularOrchestration,
  stepModularStageTransition,
  computeEntropyReductionRatio,
  buildDefaultDecompositionFromTopic,
};



