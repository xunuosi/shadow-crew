import React, { Suspense, lazy } from 'react';
import type {
  Agent,
  AgentTeam,
  Channel,
  Message,
  TopicMessageData,
  DiscussionMode,
  GameRolesConfig,
  GameTheoreticPolicy,
  DuelRolesConfig,
  AcpPermissionRequest,
  AcpPermissionDecision,
} from '../types';
import { AcpPermissionModal } from './AcpPermissionModal';
import { AcpPermissionCenterModal } from './AcpPermissionCenterModal';

const NewTopicModal = lazy(() => import('./NewTopicModal').then((m) => ({ default: m.NewTopicModal })));
const EditTopicModal = lazy(() => import('./EditTopicModal').then((m) => ({ default: m.EditTopicModal })));
const AgentTeamsModal = lazy(() => import('./AgentTeamsModal').then((m) => ({ default: m.AgentTeamsModal })));
const CreateChannelModal = lazy(() => import('./CreateChannelModal').then((m) => ({ default: m.CreateChannelModal })));
const ChannelMembersModal = lazy(() => import('./ChannelMembersModal').then((m) => ({ default: m.ChannelMembersModal })));
const DeleteChannelModal = lazy(() => import('./DeleteChannelModal').then((m) => ({ default: m.DeleteChannelModal })));
const ConnectAgentModal = lazy(() => import('./ConnectAgentModal').then((m) => ({ default: m.ConnectAgentModal })));
const CreateTeamModal = lazy(() => import('./CreateTeamModal').then((m) => ({ default: m.CreateTeamModal })));
const AgentDefaultsModal = lazy(() => import('./AgentDefaultsModal').then((m) => ({ default: m.AgentDefaultsModal })));
const StorageSettingsModal = lazy(() => import('./StorageSettingsModal').then((m) => ({ default: m.StorageSettingsModal })));
const RustTauriArchitectureHub = lazy(() => import('./RustTauriArchitectureHub').then((m) => ({ default: m.RustTauriArchitectureHub })));

export interface AppModalsContainerProps {
  // Agent Teams Management
  isAgentTeamsModalOpen: boolean;
  onCloseAgentTeamsModal: () => void;
  agents: Agent[];
  teams: AgentTeam[];
  onCreateTeam: (team: Omit<AgentTeam, 'id'>) => void;
  onOpenConnectModalFromTeams: () => void;

  // Create Team Popup
  isCreateTeamModalOpen: boolean;
  onCloseCreateTeamModal: () => void;

  // Agent Defaults
  isAgentDefaultsModalOpen: boolean;
  onCloseAgentDefaultsModal: () => void;
  onOpenStorageSettings: () => void;

  // ACP Permissions
  pendingAcpPermissions: AcpPermissionRequest[];
  onAcpPermissionDecision: (decision: AcpPermissionDecision) => Promise<void>;
  isPermissionCenterOpen: boolean;
  onClosePermissionCenter: () => void;

  // Storage Settings
  isStorageSettingsModalOpen: boolean;
  onCloseStorageSettingsModal: () => void;
  allMessages: Message[];
  onMessagesCleared: () => Promise<void>;

  // Channel Creation
  isCreateChannelOpen: boolean;
  onCloseCreateChannelModal: () => void;
  currentUserId: string;
  onCreateChannel: (
    newChan: Omit<Channel, 'id' | 'unreadCount' | 'workspaceBindingId'>,
    workspace: { mode: 'default' | 'custom'; cwd?: string }
  ) => Promise<void>;

  // Channel Members & Delete
  targetModalChannel: Channel | null;
  isChannelMembersModalOpen: boolean;
  onCloseChannelMembersModal: () => void;
  onUpdateChannelMembers: (channelId: string, updatedMemberIds: string[]) => Promise<void>;

  isDeleteChannelModalOpen: boolean;
  onCloseDeleteChannelModal: () => void;
  modalChannelUnresolvedTopics: number;
  onDeleteChannel: (channelId: string) => Promise<void>;

  // Connect / Edit ACP Agent Modal
  isConnectModalOpen: boolean;
  onCloseConnectModal: () => void;
  editingAgent: Agent | null;
  duplicatingAgent: Agent | null;
  defaultWorkspaceRoot?: string;
  onUpdateAgent: (agentId: string, updatedData: Partial<Agent>) => void;
  onConnectAgent: (agentData: Partial<Agent>) => void;

  // New Topic Modal
  isNewTopicModalOpen: boolean;
  onCloseNewTopicModal: () => void;
  newTopicScopeType: 'dm' | 'channel';
  newTopicChannel?: Channel;
  newTopicDmAgent?: Agent;
  newTopicDmThreadId?: string;
  newTopicChannelWorkspaceCwd?: string;
  newTopicAgents: Agent[];
  onCreateTopic: (topicData: any, workspace: any) => Promise<void> | void;

  // Edit Topic Modal
  editingTopic: TopicMessageData | null;
  editingTopicChannel?: Channel;
  editingTopicAgents: Agent[];
  onCloseEditTopicModal: () => void;
  onUpdateTopic: (
    topicId: string,
    updatedFields: {
      title: string;
      description: string;
      assignedAgentIds: string[];
      discussionMode?: DiscussionMode;
      gameRoles?: GameRolesConfig;
      gamePolicy?: GameTheoreticPolicy;
      duelRoles?: DuelRolesConfig;
    }
  ) => void;

  // Rust + Tauri Architecture Hub
  isRustTauriHubOpen: boolean;
  onCloseRustTauriHub: () => void;
}

export const AppModalsContainer: React.FC<AppModalsContainerProps> = ({
  isAgentTeamsModalOpen,
  onCloseAgentTeamsModal,
  agents,
  teams,
  onCreateTeam,
  onOpenConnectModalFromTeams,

  isCreateTeamModalOpen,
  onCloseCreateTeamModal,

  isAgentDefaultsModalOpen,
  onCloseAgentDefaultsModal,
  onOpenStorageSettings,

  pendingAcpPermissions,
  onAcpPermissionDecision,
  isPermissionCenterOpen,
  onClosePermissionCenter,

  isStorageSettingsModalOpen,
  onCloseStorageSettingsModal,
  allMessages,
  onMessagesCleared,

  isCreateChannelOpen,
  onCloseCreateChannelModal,
  currentUserId,
  onCreateChannel,

  targetModalChannel,
  isChannelMembersModalOpen,
  onCloseChannelMembersModal,
  onUpdateChannelMembers,

  isDeleteChannelModalOpen,
  onCloseDeleteChannelModal,
  modalChannelUnresolvedTopics,
  onDeleteChannel,

  isConnectModalOpen,
  onCloseConnectModal,
  editingAgent,
  duplicatingAgent,
  defaultWorkspaceRoot = '~/.shadow-crew',
  onUpdateAgent,
  onConnectAgent,

  isNewTopicModalOpen,
  onCloseNewTopicModal,
  newTopicScopeType,
  newTopicChannel,
  newTopicDmAgent,
  newTopicDmThreadId,
  newTopicChannelWorkspaceCwd,
  newTopicAgents,
  onCreateTopic,

  editingTopic,
  editingTopicChannel,
  editingTopicAgents,
  onCloseEditTopicModal,
  onUpdateTopic,

  isRustTauriHubOpen,
  onCloseRustTauriHub,
}) => {
  return (
    <Suspense fallback={null}>
      {/* 7. Modals: Agent Teams Management */}
      {isAgentTeamsModalOpen && (
        <AgentTeamsModal
          isOpen={isAgentTeamsModalOpen}
          onClose={onCloseAgentTeamsModal}
          agents={agents}
          teams={teams}
          onCreateTeam={onCreateTeam}
          onOpenConnectModal={onOpenConnectModalFromTeams}
        />
      )}

      {/* 7.1 Modal: Create Team Popup */}
      {isCreateTeamModalOpen && (
        <CreateTeamModal
          isOpen={isCreateTeamModalOpen}
          onClose={onCloseCreateTeamModal}
          agents={agents}
          onCreateTeam={onCreateTeam}
        />
      )}

      {/* 7.2 Modal: Agent Defaults */}
      {isAgentDefaultsModalOpen && (
        <AgentDefaultsModal
          isOpen={isAgentDefaultsModalOpen}
          onClose={onCloseAgentDefaultsModal}
          onOpenStorageSettings={onOpenStorageSettings}
        />
      )}

      {/* ACP Permission Modal */}
      {pendingAcpPermissions[0] && (
        <AcpPermissionModal
          request={pendingAcpPermissions[0]}
          agent={agents.find((agent) => agent.id === pendingAcpPermissions[0].agentId)}
          queuedCount={Math.max(0, pendingAcpPermissions.length - 1)}
          onDecision={onAcpPermissionDecision}
        />
      )}

      {/* ACP Permission Center */}
      <AcpPermissionCenterModal
        isOpen={isPermissionCenterOpen}
        agents={agents}
        onClose={onClosePermissionCenter}
      />

      {/* 7.3 Modal: Storage Architecture & Cache Management (Option 3: SQLite) */}
      {isStorageSettingsModalOpen && (
        <StorageSettingsModal
          isOpen={isStorageSettingsModalOpen}
          onClose={onCloseStorageSettingsModal}
          messages={allMessages}
          onMessagesCleared={onMessagesCleared}
        />
      )}

      {/* 8. Modals: Create Topic / Channel */}
      {isCreateChannelOpen && (
        <CreateChannelModal
          isOpen={isCreateChannelOpen}
          onClose={onCloseCreateChannelModal}
          currentUserId={currentUserId}
          teams={teams}
          agents={agents}
          onCreateChannel={onCreateChannel}
        />
      )}

      {/* 8.1 Modal: Channel Members & Invites */}
      {targetModalChannel && isChannelMembersModalOpen && (
        <ChannelMembersModal
          isOpen={isChannelMembersModalOpen}
          onClose={onCloseChannelMembersModal}
          channel={targetModalChannel}
          agents={agents}
          currentUserId={currentUserId}
          onUpdateMembers={onUpdateChannelMembers}
        />
      )}

      {/* 8.2 Modal: Delete Channel Confirmation */}
      {targetModalChannel && isDeleteChannelModalOpen && (
        <DeleteChannelModal
          isOpen={isDeleteChannelModalOpen}
          onClose={onCloseDeleteChannelModal}
          channel={targetModalChannel}
          unresolvedTopicsCount={modalChannelUnresolvedTopics}
          onConfirmDelete={onDeleteChannel}
        />
      )}

      {/* 9. Connect / Edit ACP Agent Modal */}
      {isConnectModalOpen && (
        <ConnectAgentModal
          isOpen={isConnectModalOpen}
          onClose={onCloseConnectModal}
          initialAgent={editingAgent}
          duplicateAgent={duplicatingAgent}
          defaultWorkspaceRoot={defaultWorkspaceRoot}
          onUpdateAgent={onUpdateAgent}
          onConnectAgent={onConnectAgent}
        />
      )}

      {/* 9.1 Modal: Create New Topic */}
      {isNewTopicModalOpen && (
        <NewTopicModal
          isOpen={isNewTopicModalOpen}
          onClose={onCloseNewTopicModal}
          scopeType={newTopicScopeType}
          channel={newTopicChannel}
          dmAgent={newTopicDmAgent}
          dmThreadId={newTopicDmThreadId}
          channelWorkspaceCwd={newTopicChannelWorkspaceCwd}
          agents={newTopicAgents}
          onCreateTopic={onCreateTopic}
        />
      )}

      {/* 9.1.1 Modal: Edit Topic */}
      {Boolean(editingTopic) && (
        <EditTopicModal
          isOpen={Boolean(editingTopic)}
          topic={editingTopic!}
          channel={editingTopicChannel}
          agents={editingTopicAgents}
          onClose={onCloseEditTopicModal}
          onUpdateTopic={onUpdateTopic}
        />
      )}

      {/* 10. Rust + Tauri Architecture & Source Code Hub */}
      {isRustTauriHubOpen && (
        <RustTauriArchitectureHub
          isOpen={isRustTauriHubOpen}
          onClose={onCloseRustTauriHub}
        />
      )}
    </Suspense>
  );
};
