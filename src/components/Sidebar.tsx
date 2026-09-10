import React from 'react';
import { Agent, Room } from '../types';
import { 
  Hash, 
  Cpu, 
  GitPullRequest, 
  AlertTriangle, 
  MessageSquare, 
  Plus, 
  Terminal, 
  FolderGit2, 
  Database, 
  Wrench, 
  UserCheck, 
  CheckCircle2, 
  Circle,
  ExternalLink
} from 'lucide-react';

interface SidebarProps {
  rooms: Room[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  agents: Agent[];
  onToggleAgentInRoom: (agentId: string) => void;
  onSelectAgentForInspect: (agent: Agent) => void;
  onOpenConnectModal: () => void;
  currentWorkspace: string;
  onChangeWorkspace: (workspace: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  agents,
  onToggleAgentInRoom,
  onSelectAgentForInspect,
  onOpenConnectModal,
  currentWorkspace,
  onChangeWorkspace,
}) => {
  const getRoomIcon = (iconName: string) => {
    switch (iconName) {
      case 'Cpu':
        return <Cpu className="w-4 h-4 text-emerald-400" />;
      case 'GitPullRequest':
        return <GitPullRequest className="w-4 h-4 text-purple-400" />;
      case 'AlertTriangle':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      default:
        return <MessageSquare className="w-4 h-4 text-blue-400" />;
    }
  };

  const getStatusBadge = (status: Agent['status']) => {
    switch (status) {
      case 'thinking':
        return <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />思考中</span>;
      case 'accessing_workspace':
        return <span className="flex items-center gap-1 text-[10px] text-blue-400 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />访问工作区</span>;
      case 'using_skill':
        return <span className="flex items-center gap-1 text-[10px] text-purple-400 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />执行Skill</span>;
      case 'querying_memory':
        return <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />检索私有记忆</span>;
      default:
        return <span className="flex items-center gap-1 text-[10px] text-gray-500 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />ACP就绪</span>;
    }
  };

  const activeRoom = rooms.find(r => r.id === activeRoomId);

  return (
    <aside
      id="buzz-sidebar"
      className="w-64 bg-[#0a0d13] border-r border-[#1a202c] flex flex-col shrink-0 select-none text-gray-300 text-xs overflow-hidden"
    >
      {/* Workspace Switcher */}
      <div className="p-3 border-b border-[#1a202c] bg-[#0c1017]">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5 flex items-center justify-between">
          <span>工作空间 (WORKSPACE)</span>
          <span className="text-emerald-500 font-mono">Git Repo</span>
        </div>
        <div className="flex items-center justify-between bg-[#141923] p-2 rounded border border-[#232c3d]">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-6 h-6 rounded bg-emerald-950/80 border border-emerald-700/50 flex items-center justify-center text-emerald-400 font-bold shrink-0">
              <FolderGit2 className="w-3.5 h-3.5" />
            </div>
            <div className="truncate">
              <div className="font-semibold text-gray-200 text-xs truncate">{currentWorkspace}</div>
              <div className="text-[10px] text-gray-400 font-mono">ACP CWD: /home/block/buzz</div>
            </div>
          </div>
          <select
            value={currentWorkspace}
            onChange={(e) => onChangeWorkspace(e.target.value)}
            className="opacity-0 absolute inset-0 cursor-pointer"
            title="Switch Workspace"
          >
            <option value="block/buzz">block/buzz</option>
            <option value="square/cash-app-core">square/cash-app-core</option>
            <option value="open-agent/acp-sandbox">open-agent/acp-sandbox</option>
          </select>
        </div>
      </div>

      {/* Discussion Rooms */}
      <div className="p-3 border-b border-[#1a202c]">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center justify-between">
          <span>协作房间 (ROOMS)</span>
          <span className="text-gray-500 font-mono text-[10px]">Nostr Relay</span>
        </div>
        <nav className="space-y-1">
          {rooms.map((room) => {
            const isActive = room.id === activeRoomId;
            return (
              <button
                key={room.id}
                id={`room-item-${room.id}`}
                onClick={() => onSelectRoom(room.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-all text-left cursor-pointer group ${
                  isActive
                    ? 'bg-[#1a2333] text-white font-medium border border-blue-500/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#111622]'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {getRoomIcon(room.iconName)}
                  <span className="truncate">{room.name}</span>
                </div>
                {room.unreadCount > 0 && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                    {room.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ACP Connected Agents Fleet */}
      <div className="flex-1 p-3 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center justify-between">
          <span>ACP Agent 编队 ({agents.length})</span>
          <button
            onClick={onOpenConnectModal}
            className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-0.5 cursor-pointer"
            title="接入新的 ACP 协议 Agent"
          >
            <Plus className="w-3 h-3" />
            <span>接入</span>
          </button>
        </div>

        <div className="space-y-2">
          {agents.map((agent) => {
            const isInRoom = activeRoom?.activeAgentIds.includes(agent.id) ?? false;

            return (
              <div
                key={agent.id}
                id={`agent-card-${agent.id}`}
                className={`p-2.5 rounded border transition-all ${
                  isInRoom
                    ? 'bg-[#111722] border-[#253247] shadow-sm'
                    : 'bg-[#0c0f17] border-[#181f2c] opacity-70 hover:opacity-100'
                }`}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between gap-1.5 mb-1.5">
                  <div 
                    className="flex items-center gap-2 cursor-pointer flex-1 overflow-hidden"
                    onClick={() => onSelectAgentForInspect(agent)}
                    title="点击查看 Agent 的 Workspace、Memory 与 Skills 诊断"
                  >
                    <span className="text-base shrink-0">{agent.avatar}</span>
                    <div className="truncate">
                      <div className="font-semibold text-gray-200 text-xs flex items-center gap-1">
                        <span className="truncate">{agent.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">{agent.role}</div>
                    </div>
                  </div>

                  {/* Toggle In/Out of Room */}
                  <button
                    onClick={() => onToggleAgentInRoom(agent.id)}
                    className={`p-1 rounded text-xs transition-colors shrink-0 cursor-pointer ${
                      isInRoom
                        ? 'text-emerald-400 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/50'
                        : 'text-gray-500 hover:text-gray-300 bg-[#161d2a] border border-[#232d3f]'
                    }`}
                    title={isInRoom ? '已在当前讨论室中（点击移出）' : '拉入当前讨论室 (通过 ACP 协议会话)'}
                  >
                    {isInRoom ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Status and Capability Chips */}
                <div className="mt-1 flex items-center justify-between border-t border-[#1c2436] pt-1.5">
                  {getStatusBadge(agent.status)}
                  <span className="text-[10px] font-mono text-gray-500 uppercase bg-[#090c12] px-1 rounded border border-[#1a2233]">
                    {agent.acpTransport}
                  </span>
                </div>

                {/* 3 Pillars Badge: Memory / Workspace / Skills */}
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[9px] font-mono text-gray-400">
                  <div 
                    className="bg-[#151c29] p-1 rounded text-center border border-[#1f293d]" 
                    title={`私有记忆: ${agent.memory.persistentItems.length}条持久规则 (${agent.memory.persistentType})`}
                  >
                    <div className="text-gray-500">记忆</div>
                    <div className="text-emerald-400 font-bold">{agent.memory.persistentItems.length}条</div>
                  </div>
                  <div 
                    className="bg-[#151c29] p-1 rounded text-center border border-[#1f293d]" 
                    title={`工作空间: ${agent.workspace.activeFiles.length}个活跃文件 (${agent.workspace.permissionMode})`}
                  >
                    <div className="text-gray-500">工作区</div>
                    <div className="text-blue-400 font-bold">{agent.workspace.activeFiles.length}文件</div>
                  </div>
                  <div 
                    className="bg-[#151c29] p-1 rounded text-center border border-[#1f293d]" 
                    title={`技能工具: ${agent.skills.length}个MCP/内置技能`}
                  >
                    <div className="text-gray-500">技能</div>
                    <div className="text-purple-400 font-bold">{agent.skills.length}项</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Protocol Badge Footer */}
      <div className="p-2.5 border-t border-[#1a202c] bg-[#0c1017] text-[10px] text-gray-500 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-mono text-gray-400">ACP v1.0.4 Stdio/WS</span>
        </div>
        <span className="text-emerald-500 font-bold">READY</span>
      </div>
    </aside>
  );
};
