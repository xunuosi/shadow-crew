import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agent, Message, SwarmMissionData, TopicPatchDiffItem } from '../types';
import {
  aggregateSwarmWorkerDiffs,
  areAllEnabledSwarmSubTasksFinished,
  buildFallbackSwarmPlan,
  buildSwarmDecompositionPrompt,
  buildSwarmLeadReducePrompt,
  buildSwarmMissionId,
  buildSwarmReduceRoomId,
  buildSwarmSubThreadId,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerRoomId,
  canAutoTriggerSwarmReduce,
  computeSwarmFileOverlaps,
  detectSwarmTriggerIntent,
  extractSwarmPlanFromText,
  isSwarmChildRoomId,
  resolveSwarmLeadAndWorkers,
  sanitizeHydratedSwarmMission,
  sanitizeSwarmIdSegment,
} from './swarmOrchestration';
import { buildAgentSessionKey } from './acpClient';
import { buildCrewRosterGuidance, buildCompositeSystemPrompt } from './agentCollaboration';
import { reconcileAndSanitizeMessages } from './dbClient';
import { SwarmMissionCard } from '../components/SwarmMissionCard';
import { MessageInput } from '../components/MessageInput';

function makeAgent(
  id: string,
  name: string,
  handle: string,
  status: Agent['status'] = 'running',
  role = 'Engineer'
): Agent {
  return {
    id,
    name,
    handle,
    avatar: '🤖',
    role,
    status,
    acpTransport: 'stdio',
    acpCommandOrUrl: 'npx acp',
    modelBadge: 'Gemini',
    isManagedByYou: true,
    capabilities: [],
    workspace: { rootPath: '/tmp/repo', activeFiles: [] },
    memory: { mode: 'none', autoGenerate: false },
  } as unknown as Agent;
}

const archAgent = makeAgent('agent-arch', 'Architect', '@arch', 'running', 'System Architect');
const apiAgent = makeAgent('agent-api', 'Backend', '@backend', 'running', 'Backend Engineer');
const uiAgent = makeAgent('agent-ui', 'Frontend', '@frontend', 'running', 'Frontend Engineer');
const offlineAgent = makeAgent('agent-off', 'OfflineQA', '@qa', 'idle', 'QA Engineer');
const channelAgents = [archAgent, apiAgent, uiAgent, offlineAgent];

let passed = 0;
function testCase(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('=== Swarm Orchestration Verification Suite ===');

// ---------------------------------------------------------------------------
// Group 1: Dual Trigger, Prompt Guidance & Zero False-Positive Q&A Guard
// ---------------------------------------------------------------------------
testCase('G1.1 detectSwarmTriggerIntent handles explicit toggle and /swarm prefix cleanly', () => {
  const slash = detectSwarmTriggerIntent('  /swarm @arch 重构登录鉴权系统  ', false);
  assert.equal(slash.isSwarmTrigger, true);
  assert.equal(slash.triggerMode, 'explicit');
  assert.equal(slash.hasSlashPrefix, true);
  assert.equal(slash.taskText, '@arch 重构登录鉴权系统');

  const emptySlash = detectSwarmTriggerIntent('/swarm   ', false);
  assert.equal(emptySlash.isSwarmTrigger, true);
  assert.equal(emptySlash.taskText, '');

  const toggle = detectSwarmTriggerIntent('帮我全栈拆解重构订单模块', true);
  assert.equal(toggle.isSwarmTrigger, true);
  assert.equal(toggle.triggerMode, 'explicit');
  assert.equal(toggle.hasSlashPrefix, false);
  assert.equal(toggle.taskText, '帮我全栈拆解重构订单模块');

  const normal = detectSwarmTriggerIntent('为什么 React hook 这里会报错？', false);
  assert.equal(normal.isSwarmTrigger, false);
  assert.equal(normal.triggerMode, 'autonomous');
});

testCase('G1.2 resolveSwarmLeadAndWorkers selects first mentioned or first online channel member', () => {
  const byMention = resolveSwarmLeadAndWorkers({
    candidateAgents: channelAgents,
    mentionedAgents: [uiAgent, apiAgent],
  });
  assert.equal(byMention.leadAgent?.id, uiAgent.id);
  assert.equal(
    byMention.workerCandidates.some((w) => w.id === uiAgent.id),
    false,
    'Multi-agent worker candidate list should exclude Lead when peers exist'
  );

  const byFirst = resolveSwarmLeadAndWorkers({
    candidateAgents: [archAgent, apiAgent],
    mentionedAgents: [],
  });
  assert.equal(byFirst.leadAgent?.id, archAgent.id);
  assert.deepEqual(
    byFirst.workerCandidates.map((a) => a.id),
    [apiAgent.id]
  );

  const singleOnly = resolveSwarmLeadAndWorkers({
    candidateAgents: [archAgent],
    mentionedAgents: [],
  });
  assert.equal(singleOnly.leadAgent?.id, archAgent.id);
  assert.deepEqual(singleOnly.workerCandidates.map((a) => a.id), [archAgent.id]);
});

testCase('G1.3 extractSwarmPlanFromText supports <<<SWARM_PLAN>>> and <swarm-plan> delimiters and strips raw JSON', () => {
  const rawDelim = `
我会把任务拆分为前端登录页与后端 JWT 鉴权两块并行推进。

<<<SWARM_PLAN>>>
{
  "sharedContractSummary": "统一采用 POST /api/auth/login，返回 { token, expiresAt }。",
  "subTasks": [
    {
      "taskId": "auth:backend/api",
      "title": "后端 JWT 鉴权接口",
      "description": "实现签发与验签中间件",
      "suggestedAgentHandle": "@backend",
      "allowedFiles": ["src/api/auth.ts", "src/middleware/jwt.ts"]
    },
    {
      "taskId": "auth frontend ui",
      "title": "前端登录表单与路由守卫",
      "description": "对接 /api/auth/login 并保存 token",
      "suggestedAgentHandle": "@frontend",
      "allowedFiles": ["src/pages/Login.tsx"]
    }
  ]
}
<<<SWARM_PLAN_END>>>
  `;

  const res = extractSwarmPlanFromText(rawDelim, {
    missionId: 'swarm_mission:01',
    roomId: 'thread-main-1',
    channelId: 'ch-dev',
    originalTask: '实现完整登录模块',
    triggerMode: 'explicit',
    leadAgent: archAgent,
    allChannelAgents: channelAgents,
  });

  assert.ok(res, 'Expected structured swarm plan');
  assert.equal(res.isFallback, false);
  assert.equal(res.plan.status, 'awaiting_approval');
  assert.equal(res.plan.triggerMode, 'explicit');
  assert.equal(res.plan.subTasks.length, 2);
  assert.equal(res.plan.subTasks[0].assignedAgentId, apiAgent.id);
  assert.equal(res.plan.subTasks[1].assignedAgentId, uiAgent.id);
  assert.equal(res.cleanedText.includes('<<<SWARM_PLAN>>>'), false);
  assert.equal(res.cleanedText.includes('subTasks'), false);
  assert.ok(/^[a-zA-Z0-9_-]+$/.test(res.plan.missionId));
  assert.ok(/^[a-zA-Z0-9_-]+$/.test(res.plan.subTasks[0].taskId));

  // Verify XML fallback syntax
  const rawXml = `已规划如下：<swarm-plan>{"sharedContractSummary":"shared","subTasks":[{"title":"Only UI","description":"Build button","suggestedAgentHandle":"frontend","allowedFiles":["src/Btn.tsx"]}]}</swarm-plan>`;
  const resXml = extractSwarmPlanFromText(rawXml, {
    roomId: 'thread-main-1',
    originalTask: 'UI tweak',
    triggerMode: 'autonomous',
    leadAgent: archAgent,
    allChannelAgents: channelAgents,
  });
  assert.ok(resXml);
  assert.equal(resXml.plan.triggerMode, 'autonomous');
  assert.equal(resXml.plan.subTasks[0].assignedAgentId, uiAgent.id);
});

testCase('G1.4 normal Q&A without <<<SWARM_PLAN>>> returns null (no autonomous false-positive), explicit mode uses fallback', () => {
  const normalQa = `这里可以用 \`useMemo\` 避免每次渲染重算。\n1. 把状态放进 ref\n2. 减少无效重渲染`;
  const autoResult = extractSwarmPlanFromText(normalQa, {
    roomId: 'thread-1',
    originalTask: '怎么优化 React 性能？',
    triggerMode: 'autonomous',
    leadAgent: archAgent,
    allChannelAgents: channelAgents,
  });
  assert.equal(autoResult, null, 'Autonomous Q&A reply must never be misclassified as a Swarm card');

  const malformedJson = `<<<SWARM_PLAN>>>{ broken json <<<SWARM_PLAN_END>>>`;
  assert.equal(
    extractSwarmPlanFromText(malformedJson, {
      roomId: 'thread-1',
      originalTask: 'task',
      triggerMode: 'autonomous',
      leadAgent: archAgent,
      allChannelAgents: channelAgents,
    }),
    null
  );

  // Explicit mode guarantees awaiting_approval fallback card when Lead forgets JSON
  const fallback = buildFallbackSwarmPlan(
    `1. **接口定义**：补全 REST Schema\n2. **前端对接**：更新列表视图`,
    {
      roomId: 'thread-1',
      originalTask: '全栈需求拆解',
      triggerMode: 'explicit',
      leadAgent: archAgent,
      allChannelAgents: channelAgents,
    }
  );
  assert.equal(fallback.isFallback, true);
  assert.equal(fallback.plan.status, 'awaiting_approval');
  assert.equal(fallback.plan.subTasks.length, 2);
});

testCase('G1.5 agentCollaboration roster & swarm decomposition prompt contain anti-abuse & read-only guardrails', () => {
  const roster = buildCrewRosterGuidance([archAgent, apiAgent], archAgent.id);
  assert.ok(roster.includes('<<<SWARM_PLAN>>>'));
  assert.ok(roster.includes('日常普通问答严禁滥用'));

  const decompPrompt = buildSwarmDecompositionPrompt({
    leadAgent: archAgent,
    availableAgents: [archAgent, apiAgent, uiAgent],
    taskText: '开发多租户权限系统',
  });
  assert.ok(decompPrompt.includes('只拆解、不动手'));
  assert.ok(decompPrompt.includes('@backend'));
  assert.ok(decompPrompt.includes('@frontend'));
  assert.ok(decompPrompt.includes('<<<SWARM_PLAN>>>'));

  // Make sure composite prompt remains intact
  const sysPrompt = buildCompositeSystemPrompt({
    agent: archAgent,
    availableAgents: [archAgent, apiAgent],
    includeRoster: true,
  });
  assert.ok(sysPrompt.includes('<<<SWARM_PLAN>>>'));
});

// ---------------------------------------------------------------------------
// Group 2: Confirmation Gate, Overlap Detection & Session Key Security
// ---------------------------------------------------------------------------
testCase('G2.1 computeSwarmFileOverlaps detects exact and directory prefix collisions only on enabled subtasks', () => {
  const tasks = computeSwarmFileOverlaps([
    {
      taskId: 't1',
      title: 'T1',
      description: 'D1',
      assignedAgentId: apiAgent.id,
      enabled: true,
      allowedFiles: ['src/api', 'src/types.ts'],
      status: 'pending',
    },
    {
      taskId: 't2',
      title: 'T2',
      description: 'D2',
      assignedAgentId: uiAgent.id,
      enabled: true,
      allowedFiles: ['src/api/auth.ts', 'src/components/Form.tsx'],
      status: 'pending',
    },
    {
      taskId: 't3',
      title: 'T3 disabled',
      description: 'D3',
      assignedAgentId: archAgent.id,
      enabled: false,
      allowedFiles: ['src/types.ts'],
      status: 'pending',
    },
  ]);

  assert.deepEqual(tasks[0].overlappingFiles, ['src/api'], 'src/api overlaps src/api/auth.ts; src/types.ts excluded because t3 is disabled');
  assert.deepEqual(tasks[1].overlappingFiles, ['src/api/auth.ts']);
  assert.equal(tasks[2].overlappingFiles, undefined);
});

testCase('G2.2 session keys generated for isolated swarm rooms pass acpClient segment validation', () => {
  const missionId = sanitizeSwarmIdSegment(buildSwarmMissionId(1700000000000));
  const parentRoomId = 'thread-channel-alpha';
  const workerRoomId = buildSwarmWorkerRoomId(parentRoomId, 'task:api/v2..hack');
  const reduceRoomId = buildSwarmReduceRoomId(parentRoomId, missionId);

  assert.equal(isSwarmChildRoomId(parentRoomId, workerRoomId), true);
  assert.equal(isSwarmChildRoomId(parentRoomId, reduceRoomId), true);
  assert.equal(isSwarmChildRoomId(parentRoomId, parentRoomId), false);

  const workerKey = buildAgentSessionKey({
    agentId: apiAgent.id,
    roomId: workerRoomId,
    channelId: 'ch-1',
    scopeType: 'channel',
    discussionMode: 'standard',
  });
  const reduceKey = buildAgentSessionKey({
    agentId: archAgent.id,
    roomId: reduceRoomId,
    channelId: 'ch-1',
    scopeType: 'channel',
    discussionMode: 'standard',
  });

  assert.ok(workerKey.includes(workerRoomId));
  assert.ok(reduceKey.includes(reduceRoomId));
  assert.notEqual(workerKey, reduceKey);
});

// ---------------------------------------------------------------------------
// Group 3: Pure Parallel Worker Prompt Isolation
// ---------------------------------------------------------------------------
testCase('G3.1 buildSwarmWorkerPrompt isolates worker from sibling transcripts and forbids lateral @mentions', () => {
  const mission: SwarmMissionData = {
    missionId: 'swarm-m1',
    roomId: 'thread-1',
    channelId: 'ch-1',
    originalTask: '重构支付系统并补充前端支付表单',
    triggerMode: 'explicit',
    leadAgentId: archAgent.id,
    sharedContractSummary: 'CreatePaymentResponse = { orderId: string; payUrl: string }',
    status: 'running_workers',
    subTasks: [
      {
        taskId: 'backend-pay',
        title: '支付下单接口',
        description: '编写 POST /api/pay 处理器',
        assignedAgentId: apiAgent.id,
        enabled: true,
        allowedFiles: ['src/api/pay.ts'],
        status: 'running',
        subThreadId: buildSwarmSubThreadId('swarm-m1', 'backend-pay'),
      },
      {
        taskId: 'frontend-pay',
        title: '支付模态窗表单',
        description: '调用 POST /api/pay',
        assignedAgentId: uiAgent.id,
        enabled: true,
        allowedFiles: ['src/components/PayModal.tsx'],
        status: 'completed',
        resultSummary: 'SECRET_SIBLING_INTERNAL_NOTE_DO_NOT_LEAK',
      },
    ],
    createdAt: Date.now(),
  };

  const prompt = buildSwarmWorkerPrompt({
    mission,
    subTask: mission.subTasks[0],
    workerAgent: apiAgent,
    leadAgent: archAgent,
  });

  assert.ok(prompt.includes('支付下单接口'));
  assert.ok(prompt.includes('CreatePaymentResponse'));
  assert.ok(prompt.includes('src/api/pay.ts'));
  assert.ok(prompt.includes('禁止横向 @ 级联'));
  assert.equal(
    prompt.includes('SECRET_SIBLING_INTERNAL_NOTE_DO_NOT_LEAK'),
    false,
    'Worker prompt must never leak sibling worker output'
  );
  assert.equal(
    prompt.includes('支付模态窗表单'),
    false,
    'Worker prompt must not contain sibling task details'
  );
});

// ---------------------------------------------------------------------------
// Group 4: Partial Fault Tolerance & Auto-Reduce Gate
// ---------------------------------------------------------------------------
testCase('G4.1 canAutoTriggerSwarmReduce blocks on failed/aborted subtasks and unlocks once skipped or retried', () => {
  const baseTasks: SwarmMissionData['subTasks'] = [
    {
      taskId: 'w1',
      title: 'W1',
      description: 'D1',
      assignedAgentId: apiAgent.id,
      enabled: true,
      status: 'completed',
    },
    {
      taskId: 'w2',
      title: 'W2',
      description: 'D2',
      assignedAgentId: uiAgent.id,
      enabled: true,
      status: 'aborted',
    },
    {
      taskId: 'w3',
      title: 'W3 disabled',
      description: 'D3',
      assignedAgentId: archAgent.id,
      enabled: false,
      status: 'pending',
    },
  ];

  // Aborted task finishes execution loop, but blocks automatic Reduce
  assert.equal(areAllEnabledSwarmSubTasksFinished(baseTasks), true);
  assert.equal(canAutoTriggerSwarmReduce(baseTasks), false);

  // User skips aborted task -> W1 completed + W2 skipped => auto-trigger Reduce!
  const afterSkip = baseTasks.map((t) =>
    t.taskId === 'w2' ? { ...t, status: 'skipped' as const } : t
  );
  assert.equal(canAutoTriggerSwarmReduce(afterSkip), true);

  // Edge case: all enabled tasks skipped -> 0 completed => must NOT auto-reduce
  const allSkipped = afterSkip.map((t) =>
    t.enabled ? { ...t, status: 'skipped' as const } : t
  );
  assert.equal(canAutoTriggerSwarmReduce(allSkipped), false);
});

// ---------------------------------------------------------------------------
// Group 5: Map-Reduce Lead Prompt & Multi-Worker Diff Aggregation
// ---------------------------------------------------------------------------
testCase('G5.1 buildSwarmLeadReducePrompt & aggregateSwarmWorkerDiffs merge diffs by filename with Lead override', () => {
  const diffApiA: TopicPatchDiffItem = {
    filename: 'src/api/auth.ts',
    additions: 40,
    deletions: 5,
    diff: '+ export function login() {}',
  };
  const diffUi: TopicPatchDiffItem = {
    filename: 'src/components/Login.tsx',
    additions: 30,
    deletions: 2,
    diff: '+ export const Login = () => null;',
  };
  const diffLeadOverride: TopicPatchDiffItem = {
    filename: 'src/api/auth.ts',
    additions: 45,
    deletions: 5,
    diff: '+ export function login() { /* integrated */ }',
  };

  const mission: SwarmMissionData = {
    missionId: 'swarm-m2',
    roomId: 'thread-2',
    originalTask: '实现端到端登录',
    triggerMode: 'explicit',
    leadAgentId: archAgent.id,
    sharedContractSummary: 'Token in Authorization header',
    status: 'reducing',
    subTasks: [
      {
        taskId: 'be',
        title: '后端登录',
        description: 'auth api',
        assignedAgentId: apiAgent.id,
        enabled: true,
        status: 'completed',
        durationMs: 1250,
        resultSummary: '已交付 auth.ts 接口',
        generatedDiffs: [diffApiA],
      },
      {
        taskId: 'fe',
        title: '前端表单',
        description: 'login ui',
        assignedAgentId: uiAgent.id,
        enabled: true,
        status: 'completed',
        durationMs: 980,
        resultSummary: '已交付 Login.tsx 表单',
        generatedDiffs: [diffUi],
      },
      {
        taskId: 'qa',
        title: '手工测试脚本',
        description: 'skip',
        assignedAgentId: offlineAgent.id,
        enabled: true,
        status: 'skipped',
        errorMessage: '用户跳过',
      },
    ],
    createdAt: Date.now(),
  };

  const reducePrompt = buildSwarmLeadReducePrompt({
    mission,
    leadAgent: archAgent,
    agents: channelAgents,
  });

  assert.ok(reducePrompt.includes('swarm-worker-reports'));
  assert.ok(reducePrompt.includes('已交付 auth.ts 接口'));
  assert.ok(reducePrompt.includes('src/components/Login.tsx (+30/-2)'));
  assert.ok(reducePrompt.includes('【已跳过】'));

  const merged = aggregateSwarmWorkerDiffs(mission.subTasks, [diffLeadOverride]);
  assert.equal(merged.length, 2);
  const authDiff = merged.find((d) => d.filename === 'src/api/auth.ts');
  assert.equal(authDiff?.additions, 45, 'Lead integration diff must override older worker diff on same filename');
});

// ---------------------------------------------------------------------------
// Group 6: Persistence & Restart Recovery Hygiene
// ---------------------------------------------------------------------------
testCase('G6.1 sanitizeHydratedSwarmMission converts interrupted running tasks and persists through reconcileAndSanitizeMessages', () => {
  const dirtyMission: SwarmMissionData = {
    missionId: 'swarm-restart',
    roomId: 'thread-3',
    originalTask: '大重构',
    triggerMode: 'explicit',
    leadAgentId: archAgent.id,
    sharedContractSummary: 'Contract',
    status: 'reducing',
    subTasks: [
      {
        taskId: 't1',
        title: 'Done task',
        description: 'done',
        assignedAgentId: apiAgent.id,
        enabled: true,
        status: 'completed',
      },
      {
        taskId: 't2',
        title: 'Running before refresh',
        description: 'was running',
        assignedAgentId: uiAgent.id,
        enabled: true,
        status: 'running',
      },
    ],
    createdAt: Date.now(),
  };

  const sanitized = sanitizeHydratedSwarmMission(dirtyMission)!;
  assert.equal(sanitized.status, 'running_workers', 'Interrupted reducing mission recovers to running_workers with actionable prompt');
  assert.ok(sanitized.reduceError);
  assert.equal(sanitized.subTasks[0].status, 'completed');
  assert.equal(sanitized.subTasks[1].status, 'aborted', 'In-flight running subtask becomes aborted on reload');

  const persistedMsg: Message = {
    id: 'msg-swarm-persist-1',
    threadId: 'thread-3',
    channelId: 'ch-1',
    authorId: archAgent.id,
    authorName: archAgent.name,
    authorHandle: archAgent.handle,
    authorAvatar: archAgent.avatar,
    isAgent: true,
    timestamp: '10:00',
    content: 'Swarm 方案',
    swarmMission: sanitized,
  };

  const { sanitized: dbCleaned } = reconcileAndSanitizeMessages([persistedMsg]);
  assert.equal(dbCleaned.length, 1);
  assert.equal(dbCleaned[0].swarmMission?.missionId, 'swarm-restart');
  assert.equal(dbCleaned[0].swarmMission?.subTasks[1].status, 'aborted');
});

// ---------------------------------------------------------------------------
// Group 7: React UI Rendering Verification across All Mission States + Composer
// ---------------------------------------------------------------------------
testCase('G7.1 SwarmMissionCard renders all 5 states cleanly without runtime errors, and MessageInput hides Swarm in DM', () => {
  const states: SwarmMissionData['status'][] = [
    'awaiting_approval',
    'running_workers',
    'reducing',
    'completed',
    'cancelled',
  ];

  for (const st of states) {
    const mission: SwarmMissionData = {
      missionId: `ui-${st}`,
      roomId: 'thread-ui',
      channelId: 'ch-ui',
      originalTask: 'UI 测试任务',
      triggerMode: 'explicit',
      leadAgentId: archAgent.id,
      sharedContractSummary: 'Shared API v1',
      status: st,
      finalSynthesis: st === 'completed' ? '### 验收通过\n全部子任务交付符合契约。' : undefined,
      aggregatedDiffs:
        st === 'completed'
          ? [{ filename: 'src/demo.ts', additions: 10, deletions: 2, diff: '+ code' }]
          : undefined,
      subTasks: [
        {
          taskId: 'sub-1',
          title: '子任务 A',
          description: '完成接口层',
          assignedAgentId: apiAgent.id,
          enabled: true,
          allowedFiles: ['src/api/a.ts'],
          overlappingFiles: st === 'awaiting_approval' ? ['src/api/a.ts'] : undefined,
          status: st === 'awaiting_approval' ? 'pending' : st === 'running_workers' ? 'running' : 'completed',
          subThreadId: 'swarm-sub-ui-sub-1',
        },
      ],
      createdAt: Date.now(),
    };

    const html = renderToStaticMarkup(
      React.createElement(SwarmMissionCard, {
        roomId: 'thread-ui',
        messageId: `msg-${st}`,
        mission,
        agents: channelAgents,
        channelAgents,
        onOpenSubThread: () => {},
        onOpenCodexDiff: () => {},
      })
    );
    assert.ok(html.includes('data-testid="swarm-mission-card"'));
    assert.ok(html.includes(`data-swarm-status="${st}"`));
    if (st === 'awaiting_approval') {
      assert.ok(html.includes('data-testid="swarm-confirm-dispatch"'));
      assert.ok(html.includes('重新拆解'));
    }
    if (st === 'completed') {
      assert.ok(html.includes('一键合入工作区'));
      assert.ok(html.includes('src/demo.ts'));
    }
  }

  const channelComposerHtml = renderToStaticMarkup(
    React.createElement(MessageInput, {
      onSendMessage: () => {},
      activeAgents: channelAgents,
      channelName: 'dev-channel',
      isDm: false,
    })
  );
  assert.ok(
    channelComposerHtml.includes('data-testid="composer-swarm-toggle"'),
    'Channel composer must show Swarm toggle pill'
  );

  const dmComposerHtml = renderToStaticMarkup(
    React.createElement(MessageInput, {
      onSendMessage: () => {},
      activeAgents: [archAgent],
      channelName: 'dm',
      isDm: true,
    })
  );
  assert.equal(
    dmComposerHtml.includes('data-testid="composer-swarm-toggle"'),
    false,
    'DM composer must NOT expose Swarm toggle pill'
  );
});

console.log(`=== All ${passed} Swarm orchestration & UI tests passed ===`);
