import type {
  GameTheoreticState,
  Message,
  ModularOrchestrationState,
  RulingRecord,
  SubThread,
  SwarmMissionData,
  TopicMessageData,
  TopicPatchDiffItem,
  WorkspaceBinding,
} from '../types';
import { getTauriInvoke, isTauriEnvironment } from './dbClient';
import { revealFileInFolder } from './fileViewerService';
import {
  WORKSPACE_HOME,
  getDefaultArtifactRoot,
  getDefaultChannelCwd,
  getDefaultDmTopicCwd,
  getDefaultTopicCwd,
} from './workspaceBindings';

function getDefaultAgentCwd(agentId: string): string {
  const safeId = agentId.trim() || 'agent-default';
  return `${WORKSPACE_HOME}/agents/${safeId}`;
}

export type ArtifactScopeType = 'channel' | 'dm' | 'topic' | 'swarm' | 'subthread' | 'agent';

export type ArtifactTier = 'final' | 'intermediate';

export type ArtifactTabFilter = 'final' | 'intermediate' | 'all';

export type ArtifactSourceKind =
  | 'disk_file'
  | 'topic_ruling'
  | 'topic_diff_applied'
  | 'topic_diff_pending'
  | 'topic_stage_output'
  | 'gframe_contract'
  | 'gframe_module_output'
  | 'swarm_synthesis'
  | 'swarm_subtask_output'
  | 'message_attachment';

export interface ArtifactsScopeDescriptor {
  scopeType: ArtifactScopeType;
  scopeId: string;
  channelId?: string;
  title: string;
  subtitle?: string;
  workspaceBinding?: WorkspaceBinding | null;
  workspaceBindingId?: string;
  workspaceCwd?: string;
  artifactRoot?: string;
  agentId?: string;
  messages?: Message[];
  topicData?: TopicMessageData;
  swarmMissions?: SwarmMissionData[];
  focusedSwarmId?: string;
  focusedModuleId?: string;
  subThread?: SubThread;
  subThreadMessages?: Message[];
}

export interface DiskArtifactFile {
  id: string;
  name: string;
  relativePath: string;
  fullPath: string;
  category: 'artifacts' | 'scratch' | 'workspace' | 'attachment';
  sizeBytes: number;
  modifiedAt: number;
  ext: string;
}

export interface ScopeArtifactsScanResult {
  primaryDir: string;
  workspaceCwd: string | null;
  scannedDirs: string[];
  files: DiskArtifactFile[];
  warnings: string[];
}

export interface UnifiedArtifactItem {
  id: string;
  title: string;
  subtitle?: string;
  tier: ArtifactTier;
  sourceKind: ArtifactSourceKind;
  badgeLabel: string;
  filePath?: string;
  relativePath?: string;
  ext?: string;
  sizeBytes?: number;
  timestamp?: number;
  timestampLabel?: string;
  authorName?: string;
  moduleId?: string;
  moduleTitle?: string;
  inlineContent?: string;
  inlineLanguage?: 'markdown' | 'diff' | 'json' | 'text';
  appliedStatus?: 'applied' | 'pending' | 'resolved';
  diskCategory?: DiskArtifactFile['category'];
}

export interface ScopeModuleFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface FileManagerActionResult {
  ok: boolean;
  desktopSupported: boolean;
  resolvedPath: string;
  message: string;
}

export interface DiskArtifactClassificationContext {
  appliedFilePaths?: Set<string>;
  pendingFilePaths?: Set<string>;
}

const INTERMEDIATE_SUBDIR_SEGMENTS = new Set([
  'intermediate',
  'intermediates',
  'scratch',
  'draft',
  'drafts',
  'stage',
  'stages',
  'tmp',
  'temp',
]);

function normalizePathSlashes(rawPath: string): string {
  return rawPath.trim().split('\\').join('/');
}

function getPathSegmentsLower(relPath: string): string[] {
  return normalizePathSlashes(relPath)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

function getFileExtLower(nameOrPath: string): string {
  const slashIdx = Math.max(nameOrPath.lastIndexOf('/'), nameOrPath.lastIndexOf('\\'));
  const baseName = slashIdx >= 0 ? nameOrPath.slice(slashIdx + 1) : nameOrPath;
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === baseName.length - 1) return '';
  return baseName.slice(dotIdx + 1).toLowerCase();
}

function getBaseName(rawPath: string): string {
  const normalized = normalizePathSlashes(rawPath);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function parseTimestampMs(val?: number | string): number | undefined {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? val : undefined;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

export function formatArtifactTimestamp(ts?: number): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

function formatDecisionTypeLabel(decisionType: RulingRecord['decisionType']): string {
  switch (decisionType) {
    case 'adopt_proposer':
      return '采纳主导';
    case 'reject_rebuild':
      return '采纳挑战';
    case 'trade_off_matrix':
      return '权衡矩阵';
    default:
      return String(decisionType);
  }
}

/**
 * Resolve fallback isolated workspace/artifact directory for display & Web-mode fallback
 * when Tauri IPC isn't available or explicit binding isn't set.
 */
export function resolveFallbackPrimaryDir(scope: ArtifactsScopeDescriptor): {
  primaryDir: string;
  workspaceCwd?: string;
} {
  if (scope.artifactRoot && scope.artifactRoot.trim()) {
    return {
      primaryDir: scope.artifactRoot.trim(),
      workspaceCwd: scope.workspaceCwd?.trim() || scope.workspaceBinding?.cwd,
    };
  }
  if (scope.workspaceBinding?.artifactRoot) {
    return {
      primaryDir: scope.workspaceBinding.artifactRoot,
      workspaceCwd: scope.workspaceBinding.cwd,
    };
  }
  if (scope.workspaceCwd && scope.workspaceCwd.trim()) {
    const cwd = scope.workspaceCwd.trim();
    return {
      primaryDir: getDefaultArtifactRoot(cwd),
      workspaceCwd: cwd,
    };
  }
  if (scope.topicData?.gameTheoreticState?.executionArtifactsDir) {
    return {
      primaryDir: scope.topicData.gameTheoreticState.executionArtifactsDir,
      workspaceCwd: scope.workspaceBinding?.cwd,
    };
  }
  if (scope.scopeType === 'agent') {
    const cwd = getDefaultAgentCwd(scope.agentId || scope.scopeId);
    return { primaryDir: getDefaultArtifactRoot(cwd), workspaceCwd: cwd };
  }
  if (scope.scopeType === 'dm') {
    const resolvedAgentId = scope.agentId || scope.topicData?.dmAgentId;
    const cwd = resolvedAgentId
      ? getDefaultAgentCwd(resolvedAgentId)
      : getDefaultChannelCwd(scope.channelId || scope.scopeId);
    return { primaryDir: getDefaultArtifactRoot(cwd), workspaceCwd: cwd };
  }
  if (scope.scopeType === 'topic' || scope.scopeType === 'swarm' || scope.scopeType === 'subthread') {
    const cwd =
      scope.topicData?.scopeType === 'dm' && scope.topicData.dmAgentId
        ? getDefaultDmTopicCwd(scope.topicData.dmAgentId, scope.topicData.id)
        : getDefaultTopicCwd(
            scope.topicData?.channelId || scope.channelId || 'chan-default',
            scope.topicData?.id || scope.scopeId
          );
    return { primaryDir: getDefaultArtifactRoot(cwd), workspaceCwd: cwd };
  }
  const cwd = getDefaultChannelCwd(scope.scopeId);
  return { primaryDir: getDefaultArtifactRoot(cwd), workspaceCwd: cwd };
}

/**
 * Pure classification for scanned disk files into final deliverables vs intermediate outputs.
 */
export function classifyDiskArtifactTier(
  file: DiskArtifactFile,
  context?: DiskArtifactClassificationContext
): ArtifactTier {
  const normalizedFull = normalizePathSlashes(file.fullPath);
  const normalizedRel = normalizePathSlashes(file.relativePath);

  if (
    context?.appliedFilePaths &&
    (context.appliedFilePaths.has(normalizedFull) || context.appliedFilePaths.has(normalizedRel))
  ) {
    return 'final';
  }
  if (
    context?.pendingFilePaths &&
    (context.pendingFilePaths.has(normalizedFull) || context.pendingFilePaths.has(normalizedRel))
  ) {
    return 'intermediate';
  }

  if (file.category === 'scratch' || file.category === 'attachment') {
    return 'intermediate';
  }

  if (file.category === 'artifacts') {
    const parentSegments = getPathSegmentsLower(normalizedRel).slice(0, -1);
    const insideIntermediateDir = parentSegments.some((seg) =>
      INTERMEDIATE_SUBDIR_SEGMENTS.has(seg)
    );
    return insideIntermediateDir ? 'intermediate' : 'final';
  }

  // Category === 'workspace': files explicitly in an isolated working root outside artifacts/
  // are working drafts / intermediate workspace outputs unless marked applied above.
  return 'intermediate';
}

function addCandidatePath(targetSet: Set<string>, raw?: string) {
  if (!raw || typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return;
  }
  if (trimmed.startsWith('file://')) {
    targetSet.add(trimmed.slice('file://'.length));
    return;
  }
  targetSet.add(trimmed);
}

function collectDiffPaths(diffs: TopicPatchDiffItem[] | undefined, into: Set<string>) {
  if (!diffs) return;
  for (const item of diffs) {
    addCandidatePath(into, item.targetPath);
    addCandidatePath(into, item.filename);
  }
}

/**
 * Extract explicit file paths referenced in structured messages, diffs, topics, and swarm missions
 * so Rust can stat and verify their presence on disk without scanning huge external repositories.
 */
export function collectScopeExtraFilePaths(scope: ArtifactsScopeDescriptor): string[] {
  const paths = new Set<string>();

  const scanMessage = (msg: Message) => {
    collectDiffPaths(msg.diffViews, paths);
    if (msg.diffView) {
      addCandidatePath(paths, msg.diffView.targetPath);
      addCandidatePath(paths, msg.diffView.filename);
    }
    if (msg.attachments) {
      for (const att of msg.attachments) {
        addCandidatePath(paths, att.path);
        addCandidatePath(paths, att.uri);
      }
    }
  };

  scope.messages?.forEach(scanMessage);
  scope.subThreadMessages?.forEach(scanMessage);
  scope.subThread?.messages?.forEach(scanMessage);

  if (scope.topicData) {
    const topic = scope.topicData;
    topic.rulingRecord?.impactedFiles?.forEach((p) => addCandidatePath(paths, p));
    topic.decisionRecord?.impactedFiles?.forEach((p) => addCandidatePath(paths, p));
    collectDiffPaths(topic.gameTheoreticState?.executionDiffs, paths);
    topic.gameTheoreticState?.modularState?.modules.forEach((mod) => {
      collectDiffPaths(mod.executionDiffs, paths);
      mod.allowedFiles?.forEach((f) => addCandidatePath(paths, f));
    });
  }

  const allMissions = [
    ...(scope.swarmMissions ?? []),
    ...(scope.messages?.map((m) => m.swarmMission).filter((m): m is SwarmMissionData => Boolean(m)) ?? []),
  ];
  for (const mission of allMissions) {
    collectDiffPaths(mission.aggregatedDiffs, paths);
    mission.subTasks.forEach((subTask) => {
      collectDiffPaths(subTask.generatedDiffs, paths);
    });
  }

  return Array.from(paths);
}

function buildDiskCategoryBadge(category: DiskArtifactFile['category'], tier: ArtifactTier): string {
  switch (category) {
    case 'artifacts':
      return tier === 'final' ? '落盘终局产物' : '中间过程文件';
    case 'scratch':
      return 'Scratch 草稿';
    case 'workspace':
      return tier === 'final' ? '已合入工作区文件' : '工作区文件';
    case 'attachment':
      return '引用附件';
  }
}

function formatRulingMarkdown(ruling: RulingRecord, topicTitle: string): string {
  if (ruling.livingAdrMarkdown && ruling.livingAdrMarkdown.trim()) {
    return ruling.livingAdrMarkdown;
  }
  const lines: string[] = [
    `# 裁决定案书 · ${topicTitle}`,
    '',
    `- **裁决模式**: ${ruling.decisionType}`,
    `- **裁定官**: ${ruling.arbiterName}`,
    `- **定案时间**: ${ruling.decidedAt}`,
    '',
    '## 裁决结论摘要',
    ruling.summary || '（无摘要）',
  ];
  if (ruling.solution) {
    lines.push('', '## 落地方案 / 架构指引', ruling.solution);
  }
  if (ruling.tradeOffPoints && ruling.tradeOffPoints.length > 0) {
    lines.push('', '## 关键权衡要点');
    for (const pt of ruling.tradeOffPoints) {
      lines.push(`- ${pt}`);
    }
  }
  if (ruling.impactedFiles && ruling.impactedFiles.length > 0) {
    lines.push('', '## 受影响文件清单');
    for (const f of ruling.impactedFiles) {
      lines.push(`- \`${f}\``);
    }
  }
  return lines.join('\n');
}

function appendTopicStructuredEntries(
  topic: TopicMessageData,
  messages: Message[],
  items: UnifiedArtifactItem[],
  appliedPaths: Set<string>,
  pendingPaths: Set<string>
) {
  const gs: GameTheoreticState | undefined = topic.gameTheoreticState;

  // 1. Resolved ADR / Ruling Record (Final)
  if (topic.rulingRecord) {
    const ts = parseTimestampMs(topic.rulingRecord.decidedAt);
    items.push({
      id: `topic-ruling:${topic.id}`,
      title: topic.rulingRecord.livingAdrMarkdown
        ? `Living ADR 定案文档 · ${topic.title}`
        : `仲裁裁决书 · ${topic.title}`,
      subtitle: `${formatDecisionTypeLabel(topic.rulingRecord.decisionType)} · ${topic.rulingRecord.arbiterName}`,
      tier: 'final',
      sourceKind: 'topic_ruling',
      badgeLabel: '终局裁决 ADR',
      ext: 'md',
      timestamp: ts,
      timestampLabel: formatArtifactTimestamp(ts) || topic.rulingRecord.decidedAt,
      authorName: topic.rulingRecord.arbiterName,
      inlineContent: formatRulingMarkdown(topic.rulingRecord, topic.title),
      inlineLanguage: 'markdown',
      appliedStatus: 'resolved',
    });
  } else if (topic.decisionRecord) {
    const ts = parseTimestampMs(topic.decisionRecord.resolvedAt);
    items.push({
      id: `topic-decision:${topic.id}`,
      title: `议题定案摘要 · ${topic.title}`,
      subtitle: topic.decisionRecord.executorName
        ? `执行人: ${topic.decisionRecord.executorName}`
        : '议题已完成定案',
      tier: 'final',
      sourceKind: 'topic_ruling',
      badgeLabel: '定案结论',
      ext: 'md',
      timestamp: ts,
      timestampLabel: formatArtifactTimestamp(ts) || topic.decisionRecord.resolvedAt,
      authorName: topic.decisionRecord.executorName,
      inlineContent: [
        `# ${topic.title}`,
        '',
        '## 结论摘要',
        topic.decisionRecord.summary,
        '',
        '## 执行方案',
        topic.decisionRecord.solution,
      ].join('\n'),
      inlineLanguage: 'markdown',
      appliedStatus: 'resolved',
    });
  }

  // 2. Topic-level Execution Summary Report (Final if applied or completed with report_only)
  if (gs?.executionSummary && gs.executionSummary.trim()) {
    const isFinalExecution =
      gs.executionStatus === 'applied' || gs.executionStatus === 'completed';
    const ts = parseTimestampMs(gs.executionAppliedAt || gs.executionCompletedAt);
    items.push({
      id: `topic-exec-summary:${topic.id}`,
      title: gs.executionUiMeta?.sectionTitle || `执行落地交付报告 · ${topic.title}`,
      subtitle: gs.executionUiMeta?.statusSummary || `状态: ${gs.executionStatus ?? 'completed'}`,
      tier: isFinalExecution ? 'final' : 'intermediate',
      sourceKind: 'topic_stage_output',
      badgeLabel: gs.executionStatus === 'applied' ? '已合入交付报告' : '落地交付摘要',
      ext: 'md',
      timestamp: ts,
      timestampLabel: formatArtifactTimestamp(ts),
      inlineContent: gs.executionSummary,
      inlineLanguage: 'markdown',
      appliedStatus: gs.executionStatus === 'applied' ? 'applied' : 'pending',
    });
  }

  // 3. Topic Execution Diffs
  const diffTs = parseTimestampMs(gs?.executionAppliedAt || gs?.executionCompletedAt);
  gs?.executionDiffs?.forEach((diff, idx) => {
    const resolvedPath = diff.targetPath || diff.filename;
    const isApplied =
      diff.applied === true || (diff.applied !== false && gs.executionStatus === 'applied');
    if (isApplied) {
      appliedPaths.add(normalizePathSlashes(resolvedPath));
      appliedPaths.add(normalizePathSlashes(diff.filename));
    } else {
      pendingPaths.add(normalizePathSlashes(resolvedPath));
      pendingPaths.add(normalizePathSlashes(diff.filename));
    }
    items.push({
      id: `topic-diff:${topic.id}:${idx}:${diff.filename}`,
      title: getBaseName(diff.filename),
      subtitle: `${diff.filename} (+${diff.additions} / -${diff.deletions})`,
      tier: isApplied ? 'final' : 'intermediate',
      sourceKind: isApplied ? 'topic_diff_applied' : 'topic_diff_pending',
      badgeLabel: isApplied ? '已合入变更 Diff' : '待合入补丁 Diff',
      filePath: diff.targetPath,
      relativePath: diff.filename,
      ext: getFileExtLower(diff.filename) || 'diff',
      timestamp: diffTs,
      timestampLabel: formatArtifactTimestamp(diffTs),
      inlineContent: diff.diff || diff.codeContent || '',
      inlineLanguage: diff.diff ? 'diff' : 'text',
      appliedStatus: isApplied ? 'applied' : 'pending',
    });
  });

  // 4. G-Frame Shared Interface Contract & Module Slices
  const modular: ModularOrchestrationState | undefined = gs?.modularState;
  if (modular?.enabled) {
    if (modular.sharedContract) {
      const contract = modular.sharedContract;
      items.push({
        id: `gframe-contract:${topic.id}`,
        title: `G-Frame 公共接口契约 v${contract.contractVersion}`,
        subtitle: contract.summary,
        tier: 'intermediate',
        sourceKind: 'gframe_contract',
        badgeLabel: 'G-Frame 共享契约',
        ext: 'md',
        timestamp: parseTimestampMs(contract.lockedAt),
        timestampLabel: contract.lockedAt,
        inlineContent: [
          `# Shared Interface Contract v${contract.contractVersion}`,
          '',
          contract.summary,
          '',
          '## Type Signatures',
          '```ts',
          contract.typeSignatures,
          '```',
          '',
          '## Invariants',
          ...contract.invariants.map((inv) => `- ${inv}`),
        ].join('\n'),
        inlineLanguage: 'markdown',
      });
    }

    for (const mod of modular.modules) {
      if (mod.frozenProposalSnippet || mod.executionSummary) {
        const isFrozenOrApplied =
          mod.status === 'frozen' || mod.executionStatus === 'completed';
        const hasTopicFinalRuling = Boolean(topic.rulingRecord || topic.decisionRecord);
        items.push({
          id: `gframe-mod-summary:${mod.moduleId}`,
          title: `${mod.title} · 模块方案与交付`,
          subtitle: mod.responsibility,
          tier: isFrozenOrApplied && (mod.executionStatus === 'completed' || hasTopicFinalRuling)
            ? 'final'
            : 'intermediate',
          sourceKind: 'gframe_module_output',
          badgeLabel: mod.executionStatus === 'completed' ? '模块完成交付' : '模块冻结方案',
          ext: 'md',
          moduleId: mod.moduleId,
          moduleTitle: mod.title,
          inlineContent: [
            `# ${mod.title}`,
            '',
            `**职责边界**: ${mod.responsibility}`,
            '',
            mod.frozenProposalSnippet ? `## 冻结方案摘要\n${mod.frozenProposalSnippet}` : '',
            mod.executionSummary ? `## 模块执行交付\n${mod.executionSummary}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          inlineLanguage: 'markdown',
        });
      }

      mod.executionDiffs?.forEach((diff, idx) => {
        const isApplied =
          diff.applied === true ||
          (diff.applied !== false && gs?.executionStatus === 'applied');
        if (diff.targetPath) {
          (isApplied ? appliedPaths : pendingPaths).add(normalizePathSlashes(diff.targetPath));
        }
        items.push({
          id: `gframe-mod-diff:${mod.moduleId}:${idx}:${diff.filename}`,
          title: getBaseName(diff.filename),
          subtitle: `${mod.title} · +${diff.additions}/-${diff.deletions}`,
          tier: isApplied ? 'final' : 'intermediate',
          sourceKind: isApplied ? 'topic_diff_applied' : 'topic_diff_pending',
          badgeLabel: isApplied ? '模块已合入 Diff' : '模块草稿 Diff',
          filePath: diff.targetPath,
          relativePath: diff.filename,
          ext: getFileExtLower(diff.filename) || 'diff',
          moduleId: mod.moduleId,
          moduleTitle: mod.title,
          inlineContent: diff.diff || diff.codeContent || '',
          inlineLanguage: diff.diff ? 'diff' : 'text',
          appliedStatus: isApplied ? 'applied' : 'pending',
        });
      });
    }
  }

  // 5. 4+1 Game Stage Outputs (always Intermediate stage artifacts)
  const stageEntries: Array<{
    key: string;
    title: string;
    badge: string;
    content?: string;
    msgId?: string;
  }> = [
    {
      key: 'proposal',
      title: '阶段 1 · 提案立论稿 (Proposal)',
      badge: '4+1 提案输出',
      content: gs?.targetProposalContent,
      msgId: gs?.targetProposalMessageId,
    },
    {
      key: 'challenge',
      title: '阶段 2 · 红队反向质询报告 (Challenge)',
      badge: '4+1 质询报告',
      content: gs?.targetChallengeContent,
      msgId: gs?.targetChallengeMessageId,
    },
    {
      key: 'verification',
      title: '阶段 3 · 物理接地实证报告 (Verification)',
      badge: '4+1 接地验证',
      content: gs?.targetVerificationContent,
      msgId: gs?.targetVerificationMessageId,
    },
    {
      key: 'defense',
      title: '阶段 4 · 防御修正答辩稿 (Defense)',
      badge: '4+1 答辩修正',
      content: gs?.targetDefenseContent,
      msgId: gs?.targetDefenseMessageId,
    },
  ];

  for (const stage of stageEntries) {
    if (!stage.content || !stage.content.trim()) continue;
    const matchedMsg = stage.msgId
      ? messages.find((m) => m.id === stage.msgId)
      : undefined;
    items.push({
      id: `topic-stage:${topic.id}:${stage.key}`,
      title: stage.title,
      subtitle: matchedMsg ? `${matchedMsg.authorName} 输出` : '博弈推演中间阶段产物',
      tier: 'intermediate',
      sourceKind: 'topic_stage_output',
      badgeLabel: stage.badge,
      ext: 'md',
      authorName: matchedMsg?.authorName,
      timestamp: parseTimestampMs(matchedMsg?.timestamp),
      timestampLabel: matchedMsg?.timestamp,
      moduleId: matchedMsg?.moduleId,
      inlineContent: stage.content,
      inlineLanguage: 'markdown',
    });
  }
}

function appendSwarmEntries(
  mission: SwarmMissionData,
  items: UnifiedArtifactItem[],
  appliedPaths: Set<string>,
  pendingPaths: Set<string>
) {
  if (mission.finalSynthesis && mission.finalSynthesis.trim()) {
    items.push({
      id: `swarm-synth:${mission.missionId}`,
      title: `Swarm 终局合流报告 · ${mission.originalTask.slice(0, 42)}`,
      subtitle: mission.patchApplySummary || `共 ${mission.subTasks.length} 项协同子任务`,
      tier: 'final',
      sourceKind: 'swarm_synthesis',
      badgeLabel: 'Swarm 综合结论',
      ext: 'md',
      timestamp: mission.completedAt || mission.createdAt,
      timestampLabel: formatArtifactTimestamp(mission.completedAt || mission.createdAt),
      moduleId: `swarm:${mission.missionId}`,
      moduleTitle: 'Swarm 合流',
      inlineContent: mission.finalSynthesis,
      inlineLanguage: 'markdown',
      appliedStatus: mission.patchApplied ? 'applied' : 'resolved',
    });
  }

  mission.aggregatedDiffs?.forEach((diff, idx) => {
    const isApplied =
      diff.applied === true ||
      (diff.applied !== false && Boolean(mission.patchApplied));
    if (diff.targetPath) {
      (isApplied ? appliedPaths : pendingPaths).add(normalizePathSlashes(diff.targetPath));
    }
    items.push({
      id: `swarm-agg-diff:${mission.missionId}:${idx}:${diff.filename}`,
      title: getBaseName(diff.filename),
      subtitle: `Swarm 聚合变更 · +${diff.additions}/-${diff.deletions}`,
      tier: isApplied ? 'final' : 'intermediate',
      sourceKind: isApplied ? 'topic_diff_applied' : 'topic_diff_pending',
      badgeLabel: isApplied ? 'Swarm 已合入 Diff' : 'Swarm 聚合待合入',
      filePath: diff.targetPath,
      relativePath: diff.filename,
      ext: getFileExtLower(diff.filename) || 'diff',
      timestamp: mission.completedAt || mission.createdAt,
      timestampLabel: formatArtifactTimestamp(mission.completedAt || mission.createdAt),
      moduleId: `swarm:${mission.missionId}`,
      moduleTitle: 'Swarm 合流',
      inlineContent: diff.diff || diff.codeContent || '',
      inlineLanguage: diff.diff ? 'diff' : 'text',
      appliedStatus: isApplied ? 'applied' : 'pending',
    });
  });

  mission.subTasks.forEach((task) => {
    const taskModId = `swarm-task:${task.taskId}`;
    const taskTitleLabel = `子任务 · ${task.title}`;
    if (task.resultSummary && task.resultSummary.trim()) {
      items.push({
        id: `swarm-task-summary:${task.taskId}`,
        title: task.title,
        subtitle: `${task.assignedAgentId} · 状态: ${task.status}`,
        tier: 'intermediate',
        sourceKind: 'swarm_subtask_output',
        badgeLabel: 'Worker 子任务产出',
        ext: 'md',
        authorName: task.assignedAgentId,
        timestamp: task.finishedAt || mission.createdAt,
        timestampLabel: formatArtifactTimestamp(task.finishedAt || mission.createdAt),
        moduleId: taskModId,
        moduleTitle: taskTitleLabel,
        inlineContent: [
          `# ${task.title}`,
          '',
          task.description ? `**任务说明**: ${task.description}` : '',
          `## 执行输出摘要`,
          task.resultSummary,
        ]
          .filter(Boolean)
          .join('\n\n'),
        inlineLanguage: 'markdown',
      });
    }

    task.generatedDiffs?.forEach((diff, idx) => {
      if (diff.targetPath) {
        pendingPaths.add(normalizePathSlashes(diff.targetPath));
      }
      items.push({
        id: `swarm-task-diff:${task.taskId}:${idx}:${diff.filename}`,
        title: getBaseName(diff.filename),
        subtitle: `${task.title} · +${diff.additions}/-${diff.deletions}`,
        tier: diff.applied ? 'final' : 'intermediate',
        sourceKind: diff.applied ? 'topic_diff_applied' : 'topic_diff_pending',
        badgeLabel: diff.applied ? 'Worker 已合入 Diff' : 'Worker 草案 Diff',
        filePath: diff.targetPath,
        relativePath: diff.filename,
        ext: getFileExtLower(diff.filename) || 'diff',
        authorName: task.assignedAgentId,
        timestamp: task.finishedAt || mission.createdAt,
        timestampLabel: formatArtifactTimestamp(task.finishedAt || mission.createdAt),
        moduleId: taskModId,
        moduleTitle: taskTitleLabel,
        inlineContent: diff.diff || diff.codeContent || '',
        inlineLanguage: diff.diff ? 'diff' : 'text',
        appliedStatus: diff.applied ? 'applied' : 'pending',
      });
    });
  });
}

function appendMessageEntries(
  messages: Message[],
  items: UnifiedArtifactItem[],
  appliedPaths: Set<string>,
  pendingPaths: Set<string>,
  structuredAttachmentPaths: Set<string>,
  skipTopicMessages: boolean
) {
  for (const msg of messages) {
    if (skipTopicMessages && msg.type === 'topic') continue;

    // Code diffs attached directly on timeline messages
    const msgDiffs: TopicPatchDiffItem[] = [
      ...(msg.diffViews ?? []),
      ...(msg.diffView ? [msg.diffView] : []),
    ];
    msgDiffs.forEach((diff, idx) => {
      const isApplied = Boolean(diff.applied);
      if (diff.targetPath) {
        (isApplied ? appliedPaths : pendingPaths).add(normalizePathSlashes(diff.targetPath));
      }
      items.push({
        id: `msg-diff:${msg.id}:${idx}:${diff.filename}`,
        title: getBaseName(diff.filename),
        subtitle: `${msg.authorName} · +${diff.additions}/-${diff.deletions}`,
        tier: isApplied ? 'final' : 'intermediate',
        sourceKind: isApplied ? 'topic_diff_applied' : 'topic_diff_pending',
        badgeLabel: isApplied ? '消息已合入补丁' : '消息补丁草案',
        filePath: diff.targetPath,
        relativePath: diff.filename,
        ext: getFileExtLower(diff.filename) || 'diff',
        authorName: msg.authorName,
        timestamp: parseTimestampMs(msg.timestamp),
        timestampLabel: msg.timestamp,
        moduleId: msg.moduleId,
        inlineContent: diff.diff || diff.codeContent || '',
        inlineLanguage: diff.diff ? 'diff' : 'text',
        appliedStatus: isApplied ? 'applied' : 'pending',
      });
    });

    // Attachments on messages
    msg.attachments?.forEach((att, idx) => {
      const rawPath = att.path || att.uri;
      if (rawPath) {
        structuredAttachmentPaths.add(normalizePathSlashes(rawPath));
      }
      items.push({
        id: `msg-att:${msg.id}:${att.id || idx}`,
        title: att.name,
        subtitle: `${msg.authorName} 附件 · ${att.mimeType}`,
        tier: 'intermediate',
        sourceKind: 'message_attachment',
        badgeLabel: att.kind === 'image' ? '图像附件' : '消息附件',
        filePath: rawPath,
        ext: getFileExtLower(att.name),
        sizeBytes: att.size,
        authorName: msg.authorName,
        timestamp: parseTimestampMs(msg.timestamp),
        timestampLabel: msg.timestamp,
        moduleId: msg.moduleId,
      });
    });

    // Inline code snippets emitted on messages
    msg.codeSnippets?.forEach((snippet, idx) => {
      items.push({
        id: `msg-snippet:${msg.id}:${idx}:${snippet.filename}`,
        title: snippet.filename || `snippet-${idx + 1}`,
        subtitle: `${msg.authorName} · 代码片段 (${snippet.language})`,
        tier: 'intermediate',
        sourceKind: 'topic_stage_output',
        badgeLabel: '代码片段',
        relativePath: snippet.filename,
        ext: getFileExtLower(snippet.filename) || snippet.language.toLowerCase(),
        authorName: msg.authorName,
        timestamp: parseTimestampMs(msg.timestamp),
        timestampLabel: msg.timestamp,
        moduleId: msg.moduleId,
        inlineContent: snippet.code,
        inlineLanguage: snippet.language === 'json' ? 'json' : 'text',
      });
    });
  }
}

/**
 * Pure aggregator merging structured domain artifacts and scanned physical disk files.
 */
export function buildScopeArtifactEntries(
  scope: ArtifactsScopeDescriptor,
  diskScan: ScopeArtifactsScanResult | null
): UnifiedArtifactItem[] {
  const items: UnifiedArtifactItem[] = [];
  const appliedPaths = new Set<string>();
  const pendingPaths = new Set<string>();
  const structuredAttachmentPaths = new Set<string>();

  const messages = scope.messages ?? [];
  const subMessages = scope.subThreadMessages ?? scope.subThread?.messages ?? [];

  if (scope.topicData) {
    appendTopicStructuredEntries(
      scope.topicData,
      messages,
      items,
      appliedPaths,
      pendingPaths
    );
  }

  // Channel / DM top-level view: also surface resolved Topic ADR rulings & summaries cleanly
  if ((scope.scopeType === 'channel' || scope.scopeType === 'dm') && messages.length > 0) {
    for (const msg of messages) {
      if (msg.type === 'topic' && msg.topicData) {
        const topic = msg.topicData;
        if (topic.rulingRecord) {
          const rulingTs = parseTimestampMs(topic.rulingRecord.decidedAt);
          items.push({
            id: `chan-topic-ruling:${topic.id}`,
            title: `议题定案 ADR · ${topic.title}`,
            subtitle: `${formatDecisionTypeLabel(topic.rulingRecord.decisionType)} · ${topic.rulingRecord.arbiterName}`,
            tier: 'final',
            sourceKind: 'topic_ruling',
            badgeLabel: '议题定案 ADR',
            ext: 'md',
            authorName: topic.rulingRecord.arbiterName,
            timestamp: rulingTs,
            timestampLabel: formatArtifactTimestamp(rulingTs) || topic.rulingRecord.decidedAt,
            inlineContent: formatRulingMarkdown(topic.rulingRecord, topic.title),
            inlineLanguage: 'markdown',
            appliedStatus: 'resolved',
          });
        }
        topic.gameTheoreticState?.executionDiffs?.forEach((diff, idx) => {
          const isApplied =
            diff.applied === true ||
            (diff.applied !== false && topic.gameTheoreticState?.executionStatus === 'applied');
          if (diff.targetPath) {
            (isApplied ? appliedPaths : pendingPaths).add(normalizePathSlashes(diff.targetPath));
          }
          if (isApplied) {
            items.push({
              id: `chan-topic-diff:${topic.id}:${idx}:${diff.filename}`,
              title: getBaseName(diff.filename),
              subtitle: `来自议题「${topic.title}」`,
              tier: 'final',
              sourceKind: 'topic_diff_applied',
              badgeLabel: '已合入交付文件',
              filePath: diff.targetPath,
              relativePath: diff.filename,
              ext: getFileExtLower(diff.filename) || 'diff',
              inlineContent: diff.diff || diff.codeContent || '',
              inlineLanguage: diff.diff ? 'diff' : 'text',
              appliedStatus: 'applied',
            });
          }
        });
      }
    }
  }

  // Collect Swarm missions
  const missionMap = new Map<string, SwarmMissionData>();
  scope.swarmMissions?.forEach((m) => missionMap.set(m.missionId, m));
  messages.forEach((m) => {
    if (m.swarmMission) {
      missionMap.set(m.swarmMission.missionId, m.swarmMission);
    }
  });
  for (const mission of missionMap.values()) {
    if (scope.focusedSwarmId && mission.missionId !== scope.focusedSwarmId) {
      continue;
    }
    appendSwarmEntries(mission, items, appliedPaths, pendingPaths);
  }

  // Message-level diffs / attachments / snippets
  if (messages.length > 0) {
    appendMessageEntries(
      messages,
      items,
      appliedPaths,
      pendingPaths,
      structuredAttachmentPaths,
      scope.scopeType === 'topic'
    );
  }
  if (subMessages.length > 0) {
    appendMessageEntries(
      subMessages,
      items,
      appliedPaths,
      pendingPaths,
      structuredAttachmentPaths,
      false
    );
  }

  // Merge scanned physical disk files
  if (diskScan) {
    for (const file of diskScan.files) {
      const normFull = normalizePathSlashes(file.fullPath);
      const normRel = normalizePathSlashes(file.relativePath);
      if (
        file.category === 'attachment' &&
        (structuredAttachmentPaths.has(normFull) || structuredAttachmentPaths.has(normRel))
      ) {
        // Avoid duplicating an attachment already rendered with rich message metadata
        continue;
      }

      const tier = classifyDiskArtifactTier(file, {
        appliedFilePaths: appliedPaths,
        pendingFilePaths: pendingPaths,
      });

      items.push({
        id: file.id,
        title: file.name,
        subtitle: file.relativePath !== file.name ? file.relativePath : file.fullPath,
        tier,
        sourceKind: 'disk_file',
        badgeLabel: buildDiskCategoryBadge(file.category, tier),
        filePath: file.fullPath,
        relativePath: file.relativePath,
        ext: file.ext || getFileExtLower(file.name),
        sizeBytes: file.sizeBytes,
        timestamp: file.modifiedAt,
        timestampLabel: formatArtifactTimestamp(file.modifiedAt),
        diskCategory: file.category,
      });
    }
  }

  // Sort: final items sorted first in 'all' context, or newest timestamp first within tier
  items.sort((a, b) => {
    const timeDiff = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return a.title.localeCompare(b.title);
  });

  return items;
}

/**
 * Extract optional G-Frame / Swarm module pills present in current artifact list.
 */
export function extractScopeModuleOptions(
  items: UnifiedArtifactItem[]
): ScopeModuleFilterOption[] {
  const counts = new Map<string, ScopeModuleFilterOption>();
  for (const item of items) {
    if (!item.moduleId) continue;
    const existing = counts.get(item.moduleId);
    if (existing) {
      existing.count += 1;
      if (existing.label === item.moduleId && item.moduleTitle) {
        existing.label = item.moduleTitle;
      }
    } else {
      counts.set(item.moduleId, {
        id: item.moduleId,
        label: item.moduleTitle || item.moduleId,
        count: 1,
      });
    }
  }
  return Array.from(counts.values());
}

/**
 * Filter artifact entries by tab ('final' | 'intermediate' | 'all'), optional module filter, and search query.
 */
export function filterArtifactEntries(
  items: UnifiedArtifactItem[],
  options: {
    tab: ArtifactTabFilter;
    moduleId?: string | 'all';
    query?: string;
  }
): UnifiedArtifactItem[] {
  const queryLower = (options.query ?? '').trim().toLowerCase();
  const activeModuleId = options.moduleId && options.moduleId !== 'all' ? options.moduleId : null;

  return items.filter((item) => {
    if (options.tab !== 'all' && item.tier !== options.tab) {
      return false;
    }
    if (activeModuleId && item.moduleId !== activeModuleId) {
      return false;
    }
    if (queryLower.length > 0) {
      const titleHit = item.title.toLowerCase().includes(queryLower);
      const subHit = (item.subtitle ?? '').toLowerCase().includes(queryLower);
      const pathHit = (item.filePath ?? '').toLowerCase().includes(queryLower);
      const badgeHit = item.badgeLabel.toLowerCase().includes(queryLower);
      const authorHit = (item.authorName ?? '').toLowerCase().includes(queryLower);
      if (!titleHit && !subHit && !pathHit && !badgeHit && !authorHit) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Execute physical disk scan via Tauri backend, with clean Web-mode empty disk fallback.
 */
export async function scanScopeArtifacts(
  scope: ArtifactsScopeDescriptor
): Promise<ScopeArtifactsScanResult> {
  const fallback = resolveFallbackPrimaryDir(scope);
  const extraPaths = collectScopeExtraFilePaths(scope);
  const invoke = getTauriInvoke();

  if (!invoke) {
    return {
      primaryDir: fallback.primaryDir,
      workspaceCwd: fallback.workspaceCwd ?? null,
      scannedDirs: [],
      files: [],
      warnings: [
        '当前为浏览器 Web 预览模式，仅展示结构化会话产物；切换到桌面客户端可实时扫描本地磁盘目录。',
      ],
    };
  }

  try {
    const result = (await invoke('list_scope_artifacts', {
      request: {
        scopeType: scope.scopeType,
        scopeId: scope.agentId && scope.scopeType === 'agent' ? scope.agentId : scope.scopeId,
        workspaceBindingId: scope.workspaceBindingId ?? scope.workspaceBinding?.id ?? null,
        workspaceCwd: fallback.workspaceCwd ?? null,
        artifactRoot: scope.artifactRoot ?? scope.workspaceBinding?.artifactRoot ?? null,
        extraPaths,
      },
    })) as ScopeArtifactsScanResult;
    return result;
  } catch (err) {
    return {
      primaryDir: fallback.primaryDir,
      workspaceCwd: fallback.workspaceCwd ?? null,
      scannedDirs: [],
      files: [],
      warnings: [`扫描本地磁盘产物失败: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/**
 * Open a directory in OS File Manager (Finder / Explorer / xdg-open), with Web-mode graceful message.
 */
export async function openDirectoryInFileManager(
  dirPath: string,
  options?: { workspaceRoot?: string; createIfMissing?: boolean }
): Promise<FileManagerActionResult> {
  if (!dirPath.trim()) {
    return {
      ok: false,
      desktopSupported: isTauriEnvironment(),
      resolvedPath: '',
      message: '未配置有效的产物目录路径。',
    };
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return {
      ok: false,
      desktopSupported: false,
      resolvedPath: dirPath,
      message: `当前处于 Web 浏览器预览模式，请复制目录路径在系统文件管理器中打开：${dirPath}`,
    };
  }
  try {
    const opened = (await invoke('open_directory_in_file_manager', {
      path: dirPath,
      workspaceRoot: options?.workspaceRoot ?? null,
      createIfMissing: options?.createIfMissing ?? true,
    })) as string;
    return {
      ok: true,
      desktopSupported: true,
      resolvedPath: opened,
      message: `已在系统文件管理器中打开目录：${opened}`,
    };
  } catch (err) {
    return {
      ok: false,
      desktopSupported: true,
      resolvedPath: dirPath,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reveal a specific file in OS File Manager (`open -R` on macOS, `explorer /select,` on Windows).
 */
export async function revealArtifactInFileManager(
  filePath: string,
  workspaceRoot?: string
): Promise<FileManagerActionResult> {
  if (!filePath.trim()) {
    return {
      ok: false,
      desktopSupported: isTauriEnvironment(),
      resolvedPath: '',
      message: '该条目为纯内存结构化产物，无对应物理文件；可尝试打开所属产物目录。',
    };
  }
  if (!isTauriEnvironment()) {
    return {
      ok: false,
      desktopSupported: false,
      resolvedPath: filePath,
      message: `当前处于 Web 浏览器预览模式，请复制文件路径在系统文件管理器中查看：${filePath}`,
    };
  }
  try {
    await revealFileInFolder(filePath, workspaceRoot);
    return {
      ok: true,
      desktopSupported: true,
      resolvedPath: filePath,
      message: `已在文件管理器中定位文件：${filePath}`,
    };
  } catch (err) {
    return {
      ok: false,
      desktopSupported: true,
      resolvedPath: filePath,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
