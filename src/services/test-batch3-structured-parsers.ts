import assert from 'node:assert/strict';
import {
  foldMessageContentToTokenBudget,
  extractStructuredMemoryKeyPoints,
  isValidMicroAgentSummary,
} from './llmService';
import {
  detectSwarmTriggerIntent,
  extractSwarmPlanFromText,
  buildFallbackSwarmPlan,
} from './swarmOrchestration';
import { INITIAL_AGENTS } from '../data/mockData';

function runTests() {
  // 1. <compacted-summary> deterministic folding
  const longSummary = `<compacted-summary mode="micro-llm">\n• 【架构与技术决议】：${'采用双通道协议与确定性状态机，'.repeat(30)}\n</compacted-summary>`;
  const folded = foldMessageContentToTokenBudget(longSummary, 45);
  assert.ok(folded.includes('<compacted-summary mode="micro-llm">'), 'Should preserve opening tag with mode');
  assert.ok(folded.includes('</compacted-summary>'), 'Should preserve closing tag');

  // 2. extractStructuredMemoryKeyPoints deterministic nested + sentence classification
  const points = extractStructuredMemoryKeyPoints([
    {
      role: 'assistant',
      content: '<compacted-summary mode="rule">\n• 【架构与技术决议】：统一采用 MCP 结构化工具\n</compacted-summary>',
    },
    {
      role: 'user',
      content: '系统存在死锁风险需要排查。核心参数超时阈值限制为 300s。目前已完成回归测试并合入主干。',
    },
  ]);
  assert.ok(points.decisions.some((d) => d.includes('统一采用 MCP 结构化工具')));
  assert.ok(points.risksAndTodos.some((r) => r.includes('死锁风险')));
  assert.ok(points.constraints.some((c) => c.includes('超时阈值限制')));
  assert.ok(points.deliverables.some((d) => d.includes('已完成回归测试')));

  // 3. isValidMicroAgentSummary deterministic validation
  assert.equal(isValidMicroAgentSummary('{"error":{"message":"rate limit"}}'), false);
  assert.equal(isValidMicroAgentSummary('HTTP 429 Too Many Requests from upstream gateway'), false);
  assert.equal(isValidMicroAgentSummary('抱歉，我无法总结上述技术讨论内容，因为信息不足。'), false);
  assert.equal(
    isValidMicroAgentSummary('今天大家讨论了很多架构和参数，但是没有形成任何结构化条目。'),
    false
  );
  assert.equal(
    isValidMicroAgentSummary('• **【架构与技术决议】**：统一使用确定性 AST 解析器替代正则匹配。'),
    true
  );

  // 4. Swarm slash command, delimited JSON extraction, and fallback list parsing
  const slashIntent = detectSwarmTriggerIntent('/swarm   拆解前端状态管理重构');
  assert.equal(slashIntent.isSwarmTrigger, true);
  assert.equal(slashIntent.hasSlashPrefix, true);
  assert.equal(slashIntent.taskText, '拆解前端状态管理重构');

  const nonSlash = detectSwarmTriggerIntent('/swarming is not a command', false);
  assert.equal(nonSlash.hasSlashPrefix, false);
  assert.equal(nonSlash.isSwarmTrigger, false);

  const leadAgent = INITIAL_AGENTS[0];
  const workerA = INITIAL_AGENTS[1] || INITIAL_AGENTS[0];
  const plan = extractSwarmPlanFromText(
    [
      '已为您拆解为并行子任务：',
      '<swarm-plan>',
      '```json',
      JSON.stringify({
        goal: '重构解析模块',
        subTasks: [
          {
            id: 't1',
            title: '重构 llmService',
            description: '移除正则启发式并保持摘要标签完整性',
            assigneeAgentId: workerA.id,
            allowedFiles: ['src/services/llmService.ts'],
          },
        ],
      }),
      '```',
      '</swarm-plan>',
    ].join('\n'),
    {
      roomId: 'room-batch3-test',
      originalTask: '重构解析模块',
      leadAgent,
      allChannelAgents: INITIAL_AGENTS,
      triggerMode: 'explicit',
    }
  );
  assert.ok(plan !== null, 'Should extract <swarm-plan> JSON block');
  assert.equal(plan.plan.subTasks.length, 1);
  assert.equal(plan.plan.subTasks[0].title, '重构 llmService');

  const fallbackPlan = buildFallbackSwarmPlan(
    '1. **协议边界收敛**：替换 HTTP 状态覆盖启发式\n- **Diff 解析重构**：使用 hunk 行序列校验',
    {
      roomId: 'room-batch3-test',
      originalTask: '协议边界与 Diff 重构',
      leadAgent,
      allChannelAgents: INITIAL_AGENTS,
      triggerMode: 'explicit',
    }
  );
  assert.equal(fallbackPlan.plan.subTasks.length, 2);
  assert.equal(fallbackPlan.plan.subTasks[0].title, '协议边界收敛');
  assert.equal(fallbackPlan.plan.subTasks[1].title, 'Diff 解析重构');

  console.log('✅ test-batch3-structured-parsers passed all assertions');
}

runTests();
