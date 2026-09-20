import React from 'react';
import { Info, Lightbulb, AlertTriangle, AlertCircle, ShieldAlert } from 'lucide-react';

export type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

interface GitHubAlertProps {
  type: AlertType;
  children: React.ReactNode;
}

const ALERT_CONFIGS: Record<
  AlertType,
  {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    borderClass: string;
    bgClass: string;
    textClass: string;
  }
> = {
  NOTE: {
    title: 'Note',
    icon: Info,
    borderClass: 'border-blue-500/40',
    bgClass: 'bg-blue-500/10',
    textClass: 'text-blue-500 dark:text-blue-400',
  },
  TIP: {
    title: 'Tip',
    icon: Lightbulb,
    borderClass: 'border-emerald-500/40',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-500 dark:text-emerald-400',
  },
  IMPORTANT: {
    title: 'Important',
    icon: AlertCircle,
    borderClass: 'border-purple-500/40',
    bgClass: 'bg-purple-500/10',
    textClass: 'text-purple-500 dark:text-purple-400',
  },
  WARNING: {
    title: 'Warning',
    icon: AlertTriangle,
    borderClass: 'border-amber-500/40',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-500 dark:text-amber-400',
  },
  CAUTION: {
    title: 'Caution',
    icon: ShieldAlert,
    borderClass: 'border-rose-500/40',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-500 dark:text-rose-400',
  },
};

export const GitHubAlert: React.FC<GitHubAlertProps> = ({ type, children }) => {
  const config = ALERT_CONFIGS[type] || ALERT_CONFIGS.NOTE;
  const IconComponent = config.icon;

  return (
    <div
      className={`my-3 p-3.5 rounded-xl border-l-4 ${config.borderClass} ${config.bgClass} border transition-colors shadow-xs`}
    >
      <div className={`flex items-center gap-2 font-semibold text-xs mb-1.5 ${config.textClass}`}>
        <IconComponent className="w-4 h-4 shrink-0" />
        <span>{config.title}</span>
      </div>
      <div className="text-xs text-fg leading-relaxed pl-6 [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
};
