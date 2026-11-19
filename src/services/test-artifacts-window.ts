import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildScopeArtifactEntries,
  classifyDiskArtifactTier,
  collectScopeExtraFilePaths,
  extractScopeModuleOptions,
  filterArtifactEntries,
  openDirectoryInFileManager,
  resolveFallbackPrimaryDir,
  revealArtifactInFileManager,
  type ArtifactsScopeDescriptor,
  type DiskArtifactFile,
  type ScopeArtifactsScanResult,
} from './artifactsService';
import { ArtifactsWindowModal } from '../components/artifacts/ArtifactsWindowModal';
import type { Message, SwarmMissionData, TopicMessageData } from '../types';

function createDiskFile(partial: Partial<DiskArtifactFile> & { name: string; category: DiskArtifactFile['category'] }): DiskArtifactFile {
  const rel = partial.relativePath || partial.name;
  const fullPath = partial.fullPath || `/Users/tester/.shadow-crew/topics/topic-1/${partial.category}/${rel}`;
  return {
    id: partial.id || `disk:${partial.category}:${fullPath}`,
    name: partial.name,
    relativePath: rel,
    fullPath,
    category: partial.category,
    sizeBytes: partial.sizeBytes ?? 1024,
    modifiedAt: partial.modifiedAt ?? 1795071136000,
    ext: partial.ext ?? (partial.name.includes('.') ? partial.name.split('.').pop()!.toLowerCase() : ''),
  };
}

function testDiskTierClassification() {
  const finalAdr = createDiskFile({ name: 'ADR-final.md', category: 'artifacts' });
  assert.equal(classifyDiskArtifactTier(finalAdr), 'final');

  const intermediateSubdir = createDiskFile({
    name: 'stage-1.md',
    relativePath: 'intermediate/stage-1.md',
    category: 'artifacts',
  });
  assert.equal(classifyDiskArtifactTier(intermediateSubdir), 'intermediate');

  const draftsSubdir = createDiskFile({
    name: 'draft-v1.md',
    relativePath: 'DRAFTS/draft-v1.md',
    category: 'artifacts',
  });
  assert.equal(classifyDiskArtifactTier(draftsSubdir), 'intermediate');

  const scratchFile = createDiskFile({ name: 'scratch-notes.txt', category: 'scratch' });
  assert.equal(classifyDiskArtifactTier(scratchFile), 'intermediate');

  const workspaceDraft = createDiskFile({
    name: 'temp-patch.ts',
    fullPath: '/repo/src/temp-patch.ts',
    relativePath: 'src/temp-patch.ts',
    category: 'workspace',
  });
  assert.equal(classifyDiskArtifactTier(workspaceDraft), 'intermediate');

  const workspaceApplied = createDiskFile({
    name: 'applied.ts',
    fullPath: '/repo/src/applied.ts',
    relativePath: 'src/applied.ts',
    category: 'workspace',
  });
  assert.equal(
    classifyDiskArtifactTier(workspaceApplied, {
      appliedFilePaths: new Set(['/repo/src/applied.ts']),
    }),
    'final'
  );

  const pendingArtifactFile = createDiskFile({
    name: 'candidate.diff',
    fullPath: '/repo/artifacts/candidate.diff',
    relativePath: 'candidate.diff',
    category: 'artifacts',
  });
  assert.equal(
    classifyDiskArtifactTier(pendingArtifactFile, {
      pendingFilePaths: new Set(['/repo/artifacts/candidate.diff']),
    }),
    'intermediate'
  );
}

function createSampleTopicAndMessages(): {
  topic: TopicMessageData;
  messages: Message[];
  swarmMission: SwarmMissionData;
  diskScan: ScopeArtifactsScanResult;
} {
  const swarmMission: SwarmMissionData = {
    missionId: 'swarm-m-1',
    roomId: 'topic-1',
    channelId: 'chan-1',
    originalTask: '实现分布式限流器并输出压测报告',
    triggerMode: 'explicit',
    leadAgentId: 'agent-lead',
    sharedContractSummary: 'RateLimiter interface + sliding window contract',
    status: 'completed',
    finalSynthesis: '# Swarm 合流总结\n已完成多模块实现并验证通过。',
    aggregatedDiffs: [
      {
        filename: 'src/limiter.ts',
        additions: 42,
        deletions: 4,
        diff: '@@ -1,2 +1,4 @@\n+export const LIMIT = 100;',
        applied: true,
        targetPath: '/repo/src/limiter.ts',
      },
    ],
    patchApplied: true,
    createdAt: 1795070000000,
    completedAt: 1795070500000,
    subTasks: [
      {
        taskId: 'sub-1',
        title: 'Redis Lua 原子限流脚本',
        description: '实现滑动窗口 Lua 脚本',
        assignedAgentId: 'agent-worker-1',
        enabled: true,
        status: 'completed',
        resultSummary: '已编写 sliding_window.lua 与边界单测。',
        finishedAt: 1795070200000,
      },
    ],
  };

  const topic: TopicMessageData = {
    id: 'topic-1',
    scopeType: 'channel',
    channelId: 'chan-1',
    workspaceBindingId: 'wb-topic-1',
    title: '高并发限流架构方案裁决',
    description: '对比令牌桶与滑动窗口并输出终局 ADR',
    status: 'resolved',
    discussionMode: 'game_theoretic',
    gameStage: 'concluded',
    authorId: 'user-norris',
    authorName: 'Norris',
    authorAvatar: 'N',
    timestamp: '2026-11-19T10:00:00Z',
    repliesCount: 5,
    participatingAgentIds: ['agent-1', 'agent-2'],
    rulingRecord: {
      decisionType: 'adopt_proposer',
      arbiterId: 'agent-arbiter',
      arbiterName: '综合仲裁官',
      summary: '采纳滑动窗口 + Redis Lua 方案，确保毫秒级精准限流。',
      solution: '部署 sliding_window.lua 并开启降级熔断。',
      impactedFiles: ['src/limiter.ts', 'docs/rate-limit-adr.md'],
      decidedAt: '2026-11-19T10:20:00Z',
      livingAdrMarkdown: '# Living ADR-001\n\n采纳精确滑动窗口架构方案。',
    },
    gameTheoreticState: {
      currentStage: 'concluded',
      targetProposalContent: '## 立论方案\n基于 Redis ZSET 的滑动窗口实现。',
      targetChallengeContent: '## 红队质询\n冷启动内存尖峰风险。',
      targetVerificationContent: '## 物理接地验证\n压测通过 P99 < 2ms。',
      targetDefenseContent: '## 答辩修正\n补充按 tenant 分片过期策略。',
      executionStatus: 'applied',
      executionSummary: '已完成全部补丁合入与基准检验。',
      executionDiffs: [
        {
          filename: 'src/limiter.ts',
          additions: 30,
          deletions: 2,
          diff: '--- a/src/limiter.ts\n+++ b/src/limiter.ts\n@@ -1,1 +1,2 @@\n+export const ok = true;',
          applied: true,
          targetPath: '/repo/src/limiter.ts',
        },
        {
          filename: 'src/fallback-draft.ts',
          additions: 12,
          deletions: 0,
          diff: '--- a/src/fallback-draft.ts\n+++ b/src/fallback-draft.ts\n@@ -0,0 +1,1 @@\n+// draft',
          applied: false,
          targetPath: '/repo/src/fallback-draft.ts',
        },
      ],
      modularState: {
        enabled: true,
        sharedContract: {
          contractVersion: 1,
          summary: 'RateLimiter 接口签名与指标不变量',
          typeSignatures: 'export interface RateLimiter { allow(key: string): Promise<boolean>; }',
          invariants: ['P99 < 3ms', 'No silent bypass on Redis timeout'],
          lockedAt: '2026-11-19T10:05:00Z',
        },
        modules: [
          {
            moduleId: 'mod-1-lua',
            title: '模块 1：Lua 脚本核心',
            responsibility: '原子滑动窗口限流逻辑',
            allowedFiles: ['src/limiter.ts'],
            dependsOnModuleIds: [],
            complexityLevel: 'high_critical',
            status: 'frozen',
            belief: {
              priorRisk: 0.4,
              posteriorRisk: 0.15,
              routingMode: 'deep_debate',
              feedbackVector: {
                contractViolations: 0,
                verifiedClaims: 3,
                refutedClaims: 0,
                edgeCaseCount: 1,
                dssScore: 0.1,
              },
              lastUpdatedAt: '2026-11-19T10:15:00Z',
            },
            scopedMessageIds: ['msg-1'],
            frozenProposalSnippet: '使用 Redis ZREMRANGEBYSCORE + ZCARD 原子执行',
            executionStatus: 'completed',
            executionSummary: '模块 1 已通过压测校验。',
          },
        ],
      },
    },
  };

  const messages: Message[] = [
    {
      id: 'msg-1',
      threadId: 'topic-1',
      channelId: 'chan-1',
      authorId: 'agent-1',
      authorName: '提案架构师',
      authorHandle: '@proposer',
      authorAvatar: 'P',
      isAgent: true,
      timestamp: '2026-11-19T10:06:00Z',
      content: '提交设计方案并附带参考图。',
      attachments: [
        {
          id: 'att-1',
          kind: 'image',
          name: 'architecture-diagram.png',
          mimeType: 'image/png',
          size: 20480,
          path: '/Users/tester/.shadow-crew/attachments/architecture-diagram.png',
        },
      ],
    },
    {
      id: 'msg-swarm',
      threadId: 'topic-1',
      channelId: 'chan-1',
      authorId: 'agent-lead',
      authorName: 'Swarm Lead',
      authorHandle: '@lead',
      authorAvatar: 'L',
      isAgent: true,
      timestamp: '2026-11-19T10:18:00Z',
      content: 'Swarm 任务合流完成。',
      swarmMission,
    },
  ];

  const diskScan: ScopeArtifactsScanResult = {
    primaryDir: '/Users/tester/.shadow-crew/channels/chan-1/topics/topic-1/artifacts',
    workspaceCwd: '/repo',
    scannedDirs: ['/Users/tester/.shadow-crew/channels/chan-1/topics/topic-1/artifacts'],
    warnings: [],
    files: [
      createDiskFile({
        name: 'final-benchmark-report.md',
        category: 'artifacts',
        fullPath: '/Users/tester/.shadow-crew/channels/chan-1/topics/topic-1/artifacts/final-benchmark-report.md',
      }),
      createDiskFile({
        name: 'scratch-log.txt',
        category: 'scratch',
        fullPath: '/Users/tester/.shadow-crew/channels/chan-1/topics/topic-1/scratch/scratch-log.txt',
      }),
      createDiskFile({
        // Same path as message_attachment -> must be deduplicated cleanly
        name: 'architecture-diagram.png',
        category: 'attachment',
        fullPath: '/Users/tester/.shadow-crew/attachments/architecture-diagram.png',
      }),
    ],
  };

  return { topic, messages, swarmMission, diskScan };
}

function testDualSourceAggregationAndFiltering() {
  const { topic, messages, swarmMission, diskScan } = createSampleTopicAndMessages();
  const scope: ArtifactsScopeDescriptor = {
    scopeType: 'topic',
    scopeId: topic.id,
    channelId: topic.channelId,
    title: topic.title,
    topicData: topic,
    messages,
    swarmMissions: [swarmMission],
  };

  // 1. Extra paths extraction skips http/data URLs and captures attachments/diffs/allowedFiles
  const extras = collectScopeExtraFilePaths(scope);
  assert.ok(extras.includes('/repo/src/limiter.ts'));
  assert.ok(extras.includes('/Users/tester/.shadow-crew/attachments/architecture-diagram.png'));

  // 2. Build merged entries
  const entries = buildScopeArtifactEntries(scope, diskScan);
  const finals = entries.filter((e) => e.tier === 'final');
  const intermediates = entries.filter((e) => e.tier === 'intermediate');

  assert.ok(finals.some((e) => e.id === 'topic-ruling:topic-1'), 'ADR ruling must be final');
  assert.ok(finals.some((e) => e.id === 'swarm-synth:swarm-m-1'), 'Swarm synthesis must be final');
  assert.ok(finals.some((e) => e.title === 'final-benchmark-report.md'), 'Artifacts dir file must be final');

  assert.ok(intermediates.some((e) => e.id === 'gframe-contract:topic-1'), 'G-Frame shared contract is intermediate');
  assert.ok(intermediates.some((e) => e.id === 'topic-stage:topic-1:challenge'), '4+1 challenge output is intermediate');
  assert.ok(intermediates.some((e) => e.id === 'swarm-task-summary:sub-1'), 'Swarm subtask output is intermediate');
  assert.ok(intermediates.some((e) => e.title === 'scratch-log.txt'), 'Scratch file is intermediate');

  // Pending unapplied diff must be intermediate; applied diff must be final
  assert.equal(
    entries.find((e) => e.id === 'topic-diff:topic-1:1:src/fallback-draft.ts')?.tier,
    'intermediate'
  );
  assert.equal(
    entries.find((e) => e.id === 'topic-diff:topic-1:0:src/limiter.ts')?.tier,
    'final'
  );

  // Deduplication: disk attachment duplicate must not produce two entries for architecture-diagram.png
  const attEntries = entries.filter((e) => e.title === 'architecture-diagram.png');
  assert.equal(attEntries.length, 1);
  assert.equal(attEntries[0].sourceKind, 'message_attachment');

  // Module filters
  const mods = extractScopeModuleOptions(entries);
  assert.ok(mods.some((m) => m.id === 'mod-1-lua'));
  assert.ok(mods.some((m) => m.id === 'swarm:swarm-m-1'));

  const luaOnly = filterArtifactEntries(entries, { tab: 'all', moduleId: 'mod-1-lua' });
  assert.ok(luaOnly.length >= 1);
  assert.ok(luaOnly.every((item) => item.moduleId === 'mod-1-lua'));

  const searchHits = filterArtifactEntries(entries, { tab: 'final', query: 'Living ADR' });
  assert.equal(searchHits.length, 1);
}

function testAllRemainingScopeResolutions() {
  const { topic, messages } = createSampleTopicAndMessages();
  const chanMsg: Message = {
    id: 'chan-msg-topic',
    threadId: 'chan-1',
    channelId: 'chan-1',
    type: 'topic',
    topicData: topic,
    authorId: 'user-norris',
    authorName: 'Norris',
    authorHandle: '@norris',
    authorAvatar: 'N',
    isAgent: false,
    timestamp: '2026-11-19T10:00:00Z',
    content: topic.title,
  };

  // Channel scope surfaces resolved topic ADR & applied diffs
  const chanEntries = buildScopeArtifactEntries(
    {
      scopeType: 'channel',
      scopeId: 'chan-1',
      channelId: 'chan-1',
      title: '#architecture',
      messages: [chanMsg],
    },
    null
  );
  assert.ok(chanEntries.some((e) => e.sourceKind === 'topic_ruling' && e.tier === 'final'));

  // DM & Agent fallback paths
  const agentDir = resolveFallbackPrimaryDir({
    scopeType: 'agent',
    scopeId: 'agent-codex',
    agentId: 'agent-codex',
    title: 'Codex',
  });
  assert.equal(agentDir.primaryDir, '~/.shadow-crew/agents/agent-codex/artifacts');

  const dmDir = resolveFallbackPrimaryDir({
    scopeType: 'dm',
    scopeId: 'thread-dm-claude',
    agentId: 'claude',
    title: 'Claude',
  });
  assert.equal(dmDir.primaryDir, '~/.shadow-crew/agents/claude/artifacts');

  // SubThread scope
  const subEntries = buildScopeArtifactEntries(
    {
      scopeType: 'subthread',
      scopeId: 'sub-thread-1',
      title: '边界单测分支',
      subThreadMessages: messages.slice(0, 1),
    },
    null
  );
  assert.equal(subEntries.length, 1);
  assert.equal(subEntries[0].tier, 'intermediate');

  // Swarm focused filtering
  const swarmOther: SwarmMissionData = {
    missionId: 'swarm-other',
    roomId: 'topic-1',
    originalTask: '无关任务',
    triggerMode: 'explicit',
    leadAgentId: 'agent-lead',
    sharedContractSummary: 'other',
    status: 'completed',
    finalSynthesis: 'other synthesis',
    createdAt: 1795070000000,
    subTasks: [],
  };
  const focusedSwarmEntries = buildScopeArtifactEntries(
    {
      scopeType: 'swarm',
      scopeId: 'topic-1',
      title: 'Swarm Test',
      swarmMissions: [swarmOther, ...messages.filter((m) => m.swarmMission).map((m) => m.swarmMission!)],
      focusedSwarmId: 'swarm-m-1',
    },
    null
  );
  assert.ok(!focusedSwarmEntries.some((e) => e.id.includes('swarm-other')));
  assert.ok(focusedSwarmEntries.some((e) => e.id === 'swarm-synth:swarm-m-1'));
}

async function testWebFallbackFileManagerHelpers() {
  const dirRes = await openDirectoryInFileManager('/tmp/test-artifacts');
  assert.equal(dirRes.ok, false);
  assert.equal(dirRes.desktopSupported, false);
  assert.equal(dirRes.resolvedPath, '/tmp/test-artifacts');

  const fileRes = await revealArtifactInFileManager('/tmp/test-artifacts/adr.md');
  assert.equal(fileRes.ok, false);
  assert.equal(fileRes.desktopSupported, false);
  assert.equal(fileRes.resolvedPath, '/tmp/test-artifacts/adr.md');
}

function testSsrAccessibilityAndDialogMarkup() {
  const { topic, messages, swarmMission, diskScan } = createSampleTopicAndMessages();
  const capturedErrors: string[] = [];
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map((a) => String(a)).join(' '));
  };

  let html = '';
  try {
    html = renderToStaticMarkup(
      React.createElement(ArtifactsWindowModal, {
        isOpen: true,
        scope: {
          scopeType: 'topic',
          scopeId: topic.id,
          channelId: topic.channelId,
          title: topic.title,
          topicData: topic,
          messages,
          swarmMissions: [swarmMission],
        },
        initialDiskScan: diskScan,
        onClose: () => {},
      })
    );
  } finally {
    console.error = origConsoleError;
  }

  assert.equal(
    capturedErrors.length,
    0,
    `SSR emitted unexpected console errors/warnings: ${capturedErrors.join(' | ')}`
  );

  // Native <dialog> compliance: must have <dialog>, MUST NOT have role="dialog" or aria-modal
  assert.ok(html.includes('<dialog'), 'Must render native <dialog> element');
  assert.ok(!html.includes('role="dialog"'), 'Native <dialog> must not add role="dialog"');
  assert.ok(!html.includes('aria-modal'), 'Native <dialog> must not add aria-modal');

  // Accessible tabs compliance: role="tablist", role="tab", aria-selected, NO aria-controls
  assert.ok(html.includes('role="tablist"'), 'Must render role="tablist"');
  assert.ok(html.includes('role="tab"'), 'Must render role="tab"');
  assert.ok(html.includes('aria-selected='), 'Tabs must declare aria-selected');
  assert.ok(!html.includes('aria-controls='), 'Tabs must omit aria-controls');
  assert.ok(html.includes('role="tabpanel"'), 'Must render role="tabpanel"');

  // Core UI elements present
  assert.ok(html.includes('最终产物'), 'Must render final artifacts tab');
  assert.ok(html.includes('中间产物'), 'Must render intermediate artifacts tab');
  assert.ok(html.includes('全部产物'), 'Must render all artifacts tab');
  assert.ok(html.includes('在文件管理器中打开目录'), 'Must render file manager button');
}

async function main() {
  testDiskTierClassification();
  testDualSourceAggregationAndFiltering();
  testAllRemainingScopeResolutions();
  await testWebFallbackFileManagerHelpers();
  testSsrAccessibilityAndDialogMarkup();
  console.log('✅ All artifacts window tests passed!');
}

main().catch((err) => {
  console.error('❌ Artifacts window tests failed:', err);
  process.exit(1);
});
