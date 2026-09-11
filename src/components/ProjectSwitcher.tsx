import React, { useState, useRef, useEffect } from 'react';
import { Project, Agent } from '../types';
import { 
  FolderGit2, 
  ChevronDown, 
  Check, 
  Plus, 
  ExternalLink, 
  HardDrive, 
  Users,
  Layers
} from 'lucide-react';

interface ProjectSwitcherProps {
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  agents: Agent[];
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  agents,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!activeProject) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Active Project Trigger Header */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 border-b border-border bg-surface-subtle flex items-center justify-between cursor-pointer hover:bg-surface-hover transition-colors group select-none"
        title="点击切换工作区项目 (Project Space)"
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          <div className="w-6 h-6 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0 border border-accent/30 group-hover:scale-105 transition-transform">
            🥷
          </div>
          <div className="truncate">
            <div className="font-bold text-fg text-xs truncate flex items-center gap-1">
              <span className="truncate">{activeProject.name}</span>
              <ChevronDown className={`w-3 h-3 text-fg-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            <div className="text-[9px] text-fg-muted font-mono truncate">
              {activeProject.assignedAgentIds.length} Agents 常驻 · L0 Space
            </div>
          </div>
        </div>
        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono border border-emerald-500/30 shrink-0">
          Project
        </span>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-2 right-2 top-full mt-1 bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden text-xs py-1.5 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-fg-muted uppercase tracking-wider flex items-center justify-between border-b border-border mb-1">
            <span>切换项目空间 (Projects)</span>
            <Layers className="w-3 h-3 text-fg-muted" />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1 px-1">
            {projects.map((project) => {
              const isSelected = project.id === activeProjectId;
              const projectAgents = (project.assignedAgentIds || [])
                .map((id) => agents.find((a) => a.id === id))
                .filter(Boolean) as Agent[];

              return (
                <button
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-all flex items-start justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
                      : 'hover:bg-surface-hover text-fg'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold truncate">
                      <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-accent' : 'text-fg-muted'}`} />
                      <span className="truncate">{project.name}</span>
                    </div>
                    <div className="text-[10px] text-fg-muted truncate mt-0.5 line-clamp-1">
                      {project.description}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-fg-muted font-mono">
                      <span className="flex items-center gap-1 truncate">
                        <HardDrive className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate max-w-[140px]">{project.localWorkspaceRoot.split('/').pop()}</span>
                      </span>
                      <span>·</span>
                      <span>{projectAgents.length} Agents</span>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-accent shrink-0 mt-1" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border mt-1.5 pt-1 px-1">
            <div className="px-2.5 py-1 text-[10px] text-fg-muted flex items-center justify-between">
              <span>全局代码库规范统一生效中</span>
              <span className="font-mono text-accent">Nostr + ACP</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
