import { Agent, Message } from '../types';

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
  workspaceDiffs?: Array<{ filename: string; diff: string; additions: number; deletions: number }>;
  durationMs: number;
  isRealProcess: boolean;
  raw?: any;
}

/**
 * 真实与模拟双轨 ACP 通信服务
 * 当处于 Tauri 桌面客户端环境时，通过 IPC 直接将 prompt 输入真实 Agent 的 stdio 进程；
 * 若处于纯 Web 浏览器预览模式，则执行自适应的拟真 ACP 协议响应，并完整记录协议 Telemetry。
 */
export async function sendPromptToAcpAgent(
  options: AcpSendPromptOptions
): Promise<AcpAgentResponse> {
  const startTime = Date.now();
  const { agent, roomId, prompt } = options;

  // 1. 检查是否处于 Tauri 桌面端环境
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
        prompt,
        command: agent.acpCommandOrUrl || './target/debug/shinobi-agent',
        cwd: agent.workspace?.rootPath || '.',
        envVars: agent.envVars || [],
      });

      const durationMs = Date.now() - startTime;
      console.log('[ACP Client] Real ACP response received:', response);

      // 解析 JSON-RPC 2.0 返回格式: { jsonrpc: "2.0", id: ..., result: { text_response: ... } }
      if (response && response.result) {
        const res = response.result;
        const text = res.text_response || (res.stopReason ? `【${agent.name}】ACP 任务已完成 (stopReason: ${res.stopReason})` : JSON.stringify(res));
        return {
          textResponse: text,
          memoryActions: res.memory_actions || [],
          workspaceDiffs: res.workspace_diffs || [],
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (response && response.text_response) {
        return {
          textResponse: response.text_response,
          memoryActions: response.memory_actions || [],
          workspaceDiffs: response.workspace_diffs || [],
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      } else if (response && (response.status === 'timeout' || response.status === 'closed' || response.error)) {
        const rawErrMsg = response.error?.message || (typeof response.error === 'string' ? response.error : JSON.stringify(response.error)) || (response.status === 'timeout' ? 'Agent 响应超时 (90s)' : 'Agent 进程异常关闭');
        console.warn('[ACP Client] Process returned status error:', response);

        let formattedHelp = '';
        if (rawErrMsg.toLowerCase().includes('authentication required')) {
          formattedHelp = `\n\n💡 **认证排障指南 (Claude Code ACP)**：\n` +
            `• **原因**：Anthropic 官方规范限制，第三方客户端集成（如 Shadow Crew）**不支持**复用本机的 \`claude.ai\` 网页/OAuth 订阅，需要提供 \`ANTHROPIC_API_KEY\`。\n` +
            `• **配置步骤**：\n` +
            `  1. 点击当前 Agent 卡片右上角【编辑】图标 ✏️；\n` +
            `  2. 在「环境变量 (ENV)」中填入您的 \`ANTHROPIC_API_KEY\`（格式如 \`sk-ant-api03-...\`）；\n` +
            `  3. *(可选)* 若使用第三方反代/中转网关，可额外添加 \`ANTHROPIC_BASE_URL\`；\n` +
            `  4. 保存后重新发送消息或点击「Start」重新拉起即可。`;
        }

        return {
          textResponse: `⚠️【${agent.name}】ACP 通信告警：${rawErrMsg}${formattedHelp}\n\n• **本地日志落盘**：底层原始 stdio 报文已持久化落盘至 \`logs/acp.log\`。\n• **实时跟踪**：可在终端运行 \`tail -f logs/acp.log\` 查看实时流。\n• **关联命令**：\`${agent.acpCommandOrUrl || './target/debug/shinobi-agent'}\`。`,
          durationMs,
          isRealProcess: true,
          raw: response,
        };
      }
    } catch (err) {
      console.warn('[ACP Client] Tauri IPC invocation error or process offline, fallback to simulation:', err);
    }
  }

  // 2. Web 预览或进程故障时的智能兜底拟真响应 (基于 Agent 身份和记忆模式)
  await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400));
  const durationMs = Date.now() - startTime;

  let simulatedText = '';
  const memoryActions: Array<{ action: string; key: string; detail: string }> = [];

  if (agent.id === 'agent-shinobi-core') {
    simulatedText = `【${agent.name}】已就绪并完成需求分析：\n` +
      `针对关于「${prompt.slice(0, 40)}${prompt.length > 40 ? '...' : ''}」的指令，已调取私有 SQLite 记忆库规范。\n` +
      `• **架构策略**：遵循单一职责与零拷贝设计，中间件层全面基于 Tokio 异步通道挂载。\n` +
      `• **下一步建议**：随时可在当前频道发起单层独立推演议题（Topic），或直接分派 Unified Diff 变更任务。`;

    memoryActions.push({
      action: 'recall',
      key: 'rust_guidelines',
      detail: '严禁 unwrap，优先使用 anyhow/thiserror；异步操作一律基于 Tokio 运行时',
    });
  } else if (agent.id === 'agent-1789029918725') {
    simulatedText = `【${agent.name}】ACP 网关协同响应：\n` +
      `收到开发指令：\`${prompt}\`。\n` +
      `已连接到 OpenClaw Gateway 进程，模型参数 \`${agent.modelBadge || 'deepseek'}\` 已加载，已完成上下文对齐。`;

    memoryActions.push({
      action: 'query',
      key: 'openclaw_acp_bridge',
      detail: 'OpenClaw Gateway connects on ws://127.0.0.1:18789 via stdio protocol',
    });
  } else {
    simulatedText = `【${agent.name} (${agent.role})】推演反馈：\n` +
      `已接收到来自研讨频道的指令：「${prompt}」。\n` +
      `本地 ACP 独立沙盒就绪，随时可以开展代码生成与方案校验。`;
  }

  return {
    textResponse: simulatedText,
    memoryActions,
    workspaceDiffs: [],
    durationMs,
    isRealProcess: false,
  };
}
