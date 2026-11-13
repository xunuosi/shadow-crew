import type {
  Agent,
  TopicWorkflowState,
  WorkflowArtifact,
  WorkflowStageKey,
} from '../../types';
import { getWorkflowModeMeta, getWorkflowStageSpec } from './workflowSpec';
import {
  REVIEW_REPORT_CLOSE,
  REVIEW_REPORT_OPEN,
  VERIFY_REPORT_CLOSE,
  VERIFY_REPORT_OPEN,
} from './workflowGates';

const ARTIFACT_PROMPT_LIMIT = 16_000;
const TOTAL_ARTIFACT_PROMPT_LIMIT = 48_000;
/** 前序轮次交接物独立预算：不与本轮上游交接物抢额度，超限时同样头尾保留。 */
const CARRYOVER_ARTIFACT_PROMPT_LIMIT = 12_000;
const TOTAL_CARRYOVER_PROMPT_LIMIT = 36_000;

/**
 * 上游交接物按「完整原文」注入，仅在超出上下文预算时做头尾保留截断。
 * 与博弈模式 1500 字脱水不同：工作流不允许把主笔产出压成摘要后再让下游重建上下文。
 */
export function truncateArtifactForPrompt(
  content: string,
  limit: number = ARTIFACT_PROMPT_LIMIT
): string {
  const text = content || '';
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.7);
  const tail = limit - head;
  return `${text.slice(0, head)}\n\n...（中间省略 ${text.length - limit} 字，完整内容保留在工作流交接区）...\n\n${text.slice(-tail)}`;
}

function collectInputArtifacts(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey
): WorkflowArtifact[] {
  const spec = getWorkflowStageSpec(stageKey);
  const artifacts: WorkflowArtifact[] = [];
  for (const inputKey of spec.inputStageKeys) {
    const stageArtifacts = state.artifacts.filter((artifact) => artifact.stageKey === inputKey);
    if (stageArtifacts.length === 0) continue;
    // 同一阶段多次执行（返工）时只取最近一轮
    const latestByAgent = new Map<string, WorkflowArtifact>();
    for (const artifact of stageArtifacts) {
      latestByAgent.set(artifact.agentId, artifact);
    }
    artifacts.push(...latestByAgent.values());
  }
  return artifacts;
}

function renderArtifacts(
  state: TopicWorkflowState,
  stageKey: WorkflowStageKey,
  acceptanceCriteria?: string
): string {
  const spec = getWorkflowStageSpec(stageKey);
  const artifacts = collectInputArtifacts(state, stageKey);
  const sections: string[] = [];
  let budget = TOTAL_ARTIFACT_PROMPT_LIMIT;

  for (const artifact of artifacts) {
    if (budget <= 0) break;
    const isVerification = stageKey === 'build_verify' && artifact.stageKey === 'build_implement';
    if (isVerification) {
      // 验收者不得依赖实现者自述，只给改动文件清单用于定位
      const files = artifact.filesTouched?.length
        ? artifact.filesTouched.map((file) => `- ${file}`).join('\n')
        : '（实现者未报告文件清单，请直接查看工作区改动）';
      sections.push(
        `<<<ARTIFACT stage=${artifact.stageKey}>\n实现者声明的改动文件（仅用于定位，不作为验收依据）：\n${files}\n<<<ARTIFACT_END>>>`
      );
      continue;
    }
    const content = truncateArtifactForPrompt(artifact.content, Math.min(ARTIFACT_PROMPT_LIMIT, budget));
    budget -= content.length;
    sections.push(
      `<<<ARTIFACT stage=${artifact.stageKey} agent=${artifact.agentName}>\n${content}\n<<<ARTIFACT_END>>>`
    );
  }

  if (stageKey === 'build_verify') {
    const criteria = acceptanceCriteria?.trim();
    sections.push(
      `<<<ACCEPTANCE_CRITERIA>\n${criteria || '方案未提供验收标准。请以议题目标为基准，自行设计最小可执行验收项（构建、类型检查、单测、关键命令），并在报告中列出。'}\n<<<ACCEPTANCE_CRITERIA_END>>>`
    );
  }

  if (sections.length === 0) {
    return '（本阶段无上游交接物，评审对象为议题描述与人类本轮输入。）';
  }
  return sections.join('\n\n');
}

/**
 * 前序轮次交接物：同一阶段 + 同一 Agent 只保留最近一次（返工中间稿不重复占预算）。
 * 仅渲染当前模式阶段列表内的交接物，模式变更后的旧阶段不会被注入。
 */
function collectCarryoverArtifacts(state: TopicWorkflowState): WorkflowArtifact[] {
  const carryover = state.carryover;
  if (!carryover) return [];
  const latest = new Map<string, WorkflowArtifact>();
  for (const artifact of carryover.artifacts) {
    if (!state.stageOrder.includes(artifact.stageKey)) continue;
    latest.set(`${artifact.stageKey}::${artifact.agentId}`, artifact);
  }
  return [...latest.values()].sort((a, b) => {
    const stageDelta = state.stageOrder.indexOf(a.stageKey) - state.stageOrder.indexOf(b.stageKey);
    return stageDelta !== 0 ? stageDelta : a.createdAt - b.createdAt;
  });
}

function renderCarryover(state: TopicWorkflowState): string {
  const artifacts = collectCarryoverArtifacts(state);
  if (artifacts.length === 0) return '';
  const carryover = state.carryover!;
  const statusLabel =
    carryover.previousStatus === 'completed'
      ? '已完成'
      : carryover.previousStatus === 'blocked'
        ? '被阻断'
        : carryover.previousStatus === 'failed'
          ? '执行失败'
          : '已取消';
  const sections = artifacts.map((artifact) => {
    const content = truncateArtifactForPrompt(artifact.content, CARRYOVER_ARTIFACT_PROMPT_LIMIT);
    return `<<<CARRYOVER stage=${artifact.stageKey} agent=${artifact.agentName}>\n${content}\n<<<CARRYOVER_END>>>`;
  });
  // 总预算从后往前裁剪：先保证最早阶段（交付主线）的原文完整。
  let remaining = TOTAL_CARRYOVER_PROMPT_LIMIT;
  const windowed: string[] = [];
  for (const section of sections) {
    if (remaining <= 0) break;
    if (section.length <= remaining) {
      windowed.push(section);
      remaining -= section.length;
    } else {
      windowed.push(truncateArtifactForPrompt(section, remaining));
      remaining = 0;
    }
  }
  return [
    `[增量续跑] 这是该议题的第 ${state.round ?? 1} 轮工作流；上一轮（第 ${carryover.fromRound} 轮，${statusLabel}${
      carryover.previousVerdict ? `，结论 ${carryover.previousVerdict}` : ''
    }）的完整交接物如下。`,
    '请在本轮最新输入的基础上增量修订：保留仍然正确的内容，只重写受影响部分；不得无视前序结论从零重演。',
    '注意：前序交接物只是上一轮的产出，不是本轮已通过的证据；本轮必须重新按当前阶段职责完成工作并给出新证据。',
    windowed.join('\n\n'),
  ].join('\n');
}

const STAGE_INSTRUCTIONS: Record<WorkflowStageKey, string> = {
  consult_draft: [
    '你是本阶段唯一主笔。请直接使用可用的工作区工具检索、阅读代码与文档，然后产出完整、可独立阅读的结果。',
    '要求：',
    '1. 结论先行，再给证据；引用代码必须给出 `path/to/file:line`。',
    '2. 覆盖：范围与前提 → 主体分析（模块、调用链、数据流）→ 边界与风险 → 未确认的未知项。',
    '3. 禁止客套、禁止复述需求、禁止编造未读到的内容；不确定就明确标注「未确认」。',
    '4. 篇幅按信息量决定，不要为了简短牺牲关键事实。',
  ].join('\n'),
  consult_crosscheck: [
    '你是独立核验者。只核验上游主笔产出，不要重写全文。',
    '逐条检查：事实错误、关键遗漏、无依据断言、边界风险、与代码实际行为不符之处。',
    '每条必须有证据（file:line / 命令输出 / 反例）；没有证据的意见必须标为 minor。',
    '没有发现问题就返回空 findings 并 approve，禁止为凑数编造。',
    '最后必须输出结构化块，且块内只能是合法 JSON：',
    REVIEW_REPORT_OPEN,
    '{"verdict":"approve|conditional|block","findings":[{"severity":"blocker|major|minor","title":"","evidence":"","suggestion":""}]}',
    REVIEW_REPORT_CLOSE,
  ].join('\n'),
  consult_finalize: [
    '你是定稿者。以主笔初稿为底稿，逐条处理独立核验意见：采纳的合并修正，驳回的写出理由。',
    '输出最终可交付版本，保留全部关键事实与引用，禁止压缩成摘要。',
    '文末增加「核验意见处理」小节，逐条列出：意见 → 采纳/驳回 → 处理结果。',
  ].join('\n'),
  review_scan: [
    '评审对象是议题描述与人类本轮输入中给出的方案/代码/配置/文档。',
    '你只评审，不重写。请独立判断，不要假设或引用其他评审者的结论。',
    '评审维度：正确性、边界与异常、安全、可维护性、可验证性、关键遗漏。',
    '每条发现必须有证据（file:line / 命令 / 反例 / 规范条款）；无证据不得标记为 blocker。',
    '最后必须输出结构化块，且块内只能是合法 JSON：',
    REVIEW_REPORT_OPEN,
    '{"verdict":"approve|conditional|block","findings":[{"severity":"blocker|major|minor","title":"","evidence":"","suggestion":""}]}',
    REVIEW_REPORT_CLOSE,
  ].join('\n'),
  review_synthesize: [
    '你是汇总裁定者。基于所有独立评审报告：去重、合并同类项、按严重度分级。',
    '输出：最终结论、阻断项（必须修复）、必修项、建议项、未覆盖风险。',
    '不得新增评审报告中不存在的事实；评审意见冲突时必须显式标注并给出裁决理由。',
    '文末单独输出一行：`VERDICT: APPROVE|CONDITIONAL|BLOCK`。',
  ].join('\n'),
  build_design: [
    '你是方案设计者。先读工作区相关代码，再产出实现方案。',
    '方案必须包含：目标与范围、改动文件清单（路径级）、接口/数据结构变化、分步实施顺序、风险与回滚、【验收标准】。',
    '【验收标准】必须是可执行的：测试命令、构建命令、输入与预期输出；不能只写「功能正常」。',
    '本阶段禁止修改任何文件，只产出方案。',
  ].join('\n'),
  build_design_review: [
    '你是独立方案评审者。评审上游实现方案是否可落地、可测试、边界是否覆盖，是否遗漏兼容/迁移/回滚。',
    '必要时读取代码核对，但禁止修改文件。',
    'blocker 表示「不得进入实施」。',
    '最后必须输出结构化块，且块内只能是合法 JSON：',
    REVIEW_REPORT_OPEN,
    '{"verdict":"approve|conditional|block","findings":[{"severity":"blocker|major|minor","title":"","evidence":"","suggestion":""}]}',
    REVIEW_REPORT_CLOSE,
  ].join('\n'),
  build_implement: [
    '方案已通过评审。按方案直接在工作区实现，允许读写文件、运行命令。',
    '硬性要求：',
    '1. 真实修改文件，禁止只输出伪代码或 diff 文本。',
    '2. 遵守方案列出的改动范围；需要偏离时必须说明原因。',
    '3. 完成后输出：改动文件清单、关键实现说明、已执行的验证命令与结果、遗留风险。',
  ].join('\n'),
  build_verify: [
    '你是独立验收者，与实现者分离。',
    '依据：议题需求、已通过的方案与【验收标准】、工作区实际产物。',
    '硬性要求：',
    '1. 从验收标准自行推导检查项，实际运行构建/测试/命令，并在报告中粘贴关键输出。',
    '2. 不得依赖实现者的自述；实现者描述只用于定位文件。',
    '3. 无法执行的检查必须明确标记 passed=false 或列入 failures，禁止猜测通过。',
    '4. 如果发现自己在复述实现者的结论，请回到验收标准重新执行。',
    '最后必须输出结构化块，且块内只能是合法 JSON：',
    VERIFY_REPORT_OPEN,
    '{"verdict":"pass|fail","checks":[{"command":"","output":"","passed":true}],"failures":[{"severity":"blocker|major|minor","title":"","evidence":""}]}',
    VERIFY_REPORT_CLOSE,
  ].join('\n'),
  build_fix: [
    '验收未通过。下面是独立验收报告与失败证据。',
    '只修复失败项与直接相关问题，不要重写无关代码。',
    '修复后输出：改动文件清单、逐条对应失败项的修复说明、重新执行的验证命令与结果。',
  ].join('\n'),
  build_accept: [
    '验收已通过。输出最终交付摘要：改动概览、验收证据（命令/测试结果）、残余风险、回滚方式。',
    '不要重复粘贴整份方案或代码。',
  ].join('\n'),
};

export interface WorkflowPromptInput {
  topicTitle: string;
  topicDescription?: string;
  state: TopicWorkflowState;
  stageKey: WorkflowStageKey;
  targetAgent: Agent;
  participants: Agent[];
  userContent?: string;
  attempt: number;
  acceptanceCriteria?: string;
}

export function buildWorkflowPrompt(input: WorkflowPromptInput): string {
  const { state, stageKey, targetAgent, participants, userContent, attempt } = input;
  const meta = getWorkflowModeMeta(state.mode);
  const spec = getWorkflowStageSpec(stageKey);
  const stageIndex = state.stageOrder.indexOf(stageKey) + 1;

  const roleLine = (ids: string[]): string =>
    ids
      .map((id) => participants.find((agent) => agent.id === id)?.name || id)
      .join('、') || '未指派';

  const roster = [
    `- 主笔/执行：${roleLine([state.roles.author])}`,
    `- 独立评审：${roleLine(state.roles.criticIds)}`,
    `- 独立验收：${state.roles.verifierId ? roleLine([state.roles.verifierId]) : '未指派'}`,
  ].join('\n');

  const sections = [
    `[工作流协同] 模式：${meta.label}（${state.mode}） · 阶段 ${stageIndex}/${state.stageOrder.length}：${spec.label}`,
    `[议题] ${input.topicTitle}`,
    `[目标与背景]\n${input.topicDescription?.trim() || '（未提供，按议题标题理解）'}`,
    `[团队角色]\n${roster}`,
    `[你的身份] ${targetAgent.name}（${targetAgent.role}） · 本阶段角色：${spec.role}`,
    `[当前阶段职责]\n${STAGE_INSTRUCTIONS[stageKey]}`,
  ];

  if (attempt > 1) {
    sections.push(
      `[返工说明] 这是该阶段的第 ${attempt} 次尝试。上一轮未通过门禁，请针对失败原因修正，不要原样重复。`
    );
  }

  if (userContent?.trim()) {
    sections.push(`[人类本轮输入]\n${userContent.trim()}`);
  }

  const carryoverSection = renderCarryover(state);
  if (carryoverSection) {
    sections.push(carryoverSection);
  }

  sections.push(`[上游交接物]\n${renderArtifacts(state, stageKey, input.acceptanceCriteria)}`);

  sections.push(
    '[执行纪律]\n1. 只做本阶段职责内的事，不要越权替下游阶段下结论。\n2. 所有断言都要能被工作区文件或命令输出证实。\n3. 输出使用中文，技术标识保留原文。'
  );

  return sections.join('\n\n');
}
