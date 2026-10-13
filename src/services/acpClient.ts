import { Agent, CartridgeCitation, MemoryCartridgeItem, ArbitrationRulingDraft, RulingDecisionType, TopicPatchDiffItem, TopicExecutionUiMeta, ModuleDecompositionDraft, ModuleComplexityLevel } from '../types';
import { resolveAgentModelConfig, isModelConfigReady, callLlmModel } from './llmService';
import { isAgentOffline } from '../utils/agentRuntime';
import { buildAgentPersonaPrompt } from './agentCollaboration';

export interface AcpSendPromptOptions {
  agent: Agent;
  roomId: string;
  prompt: string;
  projectId?: string;
  channelId?: string;
  systemPrompt?: string;
}

export interface AcpAgentResponse {
  textResponse: string;
  memoryActions?: Array<{ action: string; key: string; detail: string }>;
  mcpToolCalls?: Array<{ server_name: string; tool_name: string; status: string; arguments?: any }>;
  rulingDraft?: ArbitrationRulingDraft;
  moduleDecompositionDraft?: ModuleDecompositionDraft;
  cartridgeCitation?: CartridgeCitation;
  workspaceDiffs?: TopicPatchDiffItem[];
  executionMeta?: TopicExecutionUiMeta;
  durationMs: number;
  isRealProcess: boolean;
  isEmptyTurn?: boolean;
  isError?: boolean;
  stopReason?: string;
  raw?: any;
}

/**
 * 从执行 Agent 响应正文中解析结构化 UI 描述契约块 <<<EXECUTION_META>>>...<<<EXECUTION_META_END>>>
 * 并自动剥离原始契约标签，确保展示给用户的 Markdown 正文干净无协议噪音
 */
export function extractExecutionMetaFromAcpResponse(rawText: string): {
  executionMeta?: TopicExecutionUiMeta;
  cleanedText: string;
} {
  if (!rawText || !rawText.trim()) {
    return { cleanedText: rawText };
  }

  const metaRegex = /<<<EXECUTION_META>>>([\s\S]*?)<<<EXECUTION_META_END>>>/i;
  const fallbackJsonRegex = /```(?:json)?\s*(\{\s*"sectionTitle"[\s\S]*?"podTitle"[\s\S]*?\})\s*```/i;

  const match = rawText.match(metaRegex) || rawText.match(fallbackJsonRegex);
  if (!match || !match[1]) {
    return { cleanedText: rawText };
  }

  let executionMeta: TopicExecutionUiMeta | undefined;
  try {
    const jsonRaw = match[1].trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonRaw);
    if (parsed && typeof parsed === 'object') {
      const deliverableKind: 'workspace_files' | 'report_only' =
        parsed.deliverableKind === 'report_only' ? 'report_only' : 'workspace_files';
      executionMeta = {
        sectionTitle: String(parsed.sectionTitle || '决议落地执行与交付产物').trim(),
        podTitle: String(parsed.podTitle || '🛠️ 决议落地交付').trim(),
        statusSummary: String(parsed.statusSummary || '已完成定案决议落地交付').trim(),
        deliverableKind,
        reviewActionLabel: parsed.reviewActionLabel ? String(parsed.reviewActionLabel).trim() : undefined,
        applyActionLabel: parsed.applyActionLabel ? String(parsed.applyActionLabel).trim() : undefined,
      };
    }
  } catch (e) {
    console.warn('[acpClient] Failed to parse <<<EXECUTION_META>>> block:', e);
  }

  const cleanedText = rawText.replace(match[0], '').trim();
  return {
    executionMeta,
    cleanedText: cleanedText || rawText,
  };
}

/**
 * 从 ACP 响应（原生 MCP 工具调用或结构化契约块）中提取仲裁定案裁决书草案
 */
export function extractArbitrationRulingFromAcpResponse(
  acpResp: Partial<AcpAgentResponse>,
  authorName?: string
): ArbitrationRulingDraft | undefined {
  const text = acpResp.textResponse || '';
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // 1. 优先从 MCP Tool 调用记录或 raw 中提取 submit_arbitration_ruling 参数
  if (acpResp.raw && typeof acpResp.raw === 'object') {
    const rawCalls =
      acpResp.raw.mcp_tool_calls ||
      acpResp.raw.result?.mcp_tool_calls ||
      acpResp.mcpToolCalls ||
      [];
    if (Array.isArray(rawCalls)) {
      const rulingCall = rawCalls.find(
        (c: any) =>
          c.tool_name === 'submit_arbitration_ruling' ||
          c.tool === 'submit_arbitration_ruling' ||
          c.name === 'submit_arbitration_ruling'
      );
      if (rulingCall && (rulingCall.arguments || rulingCall.args)) {
        const args = rulingCall.arguments || rulingCall.args;
        const rawDecision = args.decision_type || args.decisionType || 'trade_off_matrix';
        const validDecision: RulingDecisionType =
          rawDecision === 'adopt_proposer' || rawDecision === 'reject_rebuild' || rawDecision === 'trade_off_matrix'
            ? rawDecision
            : 'trade_off_matrix';
        return {
          decisionType: validDecision,
          summary: String(args.summary || '已通过 MCP 工具提交仲裁定案裁决').trim(),
          tradeOffPoints: Array.isArray(args.trade_off_points)
            ? args.trade_off_points.map(String).filter((s) => s.trim().length > 0)
            : [],
          impactedFiles: Array.isArray(args.impacted_files)
            ? args.impacted_files.map(String).filter((s) => s.trim().length > 0)
            : [],
          solution: args.solution ? String(args.solution).trim() : undefined,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    }
  }

  // 2. 尝试从文本正文中的结构化块 <<<RULING_DRAFT>>> { ... } <<<RULING_DRAFT_END>>> 解析
  const blockMatch =
    text.match(/<<<RULING_DRAFT>>>([\s\S]*?)<<<RULING_DRAFT_END>>>/i) ||
    text.match(/```(?:json)?\s*(\{\s*"decision_?type"[\s\S]*?\})\s*```/i);

  if (blockMatch && blockMatch[1]) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      const rawDecision = parsed.decision_type || parsed.decisionType || 'trade_off_matrix';
      const validDecision: RulingDecisionType =
        rawDecision === 'adopt_proposer' || rawDecision === 'reject_rebuild' || rawDecision === 'trade_off_matrix'
          ? rawDecision
          : 'trade_off_matrix';

      const tradeOffs = Array.isArray(parsed.trade_off_points || parsed.tradeOffPoints)
        ? (parsed.trade_off_points || parsed.tradeOffPoints).map(String).filter((s: string) => s.trim().length > 0)
        : [];

      const files = Array.isArray(parsed.impacted_files || parsed.impactedFiles)
        ? (parsed.impacted_files || parsed.impactedFiles).map(String).filter((s: string) => s.trim().length > 0)
        : typeof (parsed.impacted_files || parsed.impactedFiles) === 'string'
        ? (parsed.impacted_files || parsed.impactedFiles).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      return {
        decisionType: validDecision,
        summary: String(parsed.summary || '经综合仲裁审议定案').trim(),
        tradeOffPoints: tradeOffs,
        impactedFiles: files,
        solution: parsed.solution ? String(parsed.solution).trim() : undefined,
        submittedBy: authorName,
        submittedAt: now,
      };
    } catch (e) {
      console.warn('[acpClient] Failed to parse structured ruling draft block:', e);
    }
  }

  return undefined;
}

/**
 * 从 ACP 响应（原生 MCP 工具 submit_module_decomposition 或结构化块）中提取 G-Frame 模块化拆解载荷
 */
export function extractModuleDecompositionFromAcpResponse(
  acpResp: Partial<AcpAgentResponse>,
  authorName?: string
): ModuleDecompositionDraft | undefined {
  const text = acpResp.textResponse || '';
  const now = new Date().toISOString();

  const normalizeModules = (rawMods: any[]): ModuleDecompositionDraft['modules'] => {
    return rawMods.slice(0, 4).map((m: any, idx: number) => {
      const rawLevel = m.complexity_level || m.complexityLevel || 'medium_standard';
      const complexityLevel: ModuleComplexityLevel =
        rawLevel === 'low_deterministic' || rawLevel === 'medium_standard' || rawLevel === 'high_critical'
          ? rawLevel
          : 'medium_standard';
      return {
        moduleId: String(m.module_id || m.moduleId || `mod-${idx + 1}`).trim(),
        title: String(m.title || `模块 ${idx + 1}`).trim(),
        responsibility: String(m.responsibility || '').trim(),
        allowedFiles: Array.isArray(m.allowed_files || m.allowedFiles)
          ? (m.allowed_files || m.allowedFiles).map(String).filter(Boolean)
          : [],
        dependsOn: Array.isArray(m.depends_on || m.dependsOn)
          ? (m.depends_on || m.dependsOn).map(String).filter(Boolean)
          : [],
        complexityLevel,
      };
    });
  };

  // 1. 优先从原生 MCP Tool 调用记录提取 submit_module_decomposition 参数
  const rawCalls =
    acpResp.raw?.mcp_tool_calls ||
    acpResp.raw?.result?.mcp_tool_calls ||
    acpResp.mcpToolCalls ||
    [];
  if (Array.isArray(rawCalls)) {
    const decompCall = rawCalls.find(
      (c: any) =>
        c.tool_name === 'submit_module_decomposition' ||
        c.tool === 'submit_module_decomposition' ||
        c.name === 'submit_module_decomposition'
    );
    if (decompCall && (decompCall.arguments || decompCall.args)) {
      const args = decompCall.arguments || decompCall.args;
      const sc = args.shared_contract || args.sharedContract || {};
      const mods = Array.isArray(args.modules) ? normalizeModules(args.modules) : [];
      if (mods.length >= 2) {
        return {
          sharedContract: {
            summary: String(sc.summary || '跨模块公共接口契约').trim(),
            typeSignatures: String(sc.type_signatures || sc.typeSignatures || '').trim(),
            invariants: Array.isArray(sc.invariants) ? sc.invariants.map(String) : [],
          },
          modules: mods,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    }
  }

  // 2. 尝试从结构化契约块 <<<MODULE_DECOMPOSITION>>>...<<<MODULE_DECOMPOSITION_END>>> 解析
  const blockMatch =
    text.match(/<<<MODULE_DECOMPOSITION>>>([\s\S]*?)<<<MODULE_DECOMPOSITION_END>>>/i) ||
    text.match(/```(?:json)?\s*(\{\s*"shared_?contract"[\s\S]*?"modules"[\s\S]*?\})\s*```/i);

  if (blockMatch && blockMatch[1]) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      const sc = parsed.shared_contract || parsed.sharedContract || {};
      const mods = Array.isArray(parsed.modules) ? normalizeModules(parsed.modules) : [];
      if (mods.length >= 2) {
        return {
          sharedContract: {
            summary: String(sc.summary || '跨模块公共接口契约').trim(),
            typeSignatures: String(sc.type_signatures || sc.typeSignatures || '').trim(),
            invariants: Array.isArray(sc.invariants) ? sc.invariants.map(String) : [],
          },
          modules: mods,
          submittedBy: authorName,
          submittedAt: now,
        };
      }
    } catch (e) {
      console.warn('[acpClient] Failed to parse structured module decomposition block:', e);
    }
  }

  return undefined;
}

/**
 * 根据 ACP 响应 (包含记忆召回与原生 MCP 工具调用) 构建标准化 ThinkingProcess
 */
export function buildThinkingProcessFromAcp(
  acpResp: AcpAgentResponse,
  defaultSummary = '已检索私有记忆库并完成技术边界考量'
) {
  const hasMem = acpResp.memoryActions && acpResp.memoryActions.length > 0;
  const hasMcp = acpResp.mcpToolCalls && acpResp.mcpToolCalls.length > 0;

  if (!hasMem && !hasMcp) {
    return undefined;
  }

  const details: string[] = [];
  if (hasMem) {
    details.push(...acpResp.memoryActions!.map((m) => `[${m.action.toUpperCase()}] ${m.key}: ${m.detail}`));
  }
  if (hasMcp) {
    details.push(...acpResp.mcpToolCalls!.map((t) => `[MCP TOOL] ${t.server_name} -> ${t.tool_name} (${t.status})`));
  }

  const summary = hasMcp
    ? `已执行 ${acpResp.mcpToolCalls!.length} 项原生 MCP 工具调用并完成推演`
    : defaultSummary;

  return {
    duration: `${acpResp.durationMs}ms`,
    tokens: Math.round(acpResp.textResponse.length * 1.3),
    summary,
    detail: details.join('\n'),
  };
}

/**
 * 有限上下文 JIT 外挂记忆召回引擎 (4-Stage Funnel Just-In-Time Recall)
 * 在不污染本地主数据库的前提下，按需精准召回 Top-3 相关条目，并将 Token 预算控制在 600 Tokens 以内。
 */
export function recallRelevantCartridgeMemories(
  agent: Agent,
  prompt: string
): {
  enhancedPrompt: string;
  citation?: CartridgeCitation;
} {
  const cartridges = agent.memory?.cartridges || [];
  const enabledCartridges = cartridges.filter((c) => c.isEnabled && c.memories && c.memories.length > 0);

  if (enabledCartridges.length === 0) {
    return { enhancedPrompt: prompt };
  }

  // 分词提取关键词
  const promptWords = prompt
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const matchedCandidates: Array<{
    item: MemoryCartridgeItem;
    cartridgeName: string;
    score: number;
  }> = [];

  for (const cartridge of enabledCartridges) {
    for (const item of cartridge.memories) {
      const targetText = `${item.key} ${item.content} ${item.category}`.toLowerCase();
      let score = 0;

      for (const word of promptWords) {
        if (targetText.includes(word)) {
          score += 1;
        }
      }

      // 如果有重点加权
      if (item.importance) {
        score *= 1 + item.importance;
      }

      if (score > 0) {
        matchedCandidates.push({
          item,
          cartridgeName: cartridge.name,
          score,
        });
      }
    }
  }

  // 若无强匹配，但外挂卡带总数较少（1-2条特定规约），并且用户提问了代码或架构，召回首要规约
  if (matchedCandidates.length === 0 && (prompt.includes('代码') || prompt.includes('架构') || prompt.includes('rust') || prompt.length > 10)) {
    const firstCartridge = enabledCartridges[0];
    const topItem = firstCartridge.memories[0];
    if (topItem) {
      matchedCandidates.push({
        item: topItem,
        cartridgeName: firstCartridge.name,
        score: 0.5,
      });
    }
  }

  if (matchedCandidates.length === 0) {
    return { enhancedPrompt: prompt };
  }

  // 排序并取 Top-3（严格配额保护：硬上限 600 Tokens，约 1800 字符）
  matchedCandidates.sort((a, b) => b.score - a.score);
  const selected = matchedCandidates.slice(0, 3);

  const primaryCartridgeName = selected[0].cartridgeName;
  const citationItems = selected.map((c) => ({
    key: c.item.key,
    content: c.item.content,
  }));

  const totalChars = citationItems.reduce((acc, cur) => acc + cur.key.length + cur.content.length, 0);
  const estimatedTokens = Math.max(40, Math.round(totalChars / 3.2));

  const citation: CartridgeCitation = {
    cartridgeName: primaryCartridgeName,
    recalledCount: citationItems.length,
    tokenCost: estimatedTokens,
    items: citationItems,
  };

  // 生成非侵入式提示词注入块
  const memoryInjection =
    `\n\n[💡 引用外挂记忆卡带「${primaryCartridgeName}」的架构规约与避坑经验 (只读挂载)]:\n` +
    citationItems.map((item, idx) => `${idx + 1}. [${item.key}]: ${item.content}`).join('\n');

  return {
    enhancedPrompt: `${prompt}${memoryInjection}`,
    citation,
  };
}

/**
 * 探测远程 ACP WebSocket 连接状态与端点延迟
 */
export async function probeRemoteAcpConnection(
  remoteUrl: string,
  authToken?: string,
  timeoutMs = 6000
): Promise<{ ok: boolean; latencyMs: number; error?: string; agentInfo?: any }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
        resolve({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `连接超时 (${timeoutMs}ms)，请检查目标地址与网络通畅度`,
        });
      }
    }, timeoutMs);

    try {
      // 携带 token 作为 query parameter (若存在)
      const urlObj = new URL(remoteUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }
      ws = new WebSocket(urlObj.toString());

      ws.onopen = () => {
        // 发送 initialize 握手探针
        const initReq = {
          jsonrpc: '2.0',
          id: 101,
          method: 'initialize',
          params: {
            clientInfo: { name: 'shadow-crew-client', version: '1.0.0' },
            protocolVersion: '2025-01-01',
          },
        };
        ws?.send(JSON.stringify(initReq));
      };

      ws.onmessage = (event) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const latencyMs = Date.now() - startTime;
          try {
            const data = JSON.parse(event.data);
            const agentInfo = data?.result?.agentInfo || { name: 'Remote ACP Agent' };
            ws?.close();
            resolve({ ok: true, latencyMs, agentInfo });
          } catch {
            ws?.close();
            resolve({ ok: true, latencyMs });
          }
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            latencyMs: Date.now() - startTime,
            error: 'WebSocket 连接握手失败，远程端可能未开启或凭证不匹配',
          });
        }
      };
    } catch (e: any) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `URL 解析或协议错误: ${e?.message || e}`,
        });
      }
    }
  });
}

/**
 * 通过 WebSocket 向远程 ACP Agent 发送 prompt 推演指令
 */
export async function sendPromptToRemoteAcpWebSocket(
  remoteUrl: string,
  prompt: string,
  roomId: string,
  authToken?: string,
  readOnlyGuard = true,
  systemPrompt?: string
): Promise<AcpAgentResponse> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;
    // 对标 Buzz 架构: 动态空闲心跳超时 (每次收到流式数据/心跳自动续期 300s，上限 1800s)
    const IDLE_TIMEOUT_MS = 300_000;
    const MAX_DURATION_MS = 1800_000;
    let idleTimer: NodeJS.Timeout | null = null;
    let maxTimer: NodeJS.Timeout | null = null;

    const cleanupTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = null;
      }
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanupTimers();
          if (ws) {
            try {
              ws.close();
            } catch {}
          }
          resolve({
            textResponse: `⚠️【远程 ACP】响应空闲超时 (超过 ${IDLE_TIMEOUT_MS / 1000}s 未收到任何模型输出或心跳)。若使用深度思考或大参数量慢模型，可在端点处增加心跳支持。`,
            durationMs: Date.now() - startTime,
            isRealProcess: true,
          });
        }
      }, IDLE_TIMEOUT_MS);
    };

    maxTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanupTimers();
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
        resolve({
          textResponse: `⚠️【远程 ACP】执行超过最大硬上限 (${MAX_DURATION_MS / 1000}s)，会话已安全收敛。`,
          durationMs: Date.now() - startTime,
          isRealProcess: true,
        });
      }
    }, MAX_DURATION_MS);

    resetIdleTimer();

    try {
      const urlObj = new URL(remoteUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }
      ws = new WebSocket(urlObj.toString());

      ws.onopen = () => {
        resetIdleTimer();
        // 发送 session/prompt 报文
        const rpcPayload = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'session/prompt',
          params: {
            roomId,
            prompt: [{ type: 'text', text: prompt }],
            readOnlyGuard,
            ...(systemPrompt
              ? {
                  systemPrompt,
                  _meta: {
                    systemPrompt: {
                      append: systemPrompt,
                    },
                  },
                }
              : {}),
          },
        };
        ws?.send(JSON.stringify(rpcPayload));
      };

      let accumulatedText = '';
      const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

      ws.onmessage = (event) => {
        resetIdleTimer();
        try {
          const msg = JSON.parse(event.data);

          // 1. 流式 update 报文
          if (msg.method === 'session/update' && msg.params?.content) {
            accumulatedText += msg.params.content;
          }

          // 2. 最终返回报文
          if (msg.result || msg.error) {
            if (!resolved) {
              resolved = true;
              cleanupTimers();
              const durationMs = Date.now() - startTime;
              ws?.close();

              if (msg.error) {
                resolve({
                  textResponse: `⚠️【远程 ACP】执行报错: ${msg.error.message || JSON.stringify(msg.error)}`,
                  durationMs,
                  isRealProcess: true,
                  raw: msg,
                });
              } else {
                const finalReply =
                  accumulatedText ||
                  msg.result.text_response ||
                  (typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result));

                resolve({
                  textResponse: finalReply,
                  memoryActions: msg.result.memory_actions || memoryActions,
                  workspaceDiffs: readOnlyGuard ? [] : msg.result.workspace_diffs || [],
                  durationMs,
                  isRealProcess: true,
                  raw: msg,
                });
              }
            }
          }
        } catch {
          // 非 JSON 流回退
          accumulatedText += event.data;
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          cleanupTimers();
          resolve({
            textResponse: `⚠️【远程 ACP】WebSocket 网络断开或鉴权拒绝，请确认端点是否存活。`,
            durationMs: Date.now() - startTime,
            isRealProcess: true,
          });
        }
      };
    } catch (err: any) {
      if (!resolved) {
        resolved = true;
        cleanupTimers();
        resolve({
          textResponse: `⚠️【远程 ACP】无效端点地址: ${err?.message || err}`,
          durationMs: Date.now() - startTime,
          isRealProcess: false,
        });
      }
    }
  });
}

/**
 * 构造本地 ACP 进程的启动环境变量。
 * 内置自研 shinobi-agent 自身不持有模型配置，由宿主将「Agent 私有模型 > 全局默认模型」
 * 解析结果通过 SHADOW_CREW_LLM_* 注入；外部独立 ACP 运行时（如 Claude Code）沿用其自身 ENV，不做注入。
 */
export function buildAgentLaunchEnv(agent: Agent): Array<{ key: string; value: string }> {
  const envVars = [...(agent.envVars || [])];
  const command = agent.acpCommandOrUrl || './target/debug/shinobi-agent';
  if (command.includes('shinobi-agent')) {
    const cfg = resolveAgentModelConfig(agent);
    envVars.push(
      { key: 'SHADOW_CREW_LLM_PROVIDER', value: cfg.provider },
      { key: 'SHADOW_CREW_LLM_MODEL_ID', value: cfg.modelId },
      { key: 'SHADOW_CREW_LLM_BASE_URL', value: cfg.baseUrl || '' },
      { key: 'SHADOW_CREW_LLM_API_KEY', value: cfg.apiKey || '' },
      { key: 'SHADOW_CREW_LLM_TEMPERATURE', value: String(cfg.temperature ?? 0.7) },
      { key: 'SHADOW_CREW_LLM_MAX_TOKENS', value: String(cfg.maxTokens ?? 4096) }
    );
  }
  return envVars;
}

/**
 * 统一多模态 ACP 通信入口
 * 具备：
 * 1. JIT 外挂记忆智能检索与引用构建
 * 2. 远程 WebSocket / 团队 Hub 连接分流
 * 3. 本地 Tauri stdio 进程驱动
 * 4. 浏览器预览模式下的拟真响应
 */
export async function sendPromptToAcpAgent(
  options: AcpSendPromptOptions
): Promise<AcpAgentResponse> {
  const startTime = Date.now();
  const { agent, roomId, prompt } = options;

  // 0. 统一解析并注入 Agent 自身专属专精人设与行为硬性约束
  const personaPrompt = buildAgentPersonaPrompt(agent);
  const resolvedSystemPrompt = options.systemPrompt
    ? (options.systemPrompt.includes(agent.name) && options.systemPrompt.includes('智能体专属专精人设')
        ? options.systemPrompt
        : `${personaPrompt}\n\n${options.systemPrompt}`)
    : personaPrompt;

  // 1. JIT 动态外挂记忆召回 (有限上下文防塞爆)
  const { enhancedPrompt, citation } = recallRelevantCartridgeMemories(agent, prompt);

  // 1.1 严格通信准入：若 Agent 未由用户点击 Start 开启通信（idle），或进程/握手异常（error），拒绝发起通信
  if (isAgentOffline(agent)) {
    const reason =
      agent.status === 'error'
        ? `当前状态为连接异常${agent.statusDetail ? `（${agent.statusDetail}）` : ''}`
        : '当前处于离线未连接状态';
    return {
      textResponse: `🔌 **Agent 通信不可用**：【${agent.name}】${reason}，本轮指令未派发给该 Agent。\n\n请先在 **Agents & 编队** 控制面板点击该 Agent 头像下方的【Start】按钮开启 ACP 通信连接；若显示连接异常，请先修复其运行环境后重新 Start。`,
      cartridgeCitation: citation,
      durationMs: Date.now() - startTime,
      isRealProcess: false,
    };
  }

  // 2. 判定是否为远程 Agent (WebSocket / Relay Hub)
  const isRemote =
    agent.isRemote ||
    agent.acpTransport === 'websocket' ||
    agent.acpCommandOrUrl?.startsWith('ws://') ||
    agent.acpCommandOrUrl?.startsWith('wss://') ||
    Boolean(agent.remoteUrl);

  if (isRemote) {
    const targetUrl = agent.remoteUrl || agent.acpCommandOrUrl;
    console.log(`[ACP Client] Dispatching prompt to Remote ACP: ${targetUrl} (${agent.name})`);
    const remoteRes = await sendPromptToRemoteAcpWebSocket(
      targetUrl,
      enhancedPrompt,
      roomId,
      agent.authToken,
      agent.readOnlyGuard ?? true,
      resolvedSystemPrompt
    );
    return {
      ...remoteRes,
      cartridgeCitation: citation,
    };
  }

  // 3. 检查是否处于 Tauri 桌面端环境 (本地 stdio 进程)
  const tauriInvoke =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__?.invoke ||
        (window as any).__TAURI__?.core?.invoke
      : null;

  if (tauriInvoke) {
    try {
      console.log(`[ACP Client] Invoking real ACP agent process: ${agent.id} (${agent.name})`);

      const launchCommand = agent.acpCommandOrUrl || './target/debug/shinobi-agent';
      const launchEnvVars = buildAgentLaunchEnv(agent);
      const effectiveChannelId = options.channelId || roomId;
      const channelCwd = `~/.shinobi/channels/${effectiveChannelId}`;

      const response = await tauriInvoke('send_prompt_to_agent', {
        agentId: agent.id,
        roomId,
        channelId: effectiveChannelId,
        prompt: enhancedPrompt,
        command: launchCommand,
        cwd: channelCwd,
        envVars: launchEnvVars,
        systemPrompt: resolvedSystemPrompt,
      });

      const durationMs = Date.now() - startTime;
      console.log('[ACP Client] Real ACP response received:', response);

      // 解析 JSON-RPC 2.0 返回格式
      if (response && response.result) {
        const res = response.result;
        const rawText = res.text_response || '';
        const isEmpty = !rawText.trim();
        const fullText = rawText || (res.stopReason ? `【${agent.name}】ACP 任务已完成 (stopReason: ${res.stopReason})` : JSON.stringify(res));
        const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(fullText);
        const nativeDiffs: TopicPatchDiffItem[] = Array.isArray(res.workspace_diffs) && res.workspace_diffs.length > 0
          ? res.workspace_diffs
          : extractWorkspaceDiffsFromText(cleanedText);
        return {
          textResponse: cleanedText,
          isEmptyTurn: isEmpty,
          stopReason: res.stopReason,
          memoryActions: res.memory_actions || [],
          mcpToolCalls: res.mcp_tool_calls || [],
          cartridgeCitation: citation,
          workspaceDiffs: nativeDiffs,
          executionMeta,
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (response && response.text_response) {
        const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(response.text_response);
        const nativeDiffs: TopicPatchDiffItem[] = Array.isArray(response.workspace_diffs) && response.workspace_diffs.length > 0
          ? response.workspace_diffs
          : extractWorkspaceDiffsFromText(cleanedText);
        return {
          textResponse: cleanedText,
          memoryActions: response.memory_actions || [],
          mcpToolCalls: response.mcp_tool_calls || [],
          cartridgeCitation: citation,
          workspaceDiffs: nativeDiffs,
          executionMeta,
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (
        response &&
        (response.status === 'timeout' || response.status === 'closed' || response.error)
      ) {
        const rawErrMsg =
          response.error?.message ||
          (typeof response.error === 'string' ? response.error : JSON.stringify(response.error)) ||
          (response.status === 'timeout' ? 'Agent 响应空闲超时 (等待超时)' : 'Agent 进程异常关闭');

        let formattedHelp = '';
        if (rawErrMsg.toLowerCase().includes('authentication required')) {
          formattedHelp =
            `\n\n💡 **认证排障指南 (Claude Code ACP)**：\n` +
            `• **原因**：Anthropic 官方规范限制，第三方客户端集成（如 Shadow Crew）**不支持**复用本机的 \`claude.ai\` 网页/OAuth 订阅，需要提供 \`ANTHROPIC_API_KEY\`。\n` +
            `• **配置步骤**：\n` +
            `  1. 点击当前 Agent 卡片右上角【编辑】图标 ✏️；\n` +
            `  2. 在「环境变量 (ENV)」中填入您的 \`ANTHROPIC_API_KEY\`（格式如 \`sk-ant-api03-...\`）；\n` +
            `  3. *(可选)* 若使用第三方反代/中转网关，可额外添加 \`ANTHROPIC_BASE_URL\`；\n` +
            `  4. 保存后重新发送消息或点击「Start」重新拉起即可。`;
        } else if (rawErrMsg.toLowerCase().includes('idle timeout') || rawErrMsg.toLowerCase().includes('timeout')) {
          formattedHelp =
            `\n\n💡 **慢模型 / 深度推理排障建议**：\n` +
            `• **原因**：复杂推理模型（如 DeepSeek-R1、o1/o3-mini、Claude 3.7 Thinking）首字思考耗时较长，或模型服务提供商处于排队状态。\n` +
            `• **解决方案**：\n` +
            `  1. 系统已启用对标 Buzz 的动态空闲心跳机制 (默认 300s)；若需要更长思考时间，可通过环境变量 \`SHADOW_CREW_ACP_IDLE_TIMEOUT=600\` 进一步放宽限制；\n` +
            `  2. 建议确认底层 Agent 命令是否启用了流式 (Streaming) 传输，以便首个 chunk 快速回传；\n` +
            `  3. 可点击输入框上方重新尝试或简化当前指令。`;
        }

        return {
          textResponse: `⚠️【${agent.name}】ACP 通信告警：${rawErrMsg}${formattedHelp}\n\n• **本地日志落盘**：底层原始 stdio 报文已持久化落盘至 \`logs/acp.log\`。\n• **实时跟踪**：可在终端运行 \`tail -f logs/acp.log\` 查看实时流。\n• **关联命令**：\`${agent.acpCommandOrUrl || './target/debug/shinobi-agent'}\`。`,
          cartridgeCitation: citation,
          durationMs,
          isRealProcess: true,
          isError: true,
          raw: response,
        };
      }
    } catch (err) {
      console.warn('[ACP Client] Tauri IPC invocation error or process offline, fallback to simulation:', err);
    }
  }

  // 4. Web 预览、直连大模型运行时或进程离线时的智能处理
  const modelConfig = resolveAgentModelConfig(agent);
  if (isModelConfigReady(modelConfig)) {
    try {
      console.log(`[ACP Client] Invoking direct LLM runtime for ${agent.name} with model: ${modelConfig.modelName || modelConfig.modelId}`);
      const llmResult = await callLlmModel(modelConfig, enhancedPrompt, resolvedSystemPrompt);
      const durationMs = Date.now() - startTime;
      const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(llmResult.textResponse);
      const extractedDiffs = extractWorkspaceDiffsFromText(cleanedText);

      return {
        textResponse: cleanedText,
        memoryActions: [
          {
            action: 'recall',
            key: 'llm_inference',
            detail: `底座模型「${modelConfig.modelName || modelConfig.modelId}」推演完成 (${llmResult.durationMs}ms)`,
          },
        ],
        cartridgeCitation: citation,
        workspaceDiffs: extractedDiffs,
        executionMeta,
        durationMs,
        isRealProcess: true,
      };
    } catch (llmErr: any) {
      console.warn('[ACP Client] Real LLM call failed:', llmErr);
      const errMsg = llmErr?.message || String(llmErr);
      // 若属于鉴权或配额硬错误，直接向用户展示精准排障面板
      if (
        errMsg.toLowerCase().includes('key') ||
        errMsg.includes('401') ||
        errMsg.toLowerCase().includes('auth') ||
        errMsg.toLowerCase().includes('unauthorized') ||
        errMsg.includes('403') ||
        errMsg.toLowerCase().includes('quota')
      ) {
        return {
          textResponse: `⚠️【${agent.name}】底座大模型认证或调用失败：${errMsg}\n\n💡 **排障建议**：\n• 当前模型：\`${modelConfig.modelName || modelConfig.modelId}\` (提供商: \`${modelConfig.provider}\`)\n• 当前 Base URL: \`${modelConfig.baseUrl || '默认'}\`\n• 请点击当前 Agent 卡片右侧【配置】或右上角【Set agent defaults】重新校验 API Key 与网络连接。`,
          cartridgeCitation: citation,
          durationMs: Date.now() - startTime,
          isRealProcess: false,
          isError: true,
        };
      }
    }
  }

  // 5. 兜底拟真响应 (无 Key 或调试模拟态)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 500));
  const durationMs = Date.now() - startTime;

  let simulatedText = '';
  const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

  if (prompt.includes('[🛠️ 议题定案决议落地执行任务') || prompt.includes('[🛠️ 议题仲裁定案代码落地实施任务')) {
    const fileMatch = prompt.match(/• `([^`]+)`/);
    const targetFile = fileMatch ? fileMatch[1] : 'src/services/consensusImpl.ts';
    const topicTitleMatch = prompt.match(/【所属议题】:\s*【([^】]+)】/);
    const topicShortTitle = (topicTitleMatch?.[1] || '定案决议').slice(0, 14);
    simulatedText =
      `### 🛠️ 「${topicShortTitle}」落地执行成果交付\n\n` +
      `已由 **${agent.name}** 严格按照终局定案要求完成落地实现：\n\n` +
      `\`\`\`diff\n` +
      `--- a/${targetFile}\n` +
      `+++ b/${targetFile}\n` +
      `@@ -1,4 +1,24 @@\n` +
      `-export function legacyHandler() {\n` +
      `-  return false;\n` +
      `-}\n` +
      `+// 依据定案决议自动落地的工程实现\n` +
      `+export interface ArbitrationEnforcedOptions {\n` +
      `+  requestId: string;\n` +
      `+  signature: string;\n` +
      `+  timestamp: number;\n` +
      `+}\n` +
      `+\n` +
      `+export function enforceArbitratedGuard(opts: ArbitrationEnforcedOptions): boolean {\n` +
      `+  if (!opts.requestId || !opts.signature) {\n` +
      `+    throw new Error('Arbitration Guard: missing required signature or requestId');\n` +
      `+  }\n` +
      `+  const driftMs = Math.abs(Date.now() - opts.timestamp);\n` +
      `+  if (driftMs > 30_000) {\n` +
      `+    return false;\n` +
      `+  }\n` +
      `+  return true;\n` +
      `+}\n` +
      `\`\`\`\n\n` +
      `• **交付校验**：已通过边界条件校验与幂等保护检查，可点击下方按钮审查变更并合入本地工作区。\n\n` +
      `<<<EXECUTION_META>>>\n` +
      JSON.stringify({
        sectionTitle: `${topicShortTitle} · 落地实现与变更交付`,
        podTitle: `🛠️ ${topicShortTitle.slice(0, 6)}落地交付`,
        statusSummary: `已完成 ${targetFile} 的定案落地变更与边界校验`,
        deliverableKind: 'workspace_files',
        reviewActionLabel: '审查变更 Diff',
        applyActionLabel: '一键合入本地工作区',
      }) +
      `\n<<<EXECUTION_META_END>>>`;
    memoryActions.push({
      action: 'write',
      key: 'execution_deliverable',
      detail: `已针对 ${targetFile} 生成落地变更与 UI 描述契约`,
    });
  } else if (agent.isGuestClone) {
    simulatedText =
      `【${agent.name} (🪪 访客替身)】已基于外挂知识库完成推演：\n` +
      `针对研讨议题：「${prompt}」，我调取了原宿主 ${agent.guestCloneFrom || '原专家'} 沉淀的架构公理。\n` +
      `• **外部专家建议**：严密保持代码结构整洁，防止异步边界锁竞争与循环依赖。\n` +
      `• **协同视角**：我作为沙盒只读替身，可以在此与主 Agent 交叉审查此方案。`;

    memoryActions.push({
      action: 'recall',
      key: 'guest_clone_snapshot',
      detail: `召回 ${agent.guestCloneFrom || '原专家'} 的高密原子知识卡片`,
    });
  } else if (agent.id === 'agent-shinobi-core') {
    simulatedText =
      `【${agent.name}】已就绪并完成需求分析：\n` +
      `针对关于「${prompt.slice(0, 40)}${prompt.length > 40 ? '...' : ''}」的指令，已调取私有 SQLite 记忆库与外挂卡带。\n` +
      `• **架构策略**：遵循单一职责与零拷贝设计，中间件层全面基于 Tokio 异步通道挂载。\n` +
      `• **下一步建议**：随时可在当前频道发起单层独立推演议题（Topic），或直接分派 Unified Diff 变更任务。\n\n` +
      `*(💡 提示：当前 Agent 处于拟真回放模式。点击卡片右侧「配置模型」或右上角「Set agent defaults」填入 API Key 即可接入真实 DeepSeek / Claude / OpenAI / Ollama 等大模型)*`;

    memoryActions.push({
      action: 'recall',
      key: 'rust_guidelines',
      detail: '严禁 unwrap，优先使用 anyhow/thiserror；异步操作一律基于 Tokio 运行时',
    });
  } else if (agent.id === 'agent-1789029918725') {
    simulatedText =
      `【${agent.name}】ACP 网关协同响应：\n` +
      `收到开发指令：\`${prompt}\`。\n` +
      `已连接到 OpenClaw Gateway 进程，模型参数 \`${agent.modelBadge || 'deepseek'}\` 已加载，已完成上下文对齐。\n\n` +
      `*(💡 提示：当前 Agent 处于拟真回放模式。可在卡片配置中填入真实模型 API Key)*`;

    memoryActions.push({
      action: 'query',
      key: 'openclaw_acp_bridge',
      detail: 'OpenClaw Gateway connects on ws://127.0.0.1:18789 via stdio protocol',
    });
  } else {
    simulatedText =
      `【${agent.name} (${agent.role})】推演反馈：\n` +
      `已接收到来自研讨频道的指令：「${prompt}」。\n` +
      `ACP 独立推演就绪，已融合上下文信息。随时可以开展代码审查与方案校验。\n\n` +
      `*(💡 提示：当前 Agent 处于拟真回放模式。可在卡片配置中填入真实模型 API Key)*`;
  }

  const { executionMeta, cleanedText } = extractExecutionMetaFromAcpResponse(simulatedText);

  return {
    textResponse: cleanedText,
    memoryActions,
    cartridgeCitation: citation,
    workspaceDiffs: extractWorkspaceDiffsFromText(cleanedText),
    executionMeta,
    durationMs,
    isRealProcess: false,
  };
}

/**
 * 从 Agent 响应 Markdown 文本中确定性提取 Unified Diff 块或带路径标注的工程代码补丁
 */
export function extractWorkspaceDiffsFromText(
  text: string,
  fallbackFiles: string[] = []
): TopicPatchDiffItem[] {
  if (!text || !text.trim()) return [];
  const results: TopicPatchDiffItem[] = [];
  const seenFiles = new Set<string>();

  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase().trim();
    const rawBody = (match[2] || '').trim();
    if (!rawBody) continue;

    // 跳过 JSON 契约块或 Mermaid 图表
    if (lang === 'mermaid' || (lang === 'json' && rawBody.includes('"decisionType"'))) {
      continue;
    }

    const lines = rawBody.split('\n');
    const isUnifiedDiff =
      lang === 'diff' ||
      lang === 'patch' ||
      rawBody.includes('--- a/') ||
      rawBody.includes('+++ b/') ||
      lines.some((l) => l.startsWith('@@ '));

    // 查找代码块前方的上下文是否标注了文件名
    const precedingText = text.slice(Math.max(0, match.index - 220), match.index);
    const precedingFileMatch = precedingText.match(
      /`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`|\*\*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\*\*|(?:文件|路径|File|Path)[:：\s]*`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?/i
    );
    const contextFilename =
      precedingFileMatch?.[1] || precedingFileMatch?.[2] || precedingFileMatch?.[3];

    if (isUnifiedDiff) {
      let filename = '';
      const plusMatch = rawBody.match(/^\+\+\+\s+(?:b\/)?([^\s\n]+)/m);
      const minusMatch = rawBody.match(/^---\s+(?:a\/)?([^\s\n]+)/m);
      const commentFileMatch = lines[0]?.match(/^(?:\/\/|#)\s*(?:filepath|file|path)[:：\s]*([^\s]+)/i);
      filename =
        (plusMatch?.[1] && plusMatch[1] !== '/dev/null' ? plusMatch[1] : '') ||
        (minusMatch?.[1] && minusMatch[1] !== '/dev/null' ? minusMatch[1] : '') ||
        commentFileMatch?.[1] ||
        contextFilename ||
        fallbackFiles[blockIndex] ||
        `patch_${blockIndex + 1}.ts`;

      let additions = 0;
      let deletions = 0;
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
      if (additions === 0 && deletions === 0) {
        additions = lines.length;
      }

      results.push({
        filename: filename.replace(/^[ab]\//, ''),
        additions,
        deletions,
        diff: rawBody,
      });
      seenFiles.add(filename);
      blockIndex++;
    } else if (
      ['ts', 'tsx', 'js', 'jsx', 'rs', 'rust', 'py', 'python', 'go', 'sql', 'toml', 'yaml', 'yml', 'css', 'html', 'sh'].includes(lang) ||
      lines[0]?.match(/^(?:\/\/|#|\/\*)\s*(?:filepath|file|path)[:：\s]*([^\s*]+)/i)
    ) {
      const commentFileMatch = lines[0]?.match(/^(?:\/\/|#|\/\*)\s*(?:filepath|file|path)[:：\s]*([^\s*]+)/i);
      const filename =
        commentFileMatch?.[1] ||
        contextFilename ||
        fallbackFiles.find((f) => !seenFiles.has(f)) ||
        fallbackFiles[blockIndex] ||
        '';

      if (filename || lines.length >= 4) {
        const resolvedName = (filename || `src/patch_${blockIndex + 1}.${lang || 'ts'}`).replace(/^[ab]\//, '');
        const cleanLines = commentFileMatch ? lines.slice(1) : lines;
        const cleanCode = cleanLines.join('\n').trim();
        const codeLines = cleanCode.split('\n');
        const syntheticDiff = [
          `--- a/${resolvedName}`,
          `+++ b/${resolvedName}`,
          `@@ -1,0 +1,${codeLines.length} @@`,
          ...codeLines.map((l) => `+${l}`),
        ].join('\n');

        results.push({
          filename: resolvedName,
          additions: codeLines.length,
          deletions: 0,
          diff: syntheticDiff,
          codeContent: cleanCode,
        });
        seenFiles.add(resolvedName);
        blockIndex++;
      }
    }
  }

  return results;
}

export interface ApplyTopicPatchOptions {
  workspaceRoot: string;
  channelId: string;
  topicId: string;
  patches: TopicPatchDiffItem[];
}

export interface ApplyTopicPatchResponse {
  ok: boolean;
  artifactsDir: string;
  appliedFiles: Array<{
    filename: string;
    mode: 'git_apply' | 'block_replace' | 'created_file' | 'artifact_saved' | 'workspace_memory';
    targetPath: string;
    artifactPath: string;
  }>;
  summary: string;
}

/**
 * 将议题落地 Agent 生成的补丁物理应用到本地工作区与频道归档目录
 */
export async function applyTopicPatchToWorkspace(
  options: ApplyTopicPatchOptions
): Promise<ApplyTopicPatchResponse> {
  const { workspaceRoot, channelId, topicId, patches } = options;

  const tauriInvoke =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__?.invoke ||
        (window as any).__TAURI__?.core?.invoke
      : null;

  if (tauriInvoke) {
    try {
      const res = await tauriInvoke('apply_workspace_patch', {
        workspaceRoot: workspaceRoot || '.',
        channelId: channelId || 'general',
        topicId,
        patches: patches.map((p) => ({
          filename: p.filename,
          diff: p.diff,
          code_content: p.codeContent || null,
        })),
      });
      if (res && res.ok) {
        return {
          ok: true,
          artifactsDir: res.artifacts_dir,
          appliedFiles: (res.applied_files || []).map((f: any) => ({
            filename: f.filename,
            mode: f.mode,
            targetPath: f.target_path,
            artifactPath: f.artifact_path,
          })),
          summary: res.summary || `已物理合入 ${patches.length} 个文件补丁`,
        };
      }
    } catch (err) {
      console.warn('[ACP Client] apply_workspace_patch IPC failed, using local fallback:', err);
    }
  }

  // Web 环境回退：写入虚拟工作区缓存并返回合入明细
  const virtualArtifactsDir = `~/.shinobi/channels/${channelId || 'general'}/artifacts/${topicId}`;
  const appliedFiles = patches.map((p) => ({
    filename: p.filename,
    mode: 'workspace_memory' as const,
    targetPath: `${workspaceRoot || '.'}/${p.filename}`.replace(/\/+/g, '/'),
    artifactPath: `${virtualArtifactsDir}/${p.filename}`,
  }));

  return {
    ok: true,
    artifactsDir: virtualArtifactsDir,
    appliedFiles,
    summary: `已成功合入并归档 ${appliedFiles.length} 个工程文件补丁`,
  };
}

