#!/usr/bin/env node
/**
 * Mock Remote ACP Agent WebSocket Server
 * 用于在本地模拟“远端同事的 Agent 守护进程”，便于离线演示与测试。
 *
 * 启动方式：
 *   node scripts/mock-remote-acp-agent.mjs [port] [agentName]
 * 示例：
 *   node scripts/mock-remote-acp-agent.mjs 9001 "张工 (分布式锁专家)"
 */

import { WebSocketServer } from 'ws';

const port = parseInt(process.argv[2] || '9001', 10);
const agentName = process.argv[3] || '张工 (分布式与高并发专家)';

const wss = new WebSocketServer({ port });

console.log(`\x1b[36m====================================================\x1b[0m`);
console.log(`\x1b[32m🚀 远程 ACP Agent 模拟服务已启动！\x1b[0m`);
console.log(`\x1b[33m• 监听端口:\x1b[0m ws://127.0.0.1:${port}`);
console.log(`\x1b[33m• 模拟角色:\x1b[0m ${agentName}`);
console.log(`\x1b[35m• 协议版本:\x1b[0m ACP v2.0 (兼容 2025-01-01 握手)`);
console.log(`\x1b[36m====================================================\x1b[0m`);
console.log(`\x1b[90m等待 Shadow Crew 客户端发起 WebSocket 握手...\x1b[0m\n`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  console.log(`\x1b[32m[+] 客户端连接建立:\x1b[0m ${clientIp} (${req.url})`);

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error('❌ 解析 JSON 失败:', err);
      return;
    }

    console.log(`\x1b[34m[收到 RPC 请求]\x1b[0m method: ${msg.method}, id: ${msg.id}`);

    // 1. 处理 initialize 握手探针
    if (msg.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 2,
          agentInfo: {
            name: agentName,
            version: '2.0.0',
            description: '运行在同事电脑 (Remote Node: 100.86.12.3) 的高并发与缓存架构专家',
          },
          capabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: true,
            },
            streaming: true,
            nativeMemory: {
              enabled: true,
              autoGenerate: false,
            },
          },
        },
      };

      // 模拟 40ms 网络 RTT 延迟
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(response));
          console.log(`\x1b[32m[✓ 握手成功响应已发出]\x1b[0m`);
        }
      }, 40);
      return;
    }

    // 2. 处理 session/prompt 推演指令
    if (msg.method === 'session/prompt') {
      const promptText =
        Array.isArray(msg.params?.prompt)
          ? msg.params.prompt.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n')
          : String(msg.params?.prompt || '');

      console.log(`\x1b[33m[开始推演任务]\x1b[0m 提示词长度: ${promptText.length} 字符`);

      // 构造智能、专业的模拟技术见解
      let replyContent = '';
      if (promptText.includes('锁') || promptText.includes('Redis') || promptText.includes('redlock') || promptText.includes('并发')) {
        replyContent = `你好！我是**${agentName}**（远端同事电脑直连节点）。\n\n针对你发起的 **分布式锁与高并发结算链路** 议题，我从内核与网络层提出以下 3 点核心研判：\n\n1. **Redlock 时钟漂移风险（Clock Drift）**：\n   - 在物理节点发生 NTP 时钟硬跳变或 GC 停顿超过 TTL 时，客户端可能在锁已过期后仍持有执行权；\n   - 推荐必须引入 **递增 Fencing Token**（栅栏令牌），在数据库写入层通过唯一版本号拒绝过期请求。\n\n2. **超时重试与网络抖动约束**：\n   - 单节点连接超时严格控制在 50ms 内，单轮最大重试 3 次，并引入指数退避加随机抖动（Jitter），防止惊群打垮 Redis 集群。\n\n3. **远端安全只读合规（ReadOnly Guard）**：\n   - 当前会话处于跨机安全隔离态，我不直接改写你的本地物理文件，已将架构建议与参数建议回传给你本地的 Shadow Crew 编队。`;
      } else {
        replyContent = `你好！我是**${agentName}**。我已经通过远程 ACP 协议（WebSocket）收到了你的推演任务。\n\n【远端协同反馈】：\n针对你提出的问题：“${promptText.slice(0, 80).replace(/\n/g, ' ')}...”，我从远端微服务与系统架构视角审视，整体方向可行。\n建议在本地先通过验证官实证边界条件，再进行统一架构合流。`;
      }

      // 模拟流式打字效果 (逐字/逐句 session/update)
      const chunks = replyContent.match(/.{1,15}/g) || [replyContent];
      let chunkIdx = 0;

      const streamInterval = setInterval(() => {
        if (chunkIdx < chunks.length) {
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  content: chunks[chunkIdx],
                },
              })
            );
          }
          chunkIdx++;
        } else {
          clearInterval(streamInterval);
          // 发送终态结果
          if (ws.readyState === ws.OPEN) {
            const finalResult = {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                text_response: replyContent,
                memory_actions: [
                  {
                    action: 'READ',
                    key: 'distributed-lock-fencing-policy',
                    detail: '已调取张工历史沉淀的 Fencing Token 实践记忆',
                  },
                ],
              },
            };
            ws.send(JSON.stringify(finalResult));
            console.log(`\x1b[32m[✓ 推演完成并已返回终态结果]\x1b[0m\n`);
          }
        }
      }, 50);

      return;
    }

    // 3. 处理 session/close 等资源清理
    if (msg.method === 'session/close') {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { closed: true },
          })
        );
      }
      return;
    }

    // 兜底响应
    if (ws.readyState === ws.OPEN && msg.id) {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { success: true },
        })
      );
    }
  });

  ws.on('close', () => {
    console.log(`\x1b[31m[-] 客户端断开连接\x1b[0m\n`);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket 异常:', err.message);
  });
});
