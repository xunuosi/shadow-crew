import assert from 'node:assert/strict';
import {
  extractCoreClaims,
  extractImpactedFilesFromDebate,
  synthesizeContextGroundedRulingDrafts,
  extractArbitrationRulingOptionsFromAcpResponse,
} from './rulingDraftSynthesizer';
import { RulingDecisionType, ArbitrationRulingDraft } from '../../types';

console.log('================================================================================');
console.log('🧪 CognoNexus: 仲裁定案裁决书动态事实趋真生成、3 种模式预案与人类定制方案回归');
console.log('================================================================================');

// 真实研讨事实夹具 (以 Codex Cli 适配器优化博弈为例)
const mockDebateFacts = {
  topicTitle: 'Codex Cli 适配器与断线会话生命周期优化',
  topicDescription: '针对 Codex stdio 进程通信与断线会话清理异常，开展架构攻防与落地推演。涉及 src/acp_manager.rs 与 src/services/acpClient.ts。',
  proposalText: `## 一、核心架构立论
我们主张在 ACP 管理层建立轻量代理会话池，通过 session/prompt 管道直接与 Codex 官方进程通信，避免全局锁竞争。
核心设计：在 src/acp_manager.rs 维护活动的 active_sessions 哈希表，按 sessionKey 进行并发隔离。
此方案开发成本低、性能吞吐高，能够快速满足桌面端多 Agent 协作需求。`,
  critiqueText: `## 二、红队反例质询与压测证伪
原提案存在致命资源泄漏与死锁隐患！
致命反例：当网络抖动或用户手动终止 Turn 时，src/acp_manager.rs 发送 session/close 仅作为无 ID 通知发送。而官方 ACP v2 协议将 session/close 注册为带 ID 的 request！底层进程根本不处理此通知，导致子进程孤儿僵死，最终耗尽系统句柄引发 OOM。
必须驳回单点代理方案，强制引入带请求 ID 的关闭确认与超时强杀机制！`,
  defenseText: `## 三、提案方防御答辩与架构补丁
红队反例切中要害，我们吸收质询要点，并构建架构补丁防御：
1. 废弃 session/close 通知语义，改用带全局唯一递增 JSON-RPC ID 的请求契约，并等待客户端确认；
2. 在 src/acp_manager.rs 增加 3 秒优雅退出超时守卫，若超时未响应则触发 SIGTERM/SIGKILL 强制终止；
3. 设立运行期健康度探测探针，确保僵尸进程被彻底收割。`,
  verificationText: `## 四、接地实证事实
实证沙箱在 macOS 环境下运行 cargo test -p shadow-crew-dev-mcp 验证，复现了通知被官方端点静默丢弃的缺陷，证实红队反例为真。`,
  mcdaPayload: {
    criteria: [
      { id: 'crit-stability', name: '系统容灾与状态正确性' },
      { id: 'crit-perf', name: '交互吞吐与低延迟' },
    ],
    computedWeights: {
      'crit-stability': 0.72,
      'crit-perf': 0.28,
    },
    consistencyPassed: true,
    consistencyIndex: 0.04,
    ranking: [
      { alternative: '方案C: 架构权衡补丁 (带 ID 请求与超时强杀)', totalUtility: 0.88 },
    ],
  } as any,
  authorName: 'MyClaudeCode (综合仲裁官)',
};

// -----------------------------------------------------------------------------
// 测试 1: 基于真实研讨上下文动态合成 3 种模式针对性草案
// -----------------------------------------------------------------------------
console.log('\n--- 测试 1: 基于前序立论、反例和答辩事实动态生成 3 种模式针对性草案 ---');

const dynamicDrafts = synthesizeContextGroundedRulingDrafts(mockDebateFacts);

assert.ok(dynamicDrafts.adopt_proposer, '必须生成 adopt_proposer 预案');
assert.ok(dynamicDrafts.reject_rebuild, '必须生成 reject_rebuild 预案');
assert.ok(dynamicDrafts.trade_off_matrix, '必须生成 trade_off_matrix 预案');

// 校验 adopt_proposer 包含立论与答辩关键技术点
assert.match(dynamicDrafts.adopt_proposer.summary, /Codex Cli 适配器与断线会话生命周期优化/);
assert.match(dynamicDrafts.adopt_proposer.summary, /防御/);
assert.match(dynamicDrafts.adopt_proposer.solution, /核心设计路径/);
assert.ok(
  dynamicDrafts.adopt_proposer.impactedFiles.some((f) => f.includes('src/acp_manager.rs')),
  '必须自动识别并包含研讨中的真实文件 src/acp_manager.rs'
);

// 校验 reject_rebuild 紧扣红队反例缺陷
assert.match(dynamicDrafts.reject_rebuild.summary, /驳回/);
assert.match(dynamicDrafts.reject_rebuild.summary, /反例/);
assert.match(dynamicDrafts.reject_rebuild.solution, /推倒/);
assert.ok(
  dynamicDrafts.reject_rebuild.tradeOffPoints.some((p) => p.includes('健壮性') || p.includes('安全')),
  '驳回重构模式必须强调拒绝以健壮性换局部优化的红线'
);

// 校验 trade_off_matrix 包含 MCDA 运筹权衡与分期实施路径
assert.match(dynamicDrafts.trade_off_matrix.summary, /运筹权衡矩阵/);
assert.match(dynamicDrafts.trade_off_matrix.solution, /分阶段/);
assert.ok(
  dynamicDrafts.trade_off_matrix.tradeOffPoints.some((p) => p.includes('BWM 求解权重') || p.includes('系统容灾')),
  '权衡矩阵模式必须吸纳运筹 BWM 求解权重与分期权衡要点'
);

console.log('✓ 3 种模式草案全部基于真实研讨事实动态生成，准确包含立论、反例、答辩及涉及文件');

// -----------------------------------------------------------------------------
// 测试 2: 绝无死板写死模板检查 (Anti-Boilerplate Invariant)
// -----------------------------------------------------------------------------
console.log('\n--- 测试 2: 绝无死板刻板写死模板检验 (Anti-Boilerplate Invariant) ---');

const bannedTemplates = [
  '围绕“${topicTitle}”的提案方案具备落地可行性与工程优势，准予合并交付',
  '由责任团队全面吸收红队反例要点，重新确立安全假设并提交新版方案',
  '采纳折中权衡演进路径：第一阶段快速落地核心主线功能',
  '采纳提案官核心架构设计与防御补丁，按标准实施交付并建立运行期监控',
  '拒绝以牺牲系统健壮性为代价的局部优化，强制推倒单点失效架构',
];

for (const [mode, draft] of Object.entries(dynamicDrafts) as [RulingDecisionType, ArbitrationRulingDraft][]) {
  for (const banned of bannedTemplates) {
    assert.equal(
      draft.summary.includes(banned),
      false,
      `模式 [${mode}] summary 不得出现刻板模板: ${banned}`
    );
    assert.equal(
      draft.solution?.includes(banned) ?? false,
      false,
      `模式 [${mode}] solution 不得出现刻板模板: ${banned}`
    );
  }
}

console.log('✓ 零刻板写死模板校验通过：所有模式方案均真实锚定议题技术上下文');

// -----------------------------------------------------------------------------
// 测试 3: ACP 响应解析与 3 种模式预案预生成能力
// -----------------------------------------------------------------------------
console.log('\n--- 测试 3: ACP 响应解析与 3 种模式预案提取测试 ---');

// 3.1 测试多选项块 <<<RULING_DRAFT_OPTIONS>>> 解析
const multiOptionAcpResp = {
  textResponse: `## 综合仲裁建言
经审定，我们建议采纳权衡折中方案。
<<<RULING_DRAFT_OPTIONS>>>
{
  "recommended_type": "trade_off_matrix",
  "adopt_proposer": {
    "decision_type": "adopt_proposer",
    "summary": "AI生成：采纳提案方在 acp_manager.rs 的轻量代理，并以补丁防范网络抖动",
    "solution": "落地路径：快速合入主干代码库",
    "trade_off_points": ["吞吐量优先"],
    "impacted_files": ["src/acp_manager.rs"]
  },
  "reject_rebuild": {
    "decision_type": "reject_rebuild",
    "summary": "AI生成：驳回原案，官方 ACP v2 协议不兼容带 ID 缺失是系统级致命隐患",
    "solution": "重构路径：彻底重写关闭会话的 JSON-RPC 状态机",
    "trade_off_points": ["严格协议兼容性优先"],
    "impacted_files": ["src/acp_manager.rs"]
  },
  "trade_off_matrix": {
    "decision_type": "trade_off_matrix",
    "summary": "AI生成：折中方案：第一阶段补齐 ID 请求，第二阶段增设优雅退出",
    "solution": "实施步骤：按两周周期演进合入",
    "trade_off_points": ["第一阶段解决协议丢弃", "第二阶段保障超时优雅收割"],
    "impacted_files": ["src/acp_manager.rs", "src/services/acpClient.ts"]
  }
}
<<<RULING_DRAFT_OPTIONS_END>>>
@MyCodex 请查阅并核验无异议。`,
};

const extractedFromMulti = extractArbitrationRulingOptionsFromAcpResponse(multiOptionAcpResp, mockDebateFacts);
assert.equal(extractedFromMulti.primaryDraft.decisionType, 'trade_off_matrix');
assert.equal(extractedFromMulti.options.adopt_proposer.summary, 'AI生成：采纳提案方在 acp_manager.rs 的轻量代理，并以补丁防范网络抖动');
assert.equal(extractedFromMulti.options.reject_rebuild.summary, 'AI生成：驳回原案，官方 ACP v2 协议不兼容带 ID 缺失是系统级致命隐患');
assert.equal(extractedFromMulti.options.trade_off_matrix.summary, 'AI生成：折中方案：第一阶段补齐 ID 请求，第二阶段增设优雅退出');

console.log('✓ <<<RULING_DRAFT_OPTIONS>>> 多模式预案完整解析通过');

// 3.2 测试仅提供单项草案时，自动动态补齐其余 2 种模式
const singleOptionAcpResp = {
  textResponse: `## 综合仲裁建言
<<<RULING_DRAFT>>>
{
  "decision_type": "adopt_proposer",
  "summary": "AI定制：认可提案方设计，直接通过采纳",
  "solution": "立即执行代码合入",
  "trade_off_points": ["交付时效优先"],
  "impacted_files": ["src/acp_manager.rs"]
}
<<<RULING_DRAFT_END>>>`,
};

const extractedFromSingle = extractArbitrationRulingOptionsFromAcpResponse(singleOptionAcpResp, mockDebateFacts);
assert.equal(extractedFromSingle.primaryDraft.decisionType, 'adopt_proposer');
assert.equal(extractedFromSingle.options.adopt_proposer.summary, 'AI定制：认可提案方设计，直接通过采纳');
// 其余 2 种模式必须由事实合成器动态无缝补齐，且绝非空值或死模板
assert.ok(extractedFromSingle.options.reject_rebuild.summary.length > 20);
assert.match(extractedFromSingle.options.reject_rebuild.summary, /驳回/);
assert.ok(extractedFromSingle.options.trade_off_matrix.summary.length > 20);
assert.match(extractedFromSingle.options.trade_off_matrix.summary, /权衡/);

console.log('✓ 单草案输入时其余模式由上下文事实动态补齐，确保 3 种模式全量可用');

// 3.3 测试通过 MCP 工具 submit_arbitration_ruling (含 ruling_options) 直接提取裁决与 3 种模式预案
const toolCallAcpResp = {
  textResponse: '【综合裁决】已通过原生 MCP 工具提交裁决书。',
  mcpToolCalls: [
    {
      tool_name: 'submit_arbitration_ruling',
      arguments: {
        decision_type: 'trade_off_matrix',
        summary: 'MCP工具提交：折中方案：第一阶段补齐 ID 请求，第二阶段增设优雅退出',
        trade_off_points: ['第一阶段解决协议丢弃', '第二阶段保障超时收割'],
        impacted_files: ['src/acp_manager.rs'],
        solution: '分期实施',
        ruling_options: {
          adopt_proposer: {
            decision_type: 'adopt_proposer',
            summary: 'MCP工具预案：采纳提案方在 acp_manager.rs 的轻量代理，并以补丁防范网络抖动',
            trade_off_points: ['吞吐量优先'],
            impacted_files: ['src/acp_manager.rs'],
            solution: '合入主干',
          },
          reject_rebuild: {
            decision_type: 'reject_rebuild',
            summary: 'MCP工具预案：驳回原案，官方 ACP v2 协议不兼容带 ID 缺失是系统级致命隐患',
            trade_off_points: ['严格协议规范'],
            impacted_files: ['src/acp_manager.rs'],
            solution: '推倒重构',
          },
          trade_off_matrix: {
            decision_type: 'trade_off_matrix',
            summary: 'MCP工具预案：折中方案：第一阶段补齐 ID 请求，第二阶段增设优雅退出',
            trade_off_points: ['第一阶段解决协议丢弃', '第二阶段保障超时收割'],
            impacted_files: ['src/acp_manager.rs'],
            solution: '分期实施',
          },
        },
      },
    },
  ],
};

const extractedFromTool = extractArbitrationRulingOptionsFromAcpResponse(toolCallAcpResp, mockDebateFacts);
assert.equal(extractedFromTool.primaryDraft.decisionType, 'trade_off_matrix');
assert.equal(extractedFromTool.options.adopt_proposer.summary, 'MCP工具预案：采纳提案方在 acp_manager.rs 的轻量代理，并以补丁防范网络抖动');
assert.equal(extractedFromTool.options.reject_rebuild.summary, 'MCP工具预案：驳回原案，官方 ACP v2 协议不兼容带 ID 缺失是系统级致命隐患');
assert.equal(extractedFromTool.options.trade_off_matrix.summary, 'MCP工具预案：折中方案：第一阶段补齐 ID 请求，第二阶段增设优雅退出');

console.log('✓ 原生 MCP 工具 submit_arbitration_ruling (含 ruling_options) 直接提取校验通过');

// -----------------------------------------------------------------------------
// 测试 4: 人类在法槌弹窗中切换模式与方案定制独立保存状态机
// -----------------------------------------------------------------------------
console.log('\n--- 测试 4: 人类在法槌弹窗中模式切换与方案定制独立保存状态机 ---');

// 模拟 TopicThreadDrawer 的 customDraftsByMode 状态机核心行为
interface ModeState {
  rulingSummary: string;
  rulingSolution: string;
  rulingImpactedFiles: string;
  tradeOffPoints: string[];
  isCustomized: boolean;
}

const customDraftsByMode: Partial<Record<RulingDecisionType, ModeState>> = {};
let currentMode: RulingDecisionType = 'adopt_proposer';

function resolveModalDraft(type: RulingDecisionType, aiOptions: Record<RulingDecisionType, ArbitrationRulingDraft>): ModeState {
  if (customDraftsByMode[type]?.isCustomized) {
    return customDraftsByMode[type]!;
  }
  const aiDraft = aiOptions[type];
  return {
    rulingSummary: aiDraft.summary,
    rulingSolution: aiDraft.solution || '',
    rulingImpactedFiles: aiDraft.impactedFiles.join(', '),
    tradeOffPoints: [...aiDraft.tradeOffPoints],
    isCustomized: false,
  };
}

// 步骤 1: 初始打开采纳模式
let activeDraft = resolveModalDraft('adopt_proposer', extractedFromMulti.options);
assert.equal(activeDraft.isCustomized, false);
assert.match(activeDraft.rulingSummary, /轻量代理/);

// 步骤 2: 人类对采纳模式输入新的方案建议与定制说明
activeDraft.rulingSummary = '人类首席仲裁官批示：准予采纳，但必须由 M5Pro 亲自审查 acp_manager.rs';
activeDraft.rulingSolution = '人类定制落地：增加 CI 门禁自动化校验 session/close request';
activeDraft.isCustomized = true;
customDraftsByMode['adopt_proposer'] = { ...activeDraft };

// 步骤 3: 人类切换到驳回重构模式
currentMode = 'reject_rebuild';
activeDraft = resolveModalDraft('reject_rebuild', extractedFromMulti.options);
// 此时应展示 AI 生成的驳回重构预案
assert.equal(activeDraft.isCustomized, false);
assert.match(activeDraft.rulingSummary, /协议不兼容/);

// 人类在驳回重构模式下也输入定制建议
activeDraft.rulingSummary = '人类首席仲裁官批示：彻底推倒，严禁在生产环境使用任何不带 ID 的单向通知';
activeDraft.isCustomized = true;
customDraftsByMode['reject_rebuild'] = { ...activeDraft };

// 步骤 4: 切换到权衡矩阵模式
currentMode = 'trade_off_matrix';
activeDraft = resolveModalDraft('trade_off_matrix', extractedFromMulti.options);
assert.equal(activeDraft.isCustomized, false);
assert.match(activeDraft.rulingSummary, /折中方案/);

// 步骤 5: 切换回采纳模式，验证人类先前的定制输入被完整保留，未被覆盖！
currentMode = 'adopt_proposer';
activeDraft = resolveModalDraft('adopt_proposer', extractedFromMulti.options);
assert.equal(activeDraft.isCustomized, true);
assert.equal(activeDraft.rulingSummary, '人类首席仲裁官批示：准予采纳，但必须由 M5Pro 亲自审查 acp_manager.rs');
assert.equal(activeDraft.rulingSolution, '人类定制落地：增加 CI 门禁自动化校验 session/close request');

// 步骤 6: 切换回驳回模式，验证人类定制的驳回建议同样完整保留！
currentMode = 'reject_rebuild';
activeDraft = resolveModalDraft('reject_rebuild', extractedFromMulti.options);
assert.equal(activeDraft.isCustomized, true);
assert.equal(activeDraft.rulingSummary, '人类首席仲裁官批示：彻底推倒，严禁在生产环境使用任何不带 ID 的单向通知');

// 步骤 7: 测试在采纳模式点击「恢复 AI 原案」
delete customDraftsByMode['adopt_proposer'];
activeDraft = resolveModalDraft('adopt_proposer', extractedFromMulti.options);
assert.equal(activeDraft.isCustomized, false);
assert.equal(activeDraft.rulingSummary, 'AI生成：采纳提案方在 acp_manager.rs 的轻量代理，并以补丁防范网络抖动');

console.log('✓ 法槌弹窗模式切换、人类多模式定制独立保存与恢复 AI 原案状态机验证完全通过！');

console.log('================================================================================');
console.log('🎉 动态裁决书生成、3 种模式预案预生成与人类自由定制方案全量测试通过 (100%)！');
console.log('================================================================================');
