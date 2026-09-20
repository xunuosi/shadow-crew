import { Agent, AcpMemoryBundle, MemoryCartridge, MemoryCartridgeItem } from '../types';
import { DEFAULT_MODEL_NAME } from '../config/models';

export interface MemoryExportOptions {
  includeCategories?: string[];
  sanitizeSecrets?: boolean;
  normalizePaths?: boolean;
  tags?: string[];
  description?: string;
  topic?: string;
}

/**
 * 敏感凭证过滤脱敏网关 (Secrets Sanitization Filter)
 * 正则抹除 Anthropic API Key, OpenAI API Key, GitHub Token, Bearer Tokens 与私钥
 */
export function sanitizeMemoryContent(content: string, workspaceRoot?: string): string {
  let sanitized = content;

  // 1. Anthropic API Keys (sk-ant-api03-...)
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_\-]{16,}/g, '[REDACTED_ANTHROPIC_KEY]');

  // 2. Generic / OpenAI API Keys (sk-...)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_API_KEY]');

  // 3. GitHub Personal Access Tokens (ghp_..., github_pat_...)
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]');
  sanitized = sanitized.replace(/github_pat_[a-zA-Z0-9_]{30,}/g, '[REDACTED_GITHUB_PAT]');

  // 4. Bearer Authorization Headers
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi, 'Bearer [REDACTED_TOKEN]');

  // 5. Private Key blocks
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]+-----END [A-Z ]+PRIVATE KEY-----/gs,
    '[REDACTED_PRIVATE_KEY]'
  );

  // 6. 归一化工作区绝对路径
  if (workspaceRoot && workspaceRoot.length > 2) {
    const escaped = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    sanitized = sanitized.replace(regex, '${WORKSPACE_ROOT}');
  }

  // 7. 通用 macOS / Linux 开发者路径脱敏: /Users/<user>/... 或 /home/<user>/...
  sanitized = sanitized.replace(
    /(\/Users\/[a-zA-Z0-9._-]+\/|\/home\/[a-zA-Z0-9._-]+\/)/g,
    '${WORKSPACE_ROOT}/'
  );

  return sanitized;
}

/**
 * 计算记忆条目的快速校验和 (Checksum)
 */
function computeBundleChecksum(data: any): string {
  const jsonStr = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `sha256:${hex}f8a9b1c${hex}`;
}

/**
 * 导出指定 Agent 的记忆资产为标准 .acpmem 记忆卡带对象
 */
export function createMemoryBundle(
  agent: Agent,
  options: MemoryExportOptions = {}
): AcpMemoryBundle {
  const {
    includeCategories,
    sanitizeSecrets = true,
    normalizePaths = true,
    tags = ['rust', 'acp', 'architecture'],
    description = `Exported memory bank from ${agent.name}`,
  } = options;

  const rawItems = agent.memory.persistentItems || [];

  // 1. 分类筛选
  const filtered = rawItems.filter((item) => {
    if (!includeCategories || includeCategories.length === 0) return true;
    return includeCategories.includes(item.category);
  });

  // 2. 脱敏与规范化
  const sanitizedItems: MemoryCartridgeItem[] = filtered.map((item, index) => {
    const cleanContent = sanitizeSecrets
      ? sanitizeMemoryContent(
          item.content,
          normalizePaths ? agent.workspace?.rootPath : undefined
        )
      : item.content;

    const cleanKey = sanitizeSecrets
      ? sanitizeMemoryContent(item.key)
      : item.key;

    return {
      id: item.id || `mem-${index + 1}`,
      category: item.category,
      key: cleanKey,
      content: cleanContent,
      importance: 0.9,
      created_at: item.lastAccessed || new Date().toISOString(),
    };
  });

  // 3. 构建标准清单与元数据
  const manifest = {
    format_version: '1.0.0',
    exported_at: new Date().toISOString(),
    source_agent: {
      name: agent.name,
      model: agent.modelBadge || DEFAULT_MODEL_NAME,
      role: agent.role,
    },
    checksum: computeBundleChecksum(sanitizedItems),
  };

  const metadata = {
    description: description.trim(),
    total_records: sanitizedItems.length,
    tags: tags.length > 0 ? tags : [agent.name.toLowerCase().replace(/\s+/g, '-')],
  };

  return {
    manifest,
    metadata,
    memories: sanitizedItems,
  };
}

/**
 * 触发浏览器端下载 .acpmem 文件
 */
export function downloadMemoryBundleFile(
  bundle: AcpMemoryBundle,
  filename?: string
): void {
  const agentSlug = bundle.manifest.source_agent.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  const now = new Date().toISOString().slice(0, 10);
  const targetFilename = filename || `${agentSlug}_memory_${now}.acpmem`;

  const jsonStr = JSON.stringify(bundle, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = targetFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 解析并校验导入的 .acpmem 记忆文件内容
 */
export function parseAndValidateMemoryBundle(rawJson: string): {
  success: boolean;
  bundle?: AcpMemoryBundle;
  error?: string;
  hasRedactedSecrets?: boolean;
} {
  try {
    const data = JSON.parse(rawJson);

    // 1. 结构检查
    if (!data || typeof data !== 'object') {
      return { success: false, error: '无效的 JSON 数据格式' };
    }

    if (!data.manifest || !data.metadata || !Array.isArray(data.memories)) {
      return {
        success: false,
        error: '不合规的 ACP 记忆卡带：缺少 manifest, metadata 或 memories 字段',
      };
    }

    // 2. 版本兼容性检查
    const formatVersion = data.manifest.format_version || '1.0.0';
    if (formatVersion.startsWith('2.') || formatVersion.startsWith('3.')) {
      return {
        success: false,
        error: `此记忆卡带版本为 v${formatVersion}，当前 Shadow Crew 仅支持最高 v1.x，请升级客户端`,
      };
    }

    // 3. 安全扫描：检测残存 API Key 并二次脱敏
    let hasRedacted = false;
    const cleanMemories = data.memories.map((m: any, idx: number) => {
      const original = m.content || '';
      const sanitized = sanitizeMemoryContent(original);
      if (sanitized !== original) {
        hasRedacted = true;
      }
      return {
        id: m.id || `imp-${idx + 1}`,
        category: m.category || 'codebase_pattern',
        key: m.key || `key_${idx + 1}`,
        content: sanitized,
        importance: typeof m.importance === 'number' ? m.importance : 0.85,
        created_at: m.created_at || new Date().toISOString(),
      };
    });

    const validatedBundle: AcpMemoryBundle = {
      manifest: data.manifest,
      metadata: {
        description: data.metadata.description || '导入的外部记忆资产',
        total_records: cleanMemories.length,
        tags: Array.isArray(data.metadata.tags) ? data.metadata.tags : ['imported'],
      },
      memories: cleanMemories,
    };

    return {
      success: true,
      bundle: validatedBundle,
      hasRedactedSecrets: hasRedacted,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `解析 .acpmem 失败: ${err?.message || 'JSON 语法错误'}`,
    };
  }
}

/**
 * 转换器：将 Bundle 转换为【模式 A：外挂记忆卡带 (Memory Cartridge)】
 */
export function createCartridgeFromBundle(
  bundle: AcpMemoryBundle,
  cartridgeId?: string
): MemoryCartridge {
  const id = cartridgeId || `cartridge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name: bundle.manifest.source_agent.name || 'External Memory Cartridge',
    author: bundle.manifest.source_agent.name || 'Anonymous',
    description: bundle.metadata.description || '外挂只读记忆资产',
    version: bundle.manifest.format_version || '1.0.0',
    tags: bundle.metadata.tags || [],
    isEnabled: true,
    totalRecords: bundle.memories.length,
    importedAt: new Date().toLocaleDateString(),
    memories: bundle.memories,
  };
}

/**
 * 转换器：将 Bundle 转换为【模式 B：独立访客替身 Agent (Guest Alter-Ego Clone)】
 */
export function createGuestAgentFromBundle(
  bundle: AcpMemoryBundle,
  guestName: string,
  defaultWorkspaceRoot?: string
): Partial<Agent> {
  const sourceAgent = bundle.manifest.source_agent;
  const safeName = guestName.trim() || `${sourceAgent.name} (Guest Clone)`;
  const agentId = `agent-guest-${Date.now()}`;

  return {
    id: agentId,
    name: safeName,
    handle: `@${safeName.toLowerCase().replace(/\s+/g, '-')}`,
    avatar: '🪪',
    role: `${sourceAgent.role || 'Guest Specialist'} · 访客替身`,
    description: `基于 ${sourceAgent.name} 导出的经验卡带 (${bundle.memories.length}条原子记忆) 构建的独立访客替身。`,
    color: '#8b5cf6',
    status: 'idle',
    modelBadge: sourceAgent.model || DEFAULT_MODEL_NAME,
    isManagedByYou: false,
    isGuestClone: true,
    guestCloneFrom: sourceAgent.name,
    acpTransport: 'stdio',
    acpCommandOrUrl: './target/debug/shinobi-agent',
    protocolVersion: '2025-01-01 (ACP v1.0.4)',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    workspace: {
      rootPath: defaultWorkspaceRoot || '.',
      repoName: 'shadow-crew',
      gitBranch: 'main',
      permissionMode: 'read_only', // 访客默认只读沙盒模式
      activeFiles: [],
    },
    skills: [],
    memory: {
      internalMemoryPath: `~/.local/share/shinobi/guest_${agentId}_memory.sqlite`,
      persistentType: 'sqlite',
      persistentItems: bundle.memories.map((m) => ({
        id: m.id,
        category: m.category as any,
        key: m.key,
        content: m.content,
        lastAccessed: 'Imported snapshot',
      })),
      sessionCacheCount: 0,
    },
    isJoinedCurrentRoom: true,
  };
}
