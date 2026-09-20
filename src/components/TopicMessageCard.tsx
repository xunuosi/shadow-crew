import React from 'react';
import { TopicMessageData, Agent } from '../types';
import { 
  GitBranch, 
  ArrowRight, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  FileCode2, 
  ShieldCheck, 
  UserCheck, 
  Sparkles,
  ChevronRight,
  Edit3
} from 'lucide-react';

interface TopicMessageCardProps {
  topic: TopicMessageData;
  agents: Agent[];
  onClick: () => void;
  onEdit?: () => void;
}

export const TopicMessageCard: React.FC<TopicMessageCardProps> = ({
  topic,
  agents,
  onClick,
  onEdit,
}) => {
  const isResolved = topic.status === 'resolved';
  const isInvestigating = topic.status === 'investigating';
  const isOpen = topic.status === 'open';

  // Find participating agent objects
  const participatingAgents = (topic.participatingAgentIds || [])
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean) as Agent[];

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl border transition-all cursor-pointer select-none group shadow-sm hover:shadow-md ${
        isResolved
          ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60'
          : isInvestigating
          ? 'bg-purple-500/5 hover:bg-purple-500/10 border-purple-500/30 hover:border-purple-500/60'
          : 'bg-surface hover:bg-surface-hover border-border hover:border-accent/50'
      }`}
    >
      {/* Left Vertical Status Stripe */}
      <div 
        className={`absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full ${
          isResolved 
            ? 'bg-emerald-500' 
            : isInvestigating 
            ? 'bg-purple-500' 
            : 'bg-fg-muted'
        }`} 
      />

      <div className="p-4 sm:p-5 pl-5 sm:pl-6 space-y-3">
        {/* Top Meta Bar: Status Badge, Author & Timestamp */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Badge */}
            {isResolved ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0 whitespace-nowrap">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>已达成共识 · Resolved</span>
              </span>
            ) : isInvestigating ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 shrink-0 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                <span>进行中 · Investigating</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-surface-subtle text-fg-muted border border-border shrink-0 whitespace-nowrap">
                <Clock className="w-3.5 h-3.5" />
                <span>待响应 · Open</span>
              </span>
            )}

            <span className="text-xs text-fg-muted font-mono whitespace-nowrap shrink-0">
              by <span className="text-fg font-medium">{topic.authorName}</span> · {topic.timestamp}
            </span>
          </div>

          {/* Reply Count & Action Hint */}
          <div className="flex items-center gap-2 shrink-0">
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="p-1 rounded-md text-fg-muted hover:text-accent hover:bg-surface-subtle transition-colors"
                title="编辑议题"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-fg-muted group-hover:text-accent transition-colors font-medium whitespace-nowrap">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{topic.repliesCount} 条讨论</span>
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>

        {/* Topic Title */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-purple-500 font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
              TOPIC
            </span>
            <h3 className="text-sm sm:text-base font-bold text-fg group-hover:text-accent transition-colors select-text">
              {topic.title}
            </h3>
          </div>

          {topic.description && (
            <p className="mt-1.5 text-xs text-fg-secondary line-clamp-2 leading-relaxed font-sans select-text">
              {topic.description}
            </p>
          )}
        </div>

        {/* Decision Record Rollup (When Resolved) */}
        {isResolved && topic.decisionRecord && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 space-y-2.5 text-xs font-sans">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
              <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>架构决策卡片 (Decision Record)</span>
              </div>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                {topic.decisionRecord.resolvedAt}
              </span>
            </div>

            <p className="text-fg leading-relaxed">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 mr-1.5">最终选定方案:</span>
              {topic.decisionRecord.solution}
            </p>

            {/* Impacted Files */}
            {topic.decisionRecord.impactedFiles && topic.decisionRecord.impactedFiles.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                <span className="text-fg-muted flex items-center gap-1">
                  <FileCode2 className="w-3 h-3 text-emerald-500" />
                  <span>影响文件:</span>
                </span>
                {topic.decisionRecord.impactedFiles.map((file) => (
                  <span
                    key={file}
                    className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface border border-border text-fg-secondary"
                  >
                    {file}
                  </span>
                ))}
              </div>
            )}

            {/* Approvers */}
            {topic.decisionRecord.approvers && topic.decisionRecord.approvers.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[11px]">
                <span className="text-fg-muted flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-emerald-500" />
                  <span>审核人:</span>
                </span>
                {topic.decisionRecord.approvers.map((approver) => (
                  <span
                    key={approver}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
                  >
                    ✓ {approver}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom Bar: Participating Agents Stack & Latest Preview */}
        <div className="flex items-center justify-between pt-1 border-t border-border-subtle gap-3 flex-wrap sm:flex-nowrap">
          {/* Agent Avatar Stack */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-fg-muted whitespace-nowrap">协同成员:</span>
            <div className="flex items-center -space-x-1.5 shrink-0">
              {participatingAgents.length > 0 ? (
                participatingAgents.map((ag) => (
                  <div
                    key={ag.id}
                    title={`${ag.name} (${ag.role})`}
                    className="w-6 h-6 rounded-lg bg-surface border border-border flex items-center justify-center text-xs shadow-xs shrink-0"
                  >
                    {ag.avatar}
                  </div>
                ))
              ) : (
                <div className="w-6 h-6 rounded-lg bg-surface border border-border flex items-center justify-center text-xs shrink-0">
                  🤖
                </div>
              )}
            </div>
            <span className="text-[10px] text-fg-muted font-mono whitespace-nowrap">
              {participatingAgents.length} 位协作
            </span>
          </div>

          {/* Latest reply snippet or dive in button */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 group-hover:text-accent transition-colors shrink-0 whitespace-nowrap">
            <span>进入议题讨论</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
};
