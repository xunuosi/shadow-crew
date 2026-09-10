import React from 'react';
import { Radio, Terminal, BookOpen, Plus, ShieldCheck, Activity, Cpu } from 'lucide-react';
import { NinjaIcon } from './NinjaIcon';

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
      id="buzz-app-header"
      className="h-12 bg-[#0d1017] border-b border-[#1f2633] flex items-center justify-between px-4 select-none shrink-0 text-gray-300 text-xs font-mono"
    >
      {/* Left: Window Dots & Title */}
      <div className="flex items-center gap-3">
        {/* macOS style window dots */}
        <div className="flex items-center gap-1.5 mr-1">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:opacity-80" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:opacity-80" />
        </div>

        <div className="flex items-center gap-2 font-semibold text-gray-200">
          <span className="text-cyan-400 font-bold tracking-wider flex items-center gap-1.5 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40 shadow-xs">
            <NinjaIcon className="w-4 h-4 text-cyan-400" />
            <span className="text-white tracking-widest text-xs">SHINOBI</span>
          </span>
          <span className="text-gray-600">/</span>
          <span className="text-gray-300">ACP 替身工作台</span>
          <span className="text-gray-600">/</span>
          <span className="text-amber-400/90 font-mono">#{activeRoomName}</span>
        </div>
      </div>

      {/* Center: Nostr Relay & Workspace Status */}
      <div className="hidden md:flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#131722] border border-[#232b3b] text-gray-300">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Relay:</span>
          <span className="text-emerald-400">wss://relay.buzz.local</span>
          <span className="text-[10px] text-gray-500 font-sans">8ms</span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#131722] border border-[#232b3b] text-gray-300">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>Repo:</span>
          <span className="text-blue-300 font-bold">{currentWorkspace}</span>
          <span className="text-[10px] px-1 bg-[#1c2436] rounded text-blue-400">main</span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Rust + Tauri Architecture Hub Button */}
        <button
          id="btn-open-rust-tauri-hub"
          onClick={onOpenRustTauriHub}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-orange-950/80 border border-orange-700/60 hover:bg-orange-900/80 text-orange-200 transition-colors text-xs font-sans cursor-pointer shadow-xs"
          title="查看服务端 Rust (Axum/Nostr Relay) + 桌面端 Tauri (Rust+React) 全套技术方案与源码"
        >
          <span className="text-sm leading-none">🦀</span>
          <span className="font-semibold hidden sm:inline">Rust+Tauri 架构方案</span>
          <span className="sm:hidden font-semibold">Rust+Tauri</span>
          <span className="hidden xl:inline text-[9px] px-1 py-0.2 bg-orange-900/90 text-orange-300 rounded font-mono">
            v2 + Axum
          </span>
        </button>

        {/* Core Question & Architecture Button */}
        <button
          id="btn-open-acp-deepdive"
          onClick={onOpenArchitectureModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-950/70 border border-indigo-700/50 hover:bg-indigo-900/80 text-indigo-200 transition-colors text-xs font-sans cursor-pointer"
          title="深入解答：ACP下Agent的Memory、Workspace与Skill工作原理"
        >
          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline font-medium">ACP 原理解答</span>
          <span className="sm:hidden font-medium">原理解答</span>
        </button>

        {/* Connect Agent via ACP */}
        <button
          id="btn-connect-agent"
          onClick={onOpenConnectModal}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white transition-colors text-xs font-sans font-medium cursor-pointer shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>接入 Agent (ACP)</span>
        </button>

        {/* Toggle ACP Inspector */}
        <button
          id="btn-toggle-inspector"
          onClick={onToggleInspector}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors text-xs font-sans cursor-pointer ${
            isInspectorOpen
              ? 'bg-[#1e2638] border-emerald-500/50 text-emerald-300'
              : 'bg-[#131722] border-[#232b3b] text-gray-400 hover:text-gray-200'
          }`}
          title="切换 ACP 诊断控制台与 Workspace/Memory 检查器"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">ACP 协议检查器</span>
        </button>
      </div>
    </header>
  );
};
