import React from 'react';
import { Radio, Terminal, BookOpen, Plus, ShieldCheck, Activity, Cpu } from 'lucide-react';
import { NinjaIcon } from './NinjaIcon';
import { ThemeSwitcher } from './ThemeSwitcher';

interface HeaderBarProps {
  currentWorkspace: string;
  activeRoomName: string;
  onOpenArchitectureModal: () => void;
  onOpenConnectModal: () => void;
  onOpenRustTauriHub: () => void;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  currentWorkspace,
  activeRoomName,
  onOpenArchitectureModal,
  onOpenConnectModal,
  onOpenRustTauriHub,
  isInspectorOpen,
  onToggleInspector,
}) => {
  return (
    <header
      id="shinobi-app-header"
      className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 select-none shrink-0 text-fg-secondary text-xs font-mono transition-colors duration-150"
    >
      {/* Left: Window Dots & Title */}
      <div className="flex items-center gap-3">
        {/* macOS style window dots */}
        <div className="flex items-center gap-1.5 mr-1">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80" />
        </div>

        <div className="flex items-center gap-2 font-semibold text-fg">
          <span className="text-accent font-bold tracking-wider flex items-center gap-1.5 bg-accent/15 px-2 py-0.5 rounded border border-accent/30 shadow-xs">
            <NinjaIcon className="w-4 h-4 text-accent" />
            <span className="text-fg tracking-widest text-xs font-bold">SHINOBI</span>
          </span>
          <span className="text-fg-muted">/</span>
          <span className="text-fg-secondary">ACP 替身工作台</span>
          <span className="text-fg-muted">/</span>
          <span className="text-accent font-mono">#{activeRoomName}</span>
        </div>
      </div>

      {/* Center: Nostr Relay & Workspace Status */}
      <div className="hidden md:flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-subtle border border-border text-fg-secondary">
          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          <span>Relay:</span>
          <span className="text-emerald-500">wss://relay.shinobi.local</span>
          <span className="text-[10px] text-fg-muted font-sans">8ms</span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-subtle border border-border text-fg-secondary">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
          <span>Repo:</span>
          <span className="text-blue-500 font-bold">{currentWorkspace}</span>
          <span className="text-[10px] px-1 bg-surface rounded text-blue-500 border border-border">main</span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <ThemeSwitcher variant="compact" />

        {/* Rust + Tauri Architecture Hub Button */}
        <button
          id="btn-open-rust-tauri-hub"
          onClick={onOpenRustTauriHub}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-orange-500/15 border border-orange-500/30 hover:bg-orange-500/25 text-orange-600 dark:text-orange-300 transition-colors text-xs font-sans cursor-pointer shadow-xs"
          title="查看服务端 Rust (Axum/Nostr Relay) + 桌面端 Tauri (Rust+React) 全套技术方案与源码"
        >
          <span className="text-sm leading-none">🦀</span>
          <span className="font-semibold hidden sm:inline">Rust+Tauri</span>
          <span className="hidden xl:inline text-[9px] px-1.5 py-0.5 bg-orange-500/20 text-orange-600 dark:text-orange-300 rounded font-mono shrink-0">
            v2 + Axum
          </span>
        </button>

        {/* Core Question & Architecture Button */}
        <button
          id="btn-open-acp-deepdive"
          onClick={onOpenArchitectureModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-600 dark:text-indigo-300 transition-colors text-xs font-sans cursor-pointer"
          title="深入解答：ACP下Agent的Memory、Workspace与Skill工作原理"
        >
          <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
          <span className="hidden sm:inline font-medium">ACP 原理解答</span>
          <span className="sm:hidden font-medium">原理解答</span>
        </button>

        {/* Connect Agent via ACP */}
        <button
          id="btn-connect-agent"
          onClick={onOpenConnectModal}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-accent-fg hover:opacity-90 transition-colors text-xs font-sans font-medium cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>接入 Agent</span>
        </button>

        {/* Toggle ACP Inspector */}
        <button
          id="btn-toggle-inspector"
          onClick={onToggleInspector}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors text-xs font-sans cursor-pointer ${
            isInspectorOpen
              ? 'bg-accent/15 border-accent text-accent font-semibold'
              : 'bg-surface-subtle border-border text-fg-muted hover:text-fg'
          }`}
          title="切换 ACP 诊断控制台与 Workspace/Memory 检查器"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">ACP 检查器</span>
        </button>
      </div>
    </header>
  );
};
