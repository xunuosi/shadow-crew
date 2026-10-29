import {
  AcpPermissionDecision,
  AcpPermissionGrant,
  AcpPermissionRequest,
} from '../types';
import { getTauriInvoke } from './dbClient';

export function hasAcpPermissionBridge(): boolean {
  return getTauriInvoke() !== null;
}

export function upsertPendingAcpPermission(
  previous: AcpPermissionRequest[],
  request: AcpPermissionRequest
): AcpPermissionRequest[] {
  const existingIndex = previous.findIndex(
    (item) => item.agentId === request.agentId && item.requestId === request.requestId
  );
  if (existingIndex === -1) {
    return [...previous, request].sort((a, b) => a.createdAt - b.createdAt);
  }
  const next = [...previous];
  next[existingIndex] = request;
  return next;
}

export function removePendingAcpPermission(
  previous: AcpPermissionRequest[],
  agentId: string,
  requestId: string
): AcpPermissionRequest[] {
  return previous.filter(
    (request) => !(request.agentId === agentId && request.requestId === requestId)
  );
}

export async function listPendingAcpPermissions(): Promise<AcpPermissionRequest[]> {
  const invoke = getTauriInvoke();
  if (!invoke) return [];
  const result = await invoke('list_pending_acp_permissions');
  return Array.isArray(result) ? (result as AcpPermissionRequest[]) : [];
}

export async function respondToAcpPermission(options: {
  agentId: string;
  requestId: string;
  decision: AcpPermissionDecision;
}): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('当前环境未提供本地 ACP 权限通道');
  }
  await invoke('respond_acp_permission', {
    agentId: options.agentId,
    requestId: options.requestId,
    decision: options.decision,
  });
}

export async function listAcpPermissionGrants(
  agentId?: string
): Promise<AcpPermissionGrant[]> {
  const invoke = getTauriInvoke();
  if (!invoke) return [];
  const result = await invoke('list_acp_permission_grants', {
    agentId: agentId || null,
  });
  return Array.isArray(result) ? (result as AcpPermissionGrant[]) : [];
}

export async function revokeAcpPermissionGrant(grantId: string): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  return Boolean(await invoke('revoke_acp_permission_grant', { grantId }));
}

export async function revokeAllAcpPermissionGrants(): Promise<number> {
  const invoke = getTauriInvoke();
  if (!invoke) return 0;
  return Number(await invoke('revoke_all_acp_permission_grants')) || 0;
}

export async function revokeAcpPermissionGrantsForAgent(agentId: string): Promise<number> {
  const invoke = getTauriInvoke();
  if (!invoke) return 0;
  return Number(await invoke('revoke_acp_permission_grants_for_agent', { agentId })) || 0;
}

export async function revokeAcpPermissionGrantsForScope(
  scopeType: AcpPermissionRequest['scopeType'],
  scopeId: string
): Promise<number> {
  const invoke = getTauriInvoke();
  if (!invoke) return 0;
  return (
    Number(
      await invoke('revoke_acp_permission_grants_for_scope', {
        scopeType,
        scopeId,
      })
    ) || 0
  );
}
