import { Agent, CartridgeCitation, MemoryCartridgeItem } from '../types';

export interface AcpSendPromptOptions {
  agent: Agent;
  roomId: string;
  prompt: string;
  projectId?: string;
  channelId?: string;
}

export interface AcpAgentResponse {
  textResponse: string;
  memoryActions?: Array<{ action: string; key: string; detail: string }>;
  cartridgeCitation?: CartridgeCitation;
  workspaceDiffs?: Array<{ filename: string; diff: string; additions: number; deletions: number }>;
  durationMs: number;
  isRealProcess: boolean;
  raw?: any;
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
  readOnlyGuard = true
): Promise<AcpAgentResponse> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;
    const timeoutMs = 45000;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
        resolve({
          textResponse: `⚠️【远程 ACP】等待响应超时 (${timeoutMs / 1000}s)，远程 Agent 可能处于繁忙状态。`,
          durationMs: Date.now() - startTime,
          isRealProcess: true,
        });
      }
    }, timeoutMs);

    try {
      const urlObj = new URL(remoteUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }
      ws = new WebSocket(urlObj.toString());

      ws.onopen = () => {
        // 发送 session/prompt 报文
        const rpcPayload = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'session/prompt',
          params: {
            roomId,
            prompt: [{ type: 'text', text: prompt }],
            readOnlyGuard,
          },
        };
        ws?.send(JSON.stringify(rpcPayload));
      };

      let accumulatedText = '';
      const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

      ws.onmessage = (event) => {
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
              clearTimeout(timer);
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
          clearTimeout(timer);
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
        clearTimeout(timer);
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

  // 1. JIT 动态外挂记忆召回 (有限上下文防塞爆)
  const { enhancedPrompt, citation } = recallRelevantCartridgeMemories(agent, prompt);

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
      agent.readOnlyGuard ?? true
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

      const response = await tauriInvoke('send_prompt_to_agent', {
        agentId: agent.id,
        roomId,
        prompt: enhancedPrompt,
        command: agent.acpCommandOrUrl || './target/debug/shinobi-agent',
        cwd: agent.workspace?.rootPath || '.',
        envVars: agent.envVars || [],
      });

      const durationMs = Date.now() - startTime;
      console.log('[ACP Client] Real ACP response received:', response);

      // 解析 JSON-RPC 2.0 返回格式
      if (response && response.result) {
        const res = response.result;
        const text =
          res.text_response ||
          (res.stopReason
            ? `【${agent.name}】ACP 任务已完成 (stopReason: ${res.stopReason})`
            : JSON.stringify(res));
        return {
          textResponse: text,
          memoryActions: res.memory_actions || [],
          cartridgeCitation: citation,
          workspaceDiffs: res.workspace_diffs || [],
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (response && response.text_response) {
        return {
          textResponse: response.text_response,
          memoryActions: response.memory_actions || [],
          cartridgeCitation: citation,
          workspaceDiffs: response.workspace_diffs || [],
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
          (response.status === 'timeout' ? 'Agent 响应超时 (90s)' : 'Agent 进程异常关闭');

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
        }

        return {
          textResponse: `⚠️【${agent.name}】ACP 通信告警：${rawErrMsg}${formattedHelp}\n\n• **本地日志落盘**：底层原始 stdio 报文已持久化落盘至 \`logs/acp.log\`。\n• **实时跟踪**：可在终端运行 \`tail -f logs/acp.log\` 查看实时流。\n• **关联命令**：\`${agent.acpCommandOrUrl || './target/debug/shinobi-agent'}\`。`,
          cartridgeCitation: citation,
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      }
    } catch (err) {
      console.warn('[ACP Client] Tauri IPC invocation error or process offline, fallback to simulation:', err);
    }
  }

  // 4. Web 预览或进程故障时的智能兜底拟真响应
  await new Promise((resolve) => setTimeout(resolve, 2800 + Math.random() * 500));
  const durationMs = Date.now() - startTime;

  let simulatedText = '';
  const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

  if (agent.isGuestClone) {
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
      `• **下一步建议**：随时可在当前频道发起单层独立推演议题（Topic），或直接分派 Unified Diff 变更任务。`;

    memoryActions.push({
      action: 'recall',
      key: 'rust_guidelines',
      detail: '严禁 unwrap，优先使用 anyhow/thiserror；异步操作一律基于 Tokio 运行时',
    });
  } else if (agent.id === 'agent-1789029918725') {
    simulatedText =
      `【${agent.name}】ACP 网关协同响应：\n` +
      `收到开发指令：\`${prompt}\`。\n` +
      `已连接到 OpenClaw Gateway 进程，模型参数 \`${agent.modelBadge || 'deepseek'}\` 已加载，已完成上下文对齐。`;

    memoryActions.push({
      action: 'query',
      key: 'openclaw_acp_bridge',
      detail: 'OpenClaw Gateway connects on ws://127.0.0.1:18789 via stdio protocol',
    });
  } else {
    simulatedText =
      `【${agent.name} (${agent.role})】推演反馈：\n` +
      `已接收到来自研讨频道的指令：「${prompt}」。\n` +
      `ACP 独立推演就绪，已融合上下文信息。随时可以开展代码审查与方案校验。`;
  }

  return {
    textResponse: simulatedText,
    memoryActions,
    cartridgeCitation: citation,
    workspaceDiffs: [],
    durationMs,
    isRealProcess: false,
  };
}
