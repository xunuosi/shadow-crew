import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActiveAgentExecution,
  Agent,
  RulingDecisionType,
  TopicMessageData,
} from '../../types';
import { ArbiterRulingModal } from '../../components/ArbiterRulingModal';
import {
  RULING_MODAL_DEFAULT_WIDTH,
  RULING_MODAL_MAX_WIDTH,
  RULING_MODAL_MIN_WIDTH,
  RulingModeDraftState,
  buildExecutorCandidates,
  clampRulingModalWidth,
  evaluateRulingSubmitState,
  mergeImpactedFiles,
  parseImpactedFilesInput,
  resolveAiRulingDraft,
  resolveDefaultExecutorId,
  resolveModalRulingDraft,
} from './rulingModalHelpers';

console.log('================================================================================');
console.log('🧪 ArbiterRulingModal 纯函数边界与 UI 组件渲染测试套件');
console.log('================================================================================');

function makeAgent(
  id: string,
  name: string,
  role: string,
  status: Agent['status'] = 'running'
): Agent {
  return {
    id,
    name,
    handle: `@${id}`,
    avatar: '🤖',
    role,
    description: role,
    color: 'blue',
    status,
    acpTransport: 'stdio',
    acpCommandOrUrl: 'mock-acp',
    protocolVersion: '2',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    workspace: { rootPath: '/tmp/ws', readOnly: false },
    skills: [],
    memory: { shortTermEnabled: true, longTermEnabled: false },
  } as unknown as Agent;
}

function makeTopic(overrides: Partial<TopicMessageData> = {}): TopicMessageData {
  return {
    id: 'topic-ruling-1',
    scopeType: 'channel',
    channelId: 'ch-1',
    workspaceBindingId: 'ws-1',
    title: '告警值班台首页方案讨论',
    description: '围绕值班台首页架构、容灾及状态一致性进行 4+1 博弈推演。',
    status: 'open',
    discussionMode: 'game_theoretic',
    gameRoles: {
      proposers: ['agent-proposer'],
      challengers: ['agent-challenger'],
      verifiers: ['agent-verifier'],
      arbiters: ['agent-arbiter'],
      humanIsArbiter: true,
    },
    authorId: 'user-norris',
    authorName: 'Norris',
    authorAvatar: 'N',
    timestamp: '14:30',
    repliesCount: 4,
    participatingAgentIds: [
      'agent-proposer',
      'agent-challenger',
      'agent-verifier',
      'agent-arbiter',
    ],
    gameTheoreticState: {
      currentStage: 'arbitration',
      targetProposalContent: '建立统一告警状态聚合流并在 Hero 与 Work 区展示实时值班指标。',
      targetChallengeContent: '边缘断线或成员列表为空时，缺乏降级兜底会导致首页白屏。',
      targetDefenseContent: '接受 6 项反例并新增防空态守卫与排序校验。',
      isChallengerResponded: true,
      rulingDraftOptions: {
        adopt_proposer: {
          decisionType: 'adopt_proposer',
          summary:
            '经博弈攻防审议与工程评估，准予采纳围绕“告警值班台首页方案讨论”的主导架构方案；提案方在答辩修正中已针对红队反例有效补齐了防御防线（接受 6 项反例并补全成员队列空态与排序校验）。',
          solution:
            '准予合并落地：全面执行提案方确立的核心设计路径；落地责任人须严格遵循答辩补丁中确认的防御性校验规则，并在工作区配置运行期健康监控探针。',
          tradeOffPoints: [
            '优先保障核心主线功能投产与研发吞吐效率，以防御补丁吸收边缘性能开销',
            '严格落地防御答辩中承诺的异常拦截机制，防范红队提出的【边界极端工况下的容灾与状态一致性隐患】工况',
          ],
          impactedFiles: [
            'artifacts/mod-3-acceptance.md',
            'M1/M2/AT/index.ts',
            'style/theme.css',
            'Hero/Banner.tsx',
            'Work/QueuePanel.tsx',
          ],
        },
        reject_rebuild: {
          decisionType: 'reject_rebuild',
          summary: '采纳红队反例，驳回现有方案并要求重写状态同步边界。',
          solution: '推倒现有轮询设计，改为事件驱动增量同步。',
          tradeOffPoints: ['以短期交付排期延后换取彻底消除竞态隐患'],
          impactedFiles: ['Work/QueuePanel.tsx'],
        },
        trade_off_matrix: {
          decisionType: 'trade_off_matrix',
          summary: '权衡分期方案：一期保留现网聚合模型并增加断线重连防线。',
          solution: '分两期推进并配备灰度开关。',
          tradeOffPoints: ['一期控风险，二期再做底层拆分'],
          impactedFiles: ['Hero/Banner.tsx', 'Work/QueuePanel.tsx'],
        },
      },
      mcdaPayload: {
        criteria: [
          { id: 'c1', name: '稳定性与容灾能力', weight: 0.45 },
          { id: 'c2', name: '交付效率与可维护性', weight: 0.3 },
          { id: 'c3', name: '性能与响应延迟', weight: 0.15 },
          { id: 'c4', name: '改造成本', weight: 0.1 },
        ],
        computedWeights: {
          c1: 0.45,
          c2: 0.3,
          c3: 0.15,
          c4: 0.1,
        },
        consistencyPassed: true,
        consistencyIndex: 0.04,
        ranking: [
          {
            alternative: '方案 A+补丁：主导架构叠加红队防御防线',
            totalUtility: 0.89,
          },
        ],
      } as any,
    },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// 1. 纯函数测试矩阵
// -----------------------------------------------------------------------------
console.log('\n--- 1. 文件路径解析与合并 ---');
assert.deepEqual(parseImpactedFilesInput(''), []);
assert.deepEqual(parseImpactedFilesInput('   \n  , ， ; ； '), []);
assert.deepEqual(
  parseImpactedFilesInput(
    'src/a.ts, src/b.ts，src/c.ts\nsrc/d.ts\r\nsrc/e.ts; src/f.ts；src/a.ts'
  ),
  ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
);
assert.deepEqual(
  mergeImpactedFiles(['src/a.ts', 'src/b.ts'], [' src/b.ts ', 'src/c.ts', '']),
  ['src/a.ts', 'src/b.ts', 'src/c.ts']
);
console.log('✓ 英文/中文逗号、分号、换行符解析与保序去重通过');

console.log('\n--- 2. 弹窗宽度钳制 ---');
assert.equal(clampRulingModalWidth(RULING_MODAL_DEFAULT_WIDTH, 1440), 680);
assert.equal(clampRulingModalWidth(900, 1440), 900);
assert.equal(clampRulingModalWidth(2000, 1440), RULING_MODAL_MAX_WIDTH);
assert.equal(clampRulingModalWidth(300, 1440), RULING_MODAL_MIN_WIDTH);
assert.equal(clampRulingModalWidth(-100, 1440), RULING_MODAL_MIN_WIDTH);
assert.equal(clampRulingModalWidth(Number.NaN, 1440), RULING_MODAL_DEFAULT_WIDTH);
assert.equal(clampRulingModalWidth(800, 400), 376);
assert.equal(clampRulingModalWidth(Number.NaN, Number.NaN), RULING_MODAL_DEFAULT_WIDTH);
console.log('✓ 宽度钳制在常规/超宽/超窄/NaN 视口下全部正确');

console.log('\n--- 3. 默认执行人推导 ---');
const baseTopic = makeTopic();
assert.equal(resolveDefaultExecutorId(baseTopic, 'adopt_proposer'), 'agent-proposer');
assert.equal(resolveDefaultExecutorId(baseTopic, 'reject_rebuild'), 'agent-challenger');
assert.equal(resolveDefaultExecutorId(baseTopic, 'trade_off_matrix'), 'agent-proposer');
assert.equal(
  resolveDefaultExecutorId(
    makeTopic({
      gameRoles: {
        proposers: [],
        challengers: [],
        verifiers: [],
        arbiters: ['agent-arbiter'],
        humanIsArbiter: true,
      },
    }),
    'trade_off_matrix'
  ),
  'agent-arbiter'
);
assert.equal(resolveDefaultExecutorId(null, 'adopt_proposer'), '');
console.log('✓ 三种模式默认执行人推导与空角色回退通过');

console.log('\n--- 4. 三层草案解析与人类定制保留 ---');
const fromOptions = resolveAiRulingDraft(baseTopic, 'reject_rebuild');
assert.equal(fromOptions.isCustomized, false);
assert.match(fromOptions.summary, /驳回现有方案/);
assert.deepEqual(fromOptions.impactedFiles, ['Work/QueuePanel.tsx']);

const singleDraftOnlyTopic = makeTopic({
  gameTheoreticState: {
    currentStage: 'arbitration',
    rulingDraft: {
      decisionType: 'adopt_proposer',
      summary: '单一草案采纳总结',
      solution: '单一草案落地',
      tradeOffPoints: ['要点 A'],
      impactedFiles: ['src/single.ts', 'src/single.ts'],
    },
  },
});
const fromSingleMatch = resolveAiRulingDraft(singleDraftOnlyTopic, 'adopt_proposer');
assert.equal(fromSingleMatch.summary, '单一草案采纳总结');
assert.deepEqual(fromSingleMatch.impactedFiles, ['src/single.ts']);

const fromSynthFallback = resolveAiRulingDraft(singleDraftOnlyTopic, 'reject_rebuild');
assert.equal(fromSynthFallback.isCustomized, false);
assert.ok(fromSynthFallback.summary.length > 0);

const customMap: Partial<Record<RulingDecisionType, RulingModeDraftState>> = {
  adopt_proposer: {
    summary: '人类定制摘要',
    solution: '人类定制方案',
    impactedFiles: ['src/custom.ts'],
    tradeOffPoints: ['人类要点'],
    isCustomized: true,
  },
  reject_rebuild: {
    summary: '未修改缓存不应覆盖 AI 草案',
    solution: '',
    impactedFiles: [],
    tradeOffPoints: [],
    isCustomized: false,
  },
};
const resolvedCustom = resolveModalRulingDraft(baseTopic, 'adopt_proposer', customMap);
assert.equal(resolvedCustom.isCustomized, true);
assert.equal(resolvedCustom.summary, '人类定制摘要');
const resolvedNonCustom = resolveModalRulingDraft(baseTopic, 'reject_rebuild', customMap);
assert.equal(resolvedNonCustom.isCustomized, false);
assert.match(resolvedNonCustom.summary, /驳回现有方案/);
assert.equal(resolveAiRulingDraft(null, 'adopt_proposer').isCustomized, false);
console.log('✓ AI 多选项、单草案、实时合成及人类定制优先级通过');

console.log('\n--- 5. 结构化执行 Agent 候选列表 ---');
const agents: Agent[] = [
  makeAgent('agent-extra', 'ExtraHelper', '通用辅助工程师', 'idle'),
  makeAgent('agent-proposer', 'MyClaudeCode', 'G-Frame 提案架构师与工程落地负责人', 'running'),
  makeAgent('agent-challenger', 'GlmRedTeam', '安全对抗红队审计官', 'thinking'),
  makeAgent('agent-arbiter', 'GlmClaude-02', '综合裁定仲裁官', 'error'),
];
const activeExecs: ActiveAgentExecution[] = [
  {
    agentId: 'agent-challenger',
    agentName: 'GlmRedTeam',
    agentAvatar: '⚔️',
    threadId: 'ch-1',
    status: 'thinking',
    startedAt: Date.now(),
  },
];
const multiRoleTopic = makeTopic({
  participatingAgentIds: ['agent-proposer', 'agent-challenger', 'agent-arbiter'],
  gameRoles: {
    proposers: ['agent-proposer'],
    challengers: ['agent-challenger'],
    verifiers: ['agent-proposer'],
    arbiters: ['agent-arbiter'],
    humanIsArbiter: true,
  },
});
const candidates = buildExecutorCandidates(multiRoleTopic, agents, activeExecs);
assert.equal(candidates.length, 4);
assert.equal(candidates[0].isParticipant, true);
assert.equal(candidates[3].agent.id, 'agent-extra');
assert.equal(candidates[3].isParticipant, false);
assert.equal(candidates[3].availability, 'offline');
assert.deepEqual(candidates[0].gameRoles, ['proposer', 'verifier']);
assert.equal(candidates[0].availability, 'online');
assert.equal(candidates[1].availability, 'busy');
assert.equal(candidates[2].availability, 'offline');
// 确保绝不篡改原始 Agent 的 role 字符串
assert.equal(agents[1].role, 'G-Frame 提案架构师与工程落地负责人');
console.log('✓ 参与者优先排序、多博弈角色标记与在线/忙碌/离线状态检测通过');

console.log('\n--- 6. 门禁提交准入 2x2x2 全矩阵 ---');
const gateCases = [
  { quorum: true, consistency: true, exempt: false, expectReq: false, expectSubmit: true },
  { quorum: true, consistency: true, exempt: true, expectReq: false, expectSubmit: true },
  { quorum: false, consistency: true, exempt: false, expectReq: true, expectSubmit: false },
  { quorum: false, consistency: true, exempt: true, expectReq: true, expectSubmit: true },
  { quorum: true, consistency: false, exempt: false, expectReq: true, expectSubmit: false },
  { quorum: true, consistency: false, exempt: true, expectReq: true, expectSubmit: true },
  { quorum: false, consistency: false, exempt: false, expectReq: true, expectSubmit: false },
  { quorum: false, consistency: false, exempt: true, expectReq: true, expectSubmit: true },
];
for (const c of gateCases) {
  const res = evaluateRulingSubmitState({
    isChallengerQuorumMet: c.quorum,
    consistencyPassed: c.consistency,
    exemptionChecked: c.exempt,
  });
  assert.equal(res.requiresExemption, c.expectReq);
  assert.equal(res.canSubmit, c.expectSubmit);
}
console.log('✓ 门禁 8 种组合全部验证通过');

// -----------------------------------------------------------------------------
// 2. React SSR 渲染与 DOM 结构契约校验
// -----------------------------------------------------------------------------
console.log('\n--- 7. ArbiterRulingModal SSR 渲染与契约检查 ---');

const openHtml = renderToStaticMarkup(
  React.createElement(ArbiterRulingModal, {
    isOpen: true,
    topic: baseTopic,
    agents,
    allActiveExecutions: activeExecs,
    overlappingFiles: ['Hero/Banner.tsx'],
    initialRulingType: 'adopt_proposer',
    openVersion: 1,
    onClose: () => undefined,
    onResolveTopic: () => undefined,
  })
);

// 原生 <dialog> 语义校验
assert.ok(openHtml.includes('<dialog'));
assert.ok(openHtml.includes('aria-labelledby='));
assert.equal(openHtml.includes('role="dialog"'), false, '原生 dialog 禁止重复声明 role="dialog"');
assert.equal(openHtml.includes('aria-modal='), false, '原生 dialog 禁止重复声明 aria-modal');

// 宽度控制与拖拽手柄
assert.ok(openHtml.includes('role="separator"'));
assert.ok(openHtml.includes('宽屏视图'));
assert.ok(openHtml.includes('width:680px'));

// 三种裁决类型卡片与 aria-pressed
assert.ok(openHtml.includes('采纳主导'));
assert.ok(openHtml.includes('采纳挑战'));
assert.ok(openHtml.includes('权衡矩阵'));
assert.ok(openHtml.includes('aria-pressed="true"'));

// 自适应多行文本域，彻底根除 rows=2 / resize-none 截断缺陷
assert.ok(openHtml.includes('auto-grow-textarea'));
assert.ok(openHtml.includes('resize-y'));
assert.equal(openHtml.includes('rows="2"'), false, '禁止写死 rows=2 截断文本域');
assert.equal(openHtml.includes('resize-none'), false, '禁止锁死不可拉伸文本域');

// 权衡要点可编辑 & 受影响文件芯片标签化
assert.ok(openHtml.includes('点击要点即可直接编辑'));
assert.ok(openHtml.includes('artifacts/mod-3-acceptance.md'));
assert.ok(openHtml.includes('M1/M2/AT/index.ts'));
assert.ok(openHtml.includes('清空全部'));
assert.ok(openHtml.includes('并发文件重叠提示'));

// 自定义结构化执行 Agent 下拉触发器
assert.ok(openHtml.includes('role="combobox"'));
assert.ok(openHtml.includes('MyClaudeCode'));
assert.ok(openHtml.includes('提案官'));
assert.ok(openHtml.includes('在线就绪'));

// MCDA 预览与固定底部署名
assert.ok(openHtml.includes('MCDA 运筹最优最劣法 (BWM) 数学求解参考'));
assert.ok(openHtml.includes('署名：Norris_M5Pro (人类首席仲裁官)'));
assert.ok(openHtml.includes('协同仲裁：GlmClaude-02'));
assert.ok(openHtml.includes('敲响法槌并定案归档'));

// 验证门禁阻断态：一致性不达标 + 挑战方未达标
const blockedTopic = makeTopic({
  gameRoles: {
    proposers: ['agent-proposer'],
    challengers: ['agent-challenger'],
    verifiers: [],
    arbiters: [],
    humanIsArbiter: false,
  },
  gameTheoreticState: {
    ...baseTopic.gameTheoreticState!,
    isChallengerResponded: false,
    rulingDraftOptions: {
      ...baseTopic.gameTheoreticState!.rulingDraftOptions!,
      adopt_proposer: {
        decisionType: 'adopt_proposer',
        summary: '门禁阻塞测试摘要',
        solution: '门禁阻塞测试方案',
        tradeOffPoints: [],
        impactedFiles: [],
      },
    },
    mcdaPayload: {
      ...baseTopic.gameTheoreticState!.mcdaPayload!,
      consistencyPassed: false,
      consistencyIndex: 0.21,
    } as any,
  },
});

const blockedHtml = renderToStaticMarkup(
  React.createElement(ArbiterRulingModal, {
    isOpen: true,
    topic: blockedTopic,
    agents,
    initialRulingType: 'adopt_proposer',
    openVersion: 2,
    onClose: () => undefined,
    onResolveTopic: () => undefined,
  })
);

assert.ok(blockedHtml.includes('MCDA 运筹逻辑一致性未达标硬门禁'));
assert.ok(blockedHtml.includes('法定推演人数未达标告警'));
assert.ok(blockedHtml.includes('暂无提取的权衡要点'));
assert.ok(blockedHtml.includes('暂未指定受影响文件'));
assert.ok(blockedHtml.includes('署名：AI 综合仲裁组'));
assert.ok(blockedHtml.includes('disabled=""'));

// 验证关闭态不渲染表单正文
const closedHtml = renderToStaticMarkup(
  React.createElement(ArbiterRulingModal, {
    isOpen: false,
    topic: baseTopic,
    agents,
    initialRulingType: 'adopt_proposer',
    openVersion: 1,
    onClose: () => undefined,
    onResolveTopic: () => undefined,
  })
);
assert.ok(closedHtml.includes('<dialog'));
assert.equal(closedHtml.includes('敲响法槌并定案归档'), false);

console.log('✓ SSR 渲染、原生 dialog 契约、标签化路径、结构化选择器与门禁状态全部验证通过');
console.log('================================================================================');
console.log('🎉 ArbiterRulingModal 测试套件 100% 通过！');
console.log('================================================================================');
