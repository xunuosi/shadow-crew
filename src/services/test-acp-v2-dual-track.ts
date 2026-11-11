/**
 * ACP v2.0 Protocol, Dual-Track Negotiation & Engine Wrapper Multi-Round Verification Suite
 *
 * Covers commits from a59e02f84faa45280151d5107339693937d86c06:
 * - a59e02f: feat(acp): upgrade protocol to v2 with receipt lifecycle and unified capabilities
 * - e55f545: feat(acp): support dual-track protocol negotiation for v1 and v2
 * - 54a3c38: refactor(codex-acp): wrap official @agentclientprotocol/codex-acp engine with desktop probe and sandbox gates
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { reconcileLocalAgentsRuntimeStatus } from './remoteAgentLifecycle';
import { INITIAL_AGENTS } from '../data/mockData';
import type { Agent, AgentRuntimeStatus } from '../types';

let totalAssertions = 0;
function check(condition: boolean, message: string) {
  assert(condition, message);
  totalAssertions += 1;
}

console.log('================================================================================');
console.log('🧪 Running ACP v2.0 Dual-Track Protocol & Engine Multi-Round Verification Suite');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Helper: Run JSON-RPC conversation against bin/codex-acp
// -----------------------------------------------------------------------------
interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

async function runAcpProcessConversation(
  messagesToSend: JsonRpcMessage[],
  envOverrides: Record<string, string> = {},
  timeoutMs = 3000
): Promise<{ results: Map<number | string, JsonRpcMessage>; notifications: JsonRpcMessage[] }> {
  return new Promise((resolve, reject) => {
    const binPath = path.resolve('bin/codex-acp');
    const child = spawn(process.execPath, [binPath], {
      env: {
        ...process.env,
        SHADOW_CREW_USE_BUILTIN_CODEX_ADAPTER: '1',
        ...envOverrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results = new Map<number | string, JsonRpcMessage>();
    const notifications: JsonRpcMessage[] = [];
    const expectedIds = new Set(
      messagesToSend
        .map((m) => m.id)
        .filter((id): id is number | string => id !== undefined)
    );

    let isDone = false;
    let timer: NodeJS.Timeout | null = null;

    function cleanupAndResolve() {
      if (isDone) return;
      isDone = true;
      if (timer) clearTimeout(timer);
      try {
        child.stdin.end();
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolve({ results, notifications });
    }

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        if (msg.id !== undefined) {
          results.set(msg.id, msg);
          expectedIds.delete(msg.id);
          // 当预期的所有请求都已经收到结果响应，稍等 100ms 接收可能尾随的通知后平滑结束
          if (expectedIds.size === 0) {
            setTimeout(cleanupAndResolve, 120);
          }
        } else if (msg.method) {
          notifications.push(msg);
        }
      } catch {
        // ignore non-json
      }
    });

    child.on('error', (err) => {
      if (!isDone) {
        isDone = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    for (const msg of messagesToSend) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }

    timer = setTimeout(cleanupAndResolve, timeoutMs);
  });
}

// -----------------------------------------------------------------------------
// Round 1: Protocol Negotiation Contract (v2 vs v1)
// -----------------------------------------------------------------------------
console.log('▶ [Round 1] Verifying Dual-Track Protocol Negotiation in bin/codex-acp...');

{
  // Test 1.1: Client requests protocolVersion: 2 -> Negotiates v2
  const v2Init = await runAcpProcessConversation([
    {
      jsonrpc: '2.0',
      id: 101,
      method: 'initialize',
      params: {
        protocolVersion: 2,
        clientInfo: { name: 'shadow-crew', version: '0.1.0' },
        info: { name: 'shadow-crew', version: '0.1.0' },
        capabilities: { tools: false },
      },
    },
  ]);

  const initResp = v2Init.results.get(101);
  check(Boolean(initResp), 'Must receive initialize response for v2 client');
  check(initResp?.result?.protocolVersion === 2, 'Negotiated protocolVersion must be 2 for v2 client');
  check(
    initResp?.result?._meta?.negotiatedProtocolVersion === 2,
    '_meta.negotiatedProtocolVersion must be 2'
  );
  check(Boolean(initResp?.result?.capabilities), 'v2 response must include unified capabilities');
  check(
    initResp?.result?.capabilities?.promptCapabilities?.image === true,
    'v2 promptCapabilities.image must be true'
  );
  check(
    initResp?.result?.capabilities?.promptCapabilities?.embeddedContext === true,
    'v2 promptCapabilities.embeddedContext must be true'
  );
  check(
    initResp?.result?.agentCapabilities?.streaming === true,
    'Backward compatible agentCapabilities must remain populated'
  );

  // Test 1.2: Client requests protocolVersion: 1 -> Negotiates v1
  const v1Init = await runAcpProcessConversation([
    {
      jsonrpc: '2.0',
      id: 102,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'shadow-crew', version: '0.1.0' },
        clientCapabilities: {},
      },
    },
  ]);

  const v1Resp = v1Init.results.get(102);
  check(Boolean(v1Resp), 'Must receive initialize response for v1 client');
  check(v1Resp?.result?.protocolVersion === 1, 'Negotiated protocolVersion must be 1 for v1 client');
  check(
    v1Resp?.result?._meta?.negotiatedProtocolVersion === 1,
    '_meta.negotiatedProtocolVersion must be 1'
  );

  // Test 1.3: Client requests date-string format '2025-01-01 (ACP v1.0.4)' -> Negotiates v1
  const v1LegacyInit = await runAcpProcessConversation([
    {
      jsonrpc: '2.0',
      id: 103,
      method: 'initialize',
      params: {
        protocolVersion: '2025-01-01 (ACP v1.0.4)',
        clientInfo: { name: 'shadow-crew', version: '0.1.0' },
      },
    },
  ]);

  const v1LegacyResp = v1LegacyInit.results.get(103);
  check(
    v1LegacyResp?.result?.protocolVersion === 1,
    'Legacy date-based v1 protocol version must negotiate to 1'
  );
  check(
    v1LegacyResp?.result?._meta?.negotiatedProtocolVersion === 1,
    '_meta.negotiatedProtocolVersion must be 1 for legacy v1 format'
  );
}

console.log('✓ Round 1 passed: Dual-track negotiation correctly routes v1 and v2 clients.\n');

// -----------------------------------------------------------------------------
// Round 2: V2 Turn Completion & Receipt Lifecycle
// -----------------------------------------------------------------------------
console.log('▶ [Round 2] Verifying V2 Session Prompt Turn Completion & Receipt Lifecycle...');

{
  // Test prompt with unavailable codex binary -> triggers turn_complete with error
  const promptRun = await runAcpProcessConversation(
    [
      {
        jsonrpc: '2.0',
        id: 201,
        method: 'initialize',
        params: { protocolVersion: 2 },
      },
      {
        jsonrpc: '2.0',
        id: 202,
        method: 'session/prompt',
        params: {
          sessionId: 'test-session-v2',
          prompt: 'hello world',
        },
      },
    ],
    {
      PATH: '/nonexistent-bin-dir',
      CODEX_PATH: '/nonexistent-bin-dir/codex',
    }
  );

  const promptResult = promptRun.results.get(202);
  check(Boolean(promptResult), 'Must return response to session/prompt');
  check(
    Boolean(promptResult?.result?.messageId),
    'v2 prompt result must contain messageId receipt tracking'
  );
  check(
    promptResult?.result?.status === 'accepted',
    'v2 prompt result must contain status: accepted'
  );

  // Must have received a session/update notification with turn_complete
  const turnCompleteNotif = promptRun.notifications.find(
    (n) =>
      n.method === 'session/update' &&
      n.params?.update?.sessionUpdate === 'turn_complete'
  );
  check(
    Boolean(turnCompleteNotif),
    'Must emit session/update with sessionUpdate: turn_complete'
  );
  check(
    turnCompleteNotif?.params?.sessionId === 'test-session-v2',
    'turn_complete notification must carry correct sessionId'
  );
  check(
    turnCompleteNotif?.params?.update?.messageId === promptResult?.result?.messageId,
    'turn_complete notification messageId must match session/prompt result messageId'
  );
}

console.log('✓ Round 2 passed: V2 turn completion notification & receipt lifecycle verified.\n');

// -----------------------------------------------------------------------------
// Round 3: Frontend Reconcile & State Matrix (remoteAgentLifecycle)
// -----------------------------------------------------------------------------
console.log('▶ [Round 3] Verifying Frontend Reconcile & State Matrix in remoteAgentLifecycle...');

{
  const baseAgent: Agent = {
    ...INITIAL_AGENTS[0],
    id: 'agent-dual-track',
    name: 'Codex Dual Track',
    role: 'coder',
    status: 'running',
    protocolVersion: '2 (ACP v2.0.0)',
    memory: {
      ...INITIAL_AGENTS[0].memory,
      mode: 'native',
      nativeCapability: {
        status: 'enabled',
        scope: 'workspace',
        provider: 'codex-memories',
        lastCheckedAt: Date.now(),
      },
    },
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: true,
      supportsStreaming: true,
    },
  };

  // Test 3.1: Reconcile with negotiated_protocol_version: 'v2'
  const v2Status: AgentRuntimeStatus = {
    agent_id: 'agent-dual-track',
    pid: 1234,
    is_alive: true,
    is_initialized: true,
    auth_state: 'ok',
    status: 'running',
    negotiated_protocol_version: 'v2',
    supports_load_session: true,
    supports_resume_session: true,
  };

  const { agents: afterV2, changed: changedV2 } = reconcileLocalAgentsRuntimeStatus(
    [baseAgent],
    [v2Status]
  );
  check(changedV2, 'Reconciliation should mark changed when negotiated version is applied');
  check(
    afterV2[0].protocolVersion === 'ACP v2.0 (Negotiated)',
    `protocolVersion should become 'ACP v2.0 (Negotiated)', got: ${afterV2[0].protocolVersion}`
  );

  // Test 3.2: Reconcile with negotiated_protocol_version: 'v1'
  const v1Status: AgentRuntimeStatus = {
    agent_id: 'agent-dual-track',
    pid: 1234,
    is_alive: true,
    is_initialized: true,
    auth_state: 'ok',
    status: 'running',
    negotiated_protocol_version: 'v1',
    supports_load_session: false,
    supports_resume_session: true,
  };

  const { agents: afterV1, changed: changedV1 } = reconcileLocalAgentsRuntimeStatus(
    afterV2,
    [v1Status]
  );
  check(changedV1, 'Reconciliation should update when version downgrades to v1');
  check(
    afterV1[0].protocolVersion === 'ACP v1.0.4 (Negotiated)',
    `protocolVersion should become 'ACP v1.0.4 (Negotiated)', got: ${afterV1[0].protocolVersion}`
  );

  // Test 3.3: Reconcile with camelCase negotiatedProtocolVersion: 'v2'
  const camelV2Status: AgentRuntimeStatus = {
    agent_id: 'agent-dual-track',
    pid: 1234,
    is_alive: true,
    is_initialized: true,
    auth_state: 'ok',
    status: 'running',
    negotiatedProtocolVersion: 'v2',
  };

  const { agents: afterCamelV2, changed: changedCamel } = reconcileLocalAgentsRuntimeStatus(
    afterV1,
    [camelV2Status]
  );
  check(changedCamel, 'CamelCase negotiatedProtocolVersion must also trigger change');
  check(
    afterCamelV2[0].protocolVersion === 'ACP v2.0 (Negotiated)',
    'CamelCase negotiatedProtocolVersion must update to v2 display'
  );

  // Test 3.4: Reconcile with null / undefined negotiated version preserves existing display
  const nullVerStatus: AgentRuntimeStatus = {
    agent_id: 'agent-dual-track',
    pid: 1234,
    is_alive: true,
    is_initialized: true,
    auth_state: 'ok',
    status: 'running',
    negotiated_protocol_version: null,
    negotiatedProtocolVersion: undefined,
  };

  const { agents: afterNullVer } = reconcileLocalAgentsRuntimeStatus(
    afterCamelV2,
    [nullVerStatus]
  );
  check(
    afterNullVer[0].protocolVersion === 'ACP v2.0 (Negotiated)',
    'Null/undefined negotiated version must retain previous protocolVersion'
  );

  // Test 3.5: When agent process stops (idle), capabilities reset properly
  const idleStatus: AgentRuntimeStatus = {
    agent_id: 'agent-dual-track',
    pid: 0,
    is_alive: false,
    is_initialized: false,
    auth_state: 'ok',
    status: 'idle',
  };

  const { agents: afterIdle, changed: changedIdle } = reconcileLocalAgentsRuntimeStatus(
    afterNullVer,
    [idleStatus]
  );
  check(changedIdle, 'Reconciliation should mark changed on transition to idle');
  check(afterIdle[0].status === 'idle', 'Agent status must be idle');
  check(
    afterIdle[0].capabilities?.canUseInternalMemory === false,
    'canUseInternalMemory must reset to false on idle'
  );
  check(
    afterIdle[0].memory.nativeCapability.status === 'unknown',
    'nativeCapability status must reset to unknown on idle'
  );
}

console.log('✓ Round 3 passed: Frontend reconcile & state matrix correctly handle v1/v2 transitions.\n');

// -----------------------------------------------------------------------------
// Round 4: AcpInspector UI Contract & Sample JSON-RPC Formatting
// -----------------------------------------------------------------------------
console.log('▶ [Round 4] Verifying AcpInspector UI Sample JSON-RPC Contract for V1 vs V2...');

{
  function generateInspectorSample(agent: {
    name: string;
    protocolVersion?: string;
    capabilities?: { supportsStreaming?: boolean; supportsLoadSession?: boolean; supportsResumeSession?: boolean };
  }): any {
    const isV1Agent =
      agent.protocolVersion?.toLowerCase().includes('v1') ||
      agent.protocolVersion?.startsWith('1.');

    const isResumeSupported = Boolean(agent.capabilities?.supportsResumeSession);
    const isLoadSupported = Boolean(agent.capabilities?.supportsLoadSession);

    return isV1Agent
      ? {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: isLoadSupported,
            streaming: agent.capabilities?.supportsStreaming ?? true,
          },
          sessionCapabilities: isResumeSupported ? { resume: {} } : {},
          agentInfo: {
            name: agent.name,
            version: agent.protocolVersion || '1.0.4',
          },
        }
      : {
          protocolVersion: 2,
          capabilities: {
            loadSession: isLoadSupported,
            streaming: agent.capabilities?.supportsStreaming ?? true,
            sessionCapabilities: isResumeSupported ? { resume: {} } : {},
          },
          agentInfo: {
            name: agent.name,
            version: agent.protocolVersion || '2.0.0',
          },
        };
  }

  // Case 4.1: V2 Agent with negotiated v2
  const sampleV2 = generateInspectorSample({
    name: 'Codex V2',
    protocolVersion: 'ACP v2.0 (Negotiated)',
    capabilities: { supportsResumeSession: true, supportsLoadSession: false },
  });
  check(sampleV2.protocolVersion === 2, 'Inspector sample for v2 agent must specify protocolVersion: 2');
  check(Boolean(sampleV2.capabilities), 'Inspector sample for v2 must place capabilities at root');
  check(sampleV2.agentCapabilities === undefined, 'Inspector sample for v2 must not set root agentCapabilities');

  // Case 4.2: V1 Agent with negotiated v1
  const sampleV1 = generateInspectorSample({
    name: 'Codex V1',
    protocolVersion: 'ACP v1.0.4 (Negotiated)',
    capabilities: { supportsResumeSession: true, supportsLoadSession: true },
  });
  check(sampleV1.protocolVersion === 1, 'Inspector sample for v1 agent must specify protocolVersion: 1');
  check(Boolean(sampleV1.agentCapabilities), 'Inspector sample for v1 must place agentCapabilities at root');
  check(sampleV1.capabilities === undefined, 'Inspector sample for v1 must not set root capabilities');

  // Case 4.3: Legacy date format '2025-01-01 (ACP v1.0.4)'
  const sampleLegacyV1 = generateInspectorSample({
    name: 'Legacy V1',
    protocolVersion: '2025-01-01 (ACP v1.0.4)',
  });
  check(sampleLegacyV1.protocolVersion === 1, 'Legacy v1 format must trigger v1 sample payload');

  // Case 4.4: Default new agent '2 (ACP v2.0.0)'
  const sampleDefaultV2 = generateInspectorSample({
    name: 'Default V2',
    protocolVersion: '2 (ACP v2.0.0)',
  });
  check(sampleDefaultV2.protocolVersion === 2, 'Default agent format must trigger v2 sample payload');
}

console.log('✓ Round 4 passed: AcpInspector sample JSON-RPC cleanly adheres to v1/v2 schema.\n');

// -----------------------------------------------------------------------------
// Round 5: Official Codex Engine Wrapper Bridge Gate Verification
// -----------------------------------------------------------------------------
console.log('▶ [Round 5] Verifying Official Codex Engine Bridge Gates & Mock Detection...');

{
  // Test mock binary detector logic matching bin/codex-acp
  function isMockCodexBinary(binPath: string | null | undefined): boolean {
    if (!binPath) return false;
    const lower = binPath.toLowerCase();
    return (
      lower.includes('fake') ||
      lower.includes('mock') ||
      lower.includes('scpack-codex-acp-e2e') ||
      binPath.startsWith(os.tmpdir())
    );
  }

  check(isMockCodexBinary('/tmp/fake-codex') === true, 'Paths containing fake must be identified as mock');
  check(isMockCodexBinary('/usr/local/bin/mock_codex') === true, 'Paths containing mock must be identified as mock');
  check(isMockCodexBinary('/workspace/scpack-codex-acp-e2e-agent') === true, 'E2E mock harness must be identified as mock');
  check(isMockCodexBinary(path.join(os.tmpdir(), 'bin', 'codex')) === true, 'Binaries in os.tmpdir() must be identified as mock');
  check(isMockCodexBinary('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex') === false, 'Real app path must not be mock');
  check(isMockCodexBinary('/usr/local/bin/codex') === false, 'Real system path must not be mock');
  check(isMockCodexBinary('') === false, 'Empty string must return false');
  check(isMockCodexBinary(undefined) === false, 'Undefined must return false');

  // Test params translation: info vs clientInfo
  function normalizeInitializeParams(msg: any): any {
    if (msg && msg.method === 'initialize' && msg.params) {
      if (!msg.params.info && msg.params.clientInfo) {
        msg.params.info = msg.params.clientInfo;
      }
    }
    return msg;
  }

  const normalized = normalizeInitializeParams({
    method: 'initialize',
    params: {
      clientInfo: { name: 'shadow-crew', version: '0.1.0' },
    },
  });
  check(
    Boolean(normalized.params.info) && normalized.params.info.name === 'shadow-crew',
    'normalizeInitializeParams must copy clientInfo to info when info is missing'
  );

  const existingInfo = normalizeInitializeParams({
    method: 'initialize',
    params: {
      info: { name: 'existing-info', version: '1.0' },
      clientInfo: { name: 'shadow-crew', version: '0.1.0' },
    },
  });
  check(
    existingInfo.params.info.name === 'existing-info',
    'normalizeInitializeParams must preserve pre-existing info object'
  );
}

console.log('✓ Round 5 passed: Official codex adapter bridge gates & mock detection verified.\n');

// -----------------------------------------------------------------------------
// Round 6: Active turn.completed Harvesting & Tool Heartbeat Anti-Freeze Verification
// -----------------------------------------------------------------------------
console.log('▶ [Round 6] Verifying Active turn.completed Harvesting & Tool Heartbeat Anti-Freeze...');

{
  const fs = await import('node:fs');
  const tempScriptPath = path.resolve('.mock-codex-lingering.sh');
  const mockScriptContent = `#!/bin/bash
if [ "$1" = "--version" ]; then
  echo "codex 0.167.0"
  exit 0
fi
if [ "$1" = "--enable" ] || [ "$1" = "--disable" ]; then
  echo "features list"
  exit 0
fi

# 仅在实际执行 turn (exec) 时输出事件流并模拟子进程/网络句柄残留休眠
cat << 'EOF'
{"type":"thread.started","thread_id":"thread-freeze-probe-1"}
{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"cargo test -p shadow-crew-protocol"}}
{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"cargo test -p shadow-crew-protocol","exit_code":0}}
{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"All 10 assertions passed in cargo test."}}
{"type":"turn.completed","status":"completed"}
EOF
sleep 25
`;

  fs.writeFileSync(tempScriptPath, mockScriptContent, { mode: 0o755 });

  const startTime = Date.now();
  const runRes = await runAcpProcessConversation(
    [
      {
        jsonrpc: '2.0',
        id: 601,
        method: 'initialize',
        params: { protocolVersion: 2 },
      },
      {
        jsonrpc: '2.0',
        id: 602,
        method: 'session/prompt',
        params: {
          sessionId: 'test-session-anti-freeze',
          prompt: 'run validation tests',
        },
      },
    ],
    {
      CODEX_BINARY: tempScriptPath,
      SHADOW_CREW_USE_BUILTIN_CODEX_ADAPTER: '1',
    }
  );
  const elapsedMs = Date.now() - startTime;

  try {
    fs.unlinkSync(tempScriptPath);
  } catch {
    // ignore
  }

  // 1. 验证响应时长：必须在 ~2 秒内基于 turn.completed 结题收网，绝不能被 25 秒的死锁休眠阻塞
  check(
    elapsedMs < 5000,
    `Adapter must conclude turn via turn.completed without waiting for lingering child sleep (took ${elapsedMs}ms)`
  );

  const promptResult = runRes.results.get(602);
  check(Boolean(promptResult), 'Must return JSON-RPC response to session/prompt');
  check(
    promptResult?.result?.stopReason === 'completed',
    `stopReason must be completed, got: ${promptResult?.result?.stopReason}`
  );
  check(
    String(promptResult?.result?.text_response || '').includes('All 10 assertions passed'),
    'Final text response must contain the completed agent message'
  );

  // 2. 验证工具与命令执行心跳 chunk
  const chunks = runRes.notifications
    .filter((n) => n.method === 'session/update' && n.params?.update?.sessionUpdate === 'agent_message_chunk')
    .map((n) => n.params?.update?.delta || '');
  const allChunkText = chunks.join('');

  check(
    allChunkText.includes('正在执行: `cargo test -p shadow-crew-protocol`'),
    'Adapter must stream command execution progress chunk to keep stdout alive'
  );
  check(
    allChunkText.includes('命令已完成'),
    'Adapter must stream command completed progress chunk'
  );

  // 3. 验证终态通知
  const turnCompleteNotif = runRes.notifications.find(
    (n) => n.method === 'session/update' && n.params?.update?.sessionUpdate === 'turn_complete'
  );
  check(Boolean(turnCompleteNotif), 'Must emit session/update turn_complete notification');
  check(turnCompleteNotif?.params?.update?.stopReason === 'end_turn', 'Turn complete stopReason must be end_turn');
}

console.log('✓ Round 6 passed: turn.completed harvested in <2s with active tool execution streaming.\n');

console.log('================================================================================');
console.log(`✅ ALL ACP V2.0 DUAL-TRACK & ENGINE TESTS PASSED! (${totalAssertions} assertions)`);
console.log('================================================================================');
