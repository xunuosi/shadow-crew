import assert from 'node:assert/strict';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, Interface } from 'node:readline';
import { Agent } from '../types';
import {
  ACP_NATIVE_MEMORY_ENV,
  ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV,
  AGENT_MEMORY_SCHEMA_VERSION,
  createAgentMemoryBank,
  migrateAgentMemoryV1,
  parseNativeMemoryCapability,
} from './agentMemory';
import { buildAgentLaunchEnv } from './acpClient';

interface AdapterHarness {
  child: ChildProcessWithoutNullStreams;
  lines: Interface;
  send(message: unknown): void;
  request(method: string, params: unknown, id: number): Promise<any>;
  close(): Promise<void>;
}

function createFakeCodex(tempDir: string): { binary: string; actionsFile: string } {
  mkdirSync(tempDir, { recursive: true });
  const binary = join(tempDir, 'fake-codex.cjs');
  const actionsFile = join(tempDir, 'fake-codex-actions.jsonl');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CODEX_ACTIONS, JSON.stringify({
  args,
  nativeMemory: process.env.SHADOW_CREW_ACP_NATIVE_MEMORY || '',
  nativeMemoryAutoGenerate: process.env.SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE || ''
}) + '\\n');
if (args.includes('--version')) {
  console.log('codex-cli 99.0.0-test');
  process.exit(0);
}
if (args.includes('features') && args.includes('list')) {
  console.log('memories stable true');
  process.exit(0);
}
if (args[0] === 'exec') {
  process.stdin.resume();
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-native-memory-test' }));
    console.log(JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'OK' }
    }));
    process.exit(0);
  });
  return;
}
console.error('Unexpected fake codex invocation: ' + args.join(' '));
process.exit(2);
`,
    'utf8'
  );
  chmodSync(binary, 0o755);
  return { binary, actionsFile };
}

async function startAdapter(
  tempDir: string,
  nativeMemoryEnabled: boolean,
  autoGenerate = false,
  realHome?: string
): Promise<{ harness: AdapterHarness; actionsFile?: string }> {
  const fake = realHome ? null : createFakeCodex(tempDir);
  const home =
    realHome ||
    join(tempDir, nativeMemoryEnabled ? 'home-enabled' : 'home-disabled');
  if (realHome) {
    mkdirSync(realHome, { recursive: true });
    const configLink = join(realHome, 'config.toml');
    const authLink = join(realHome, 'auth.json');
    const realConfig = join(homedir(), '.codex', 'config.toml');
    const realAuth = join(homedir(), '.codex', 'auth.json');
    if (existsSync(realConfig) && !existsSync(configLink)) {
      symlinkSync(realConfig, configLink);
    }
    if (existsSync(realAuth) && !existsSync(authLink)) {
      symlinkSync(realAuth, authLink);
    }
  }
  const adapter = join(process.cwd(), 'bin', 'codex-acp');
  const child = spawn(process.execPath, [adapter], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: realHome ? homedir() : home,
      CODEX_HOME: realHome || join(home, '.codex-unused'),
      SHADOW_CREW_HOME: realHome
        ? join(realHome, 'shadow-crew-home')
        : join(home, '.shadow-crew'),
      ...(fake ? { CODEX_BINARY: fake.binary } : {}),
      SHADOW_CREW_ACP_NATIVE_MEMORY: nativeMemoryEnabled ? '1' : '0',
      SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE: autoGenerate ? '1' : '0',
      ...(fake ? { FAKE_CODEX_ACTIONS: fake.actionsFile } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, terminal: false });
  const pending = new Map<number, (value: any) => void>();
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (typeof message.id === 'number') {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    } catch {
      // ACP transport is JSONL; malformed output is captured via timeout/stderr.
    }
  });

  const harness: AdapterHarness = {
    child,
    lines,
    send(message) {
      child.stdin.write(JSON.stringify(message) + '\n');
    },
    request(method, params, id) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}; stderr=${stderr}`));
        }, 45000);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        harness.send({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      });
    },
    async close() {
      lines.close();
      child.stdin.end();
      if (!child.killed) child.kill();
      await new Promise<void>((resolve) => child.once('close', () => resolve()));
    },
  };

  return { harness, actionsFile: fake?.actionsFile };
}

function readActions(
  actionsFile: string
): Array<{ args: string[]; nativeMemory: string; nativeMemoryAutoGenerate: string }> {
  if (!existsSync(actionsFile)) return [];
  return readFileSync(actionsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function verifyAdapterEnabledFlow(tempDir: string): Promise<number> {
  let assertions = 0;
  const { harness, actionsFile } = await startAdapter(tempDir, true);
  assert.equal(typeof actionsFile, 'string');
  try {
    const init = await harness.request('initialize', {}, 1);
    const capability = init.result?.agentCapabilities?.nativeMemory;
    assert.equal(capability?.supported, true);
    assert.equal(capability?.enabled, true);
    assert.equal(capability?.persistent, true);
    assert.equal(capability?.crossThread, true);
    assert.equal(capability?.provider, 'codex-memories');
    assertions += 5;

    const newSession = await harness.request(
      'session/new',
      { cwd: tempDir, systemPrompt: 'native memory test' },
      2
    );
    const sessionId = newSession.result?.sessionId;
    assert.equal(typeof sessionId, 'string');
    assertions++;

    const firstPrompt = await harness.request(
      'session/prompt',
      { sessionId, cwd: tempDir, prompt: [{ type: 'text', text: '记住 canary' }] },
      3
    );
    assert.equal(firstPrompt.result?.text_response, 'OK');
    assertions++;

    const secondPrompt = await harness.request(
      'session/prompt',
      { sessionId, cwd: tempDir, prompt: [{ type: 'text', text: '复述 canary' }] },
      4
    );
    assert.equal(secondPrompt.result?.text_response, 'OK');
    assertions++;

    const execActions = readActions(actionsFile!).filter((entry) => entry.args[0] === 'exec');
    assert.equal(execActions.length, 2);
    for (const action of execActions) {
      assert.ok(action.args.includes('--enable'));
      assert.ok(action.args.includes('memories'));
      assert.ok(action.args.includes('memories.use_memories=true'));
      assert.ok(action.args.includes('memories.generate_memories=false'));
      assert.ok(action.args.includes('memories.dedicated_tools=true'));
      assert.equal(action.nativeMemory, '1');
      assert.equal(action.nativeMemoryAutoGenerate, '0');
    }
    assert.ok(execActions[0].args.includes('-'));
    assert.ok(
      execActions[1].args.includes('resume') &&
        execActions[1].args.includes('thread-native-memory-test')
    );
    assert.ok(execActions[1].args.indexOf('-') > execActions[1].args.indexOf('thread-native-memory-test'));
    assertions += 26;
  } finally {
    await harness.close();
  }
  return assertions;
}

async function verifyAdapterDisabledFlow(tempDir: string): Promise<number> {
  const { harness, actionsFile } = await startAdapter(tempDir, false);
  try {
    const init = await harness.request('initialize', {}, 1);
    const capability = init.result?.agentCapabilities?.nativeMemory;
    assert.equal(capability?.supported, true);
    assert.equal(capability?.enabled, false);
    assert.match(capability?.detail || '', /关闭原生记忆/);
    const session = await harness.request('session/new', { cwd: tempDir }, 2);
    await harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'disabled memory probe' }],
      },
      3
    );
    assert.equal(typeof actionsFile, 'string');
    const execAction = readActions(actionsFile!).find((entry) => entry.args[0] === 'exec');
    assert.ok(execAction);
    assert.ok(!execAction!.args.includes('memories'));
    assert.ok(!execAction!.args.includes('memories.dedicated_tools=true'));
    assert.equal(execAction!.nativeMemory, '0');
    assert.equal(execAction!.nativeMemoryAutoGenerate, '0');
    return 9;
  } finally {
    await harness.close();
  }
}

async function verifyAdapterAutoGenerateFlow(tempDir: string): Promise<number> {
  const { harness, actionsFile } = await startAdapter(tempDir, true, true);
  try {
    await harness.request('initialize', {}, 1);
    const session = await harness.request('session/new', { cwd: tempDir }, 2);
    await harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'auto generation probe' }],
      },
      3
    );
    assert.equal(typeof actionsFile, 'string');
    const execAction = readActions(actionsFile!).find((entry) => entry.args[0] === 'exec');
    assert.ok(execAction);
    assert.ok(execAction!.args.includes('memories.generate_memories=true'));
    assert.equal(execAction!.nativeMemoryAutoGenerate, '1');
    return 4;
  } finally {
    await harness.close();
  }
}

function verifyTypeContracts(): number {
  let assertions = 0;
  const parsed = parseNativeMemoryCapability({
    agentCapabilities: {
      nativeMemory: {
        supported: true,
        enabled: true,
        persistent: true,
        crossThread: true,
        provider: 'test-memory',
        scope: 'runtime',
      },
    },
  });
  assert.equal(parsed.status, 'enabled');
  assert.equal(parsed.crossThread, true);
  assertions += 2;

  const oldAgent = {
    id: 'agent-legacy',
    name: 'Legacy Agent',
    handle: '@legacy',
    avatar: '🥷',
    role: 'Test',
    description: 'Legacy memory config',
    color: '#2563eb',
    status: 'idle',
    acpTransport: 'stdio',
    acpCommandOrUrl: 'codex-acp',
    protocolVersion: '1',
    capabilities: {
      canUseInternalMemory: true,
      canAccessWorkspaceFiles: true,
      canExecuteSkills: true,
      canDelegateToSubAgents: false,
      supportsStreaming: true,
    },
    workspace: {
      rootPath: '~/.shadow-crew',
      repoName: 'shadow-crew',
      gitBranch: 'main',
      permissionMode: 'full_read_write',
      activeFiles: [],
    },
    skills: [],
    memory: {
      internalMemoryPath: '~/.shadow-crew/legacy_memory.sqlite',
      persistentType: 'sqlite',
      persistentItems: [],
      sessionCacheCount: 0,
    },
  } as unknown as Agent;
  const migrated = migrateAgentMemoryV1(oldAgent);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.agent.memory.schemaVersion, AGENT_MEMORY_SCHEMA_VERSION);
  assert.equal(migrated.agent.memory.mode, 'native');
  assert.equal(migrated.agent.memory.autoGenerate, false);
  assert.equal(migrated.agent.memory.internalMemoryPath, '由 ACP 端点管理');
  assertions += 5;

  const noMemoryAgent = { ...oldAgent } as unknown as Agent;
  delete (noMemoryAgent as Partial<Agent>).memory;
  const noMemoryMigrated = migrateAgentMemoryV1(noMemoryAgent);
  assert.equal(noMemoryMigrated.agent.memory.mode, 'native');
  assert.equal(noMemoryMigrated.agent.memory.nativeCapability.status, 'unknown');
  assertions += 2;

  const nativeAgent = {
    ...migrated.agent,
    envVars: [{ key: ACP_NATIVE_MEMORY_ENV, value: 'user-forged-value' }],
  };
  const nativeEnv = buildAgentLaunchEnv(nativeAgent);
  assert.deepEqual(
    nativeEnv.filter((item) => item.key === ACP_NATIVE_MEMORY_ENV),
    [{ key: ACP_NATIVE_MEMORY_ENV, value: '1' }]
  );
  assert.deepEqual(
    nativeEnv.filter((item) => item.key === ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV),
    [{ key: ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV, value: '0' }]
  );
  const disabledAgent: Agent = {
    ...nativeAgent,
    memory: createAgentMemoryBank('disabled'),
  };
  assert.equal(
    buildAgentLaunchEnv(disabledAgent).find((item) => item.key === ACP_NATIVE_MEMORY_ENV)?.value,
    '0'
  );
  const disabledWithAuto = createAgentMemoryBank('disabled', true);
  assert.equal(disabledWithAuto.autoGenerate, false);
  assertions += 4;
  return assertions;
}

async function verifyRealCodexFlow(tempDir: string): Promise<number> {
  const realHome = join(tempDir, 'real-codex-home');
  const canaryKey = 'ACP_NATIVE_MEMORY_CANARY_20261102';
  const canaryValue = 'ORBIT-7742-LYNX';

  const sourceAdapter = await startAdapter(
    join(tempDir, 'real-source'),
    true,
    false,
    realHome
  );
  try {
    const init = await sourceAdapter.harness.request('initialize', {}, 1);
    assert.equal(
      init.result?.agentCapabilities?.nativeMemory?.enabled,
      true,
      JSON.stringify(init.result?.agentCapabilities?.nativeMemory)
    );
    const session = await sourceAdapter.harness.request(
      'session/new',
      { cwd: tempDir, systemPrompt: '' },
      2
    );
    const writeResult = await sourceAdapter.harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [
          {
            type: 'text',
            text: `请长期记住这个工程约定：${canaryKey} = ${canaryValue}。不要使用 shell、文件或网络。完成后只回复 RECORDED。`,
          },
        ],
      },
      3
    );
    assert.match(writeResult.result?.text_response || '', /RECORDED/);
    const notesDir = join(realHome, 'memories_v2', 'extensions', 'ad_hoc', 'notes');
    assert.equal(existsSync(notesDir), true);
    const memoryWritten = readdirSync(notesDir).some((fileName) =>
      readFileSync(join(notesDir, fileName), 'utf8').includes(canaryKey)
    );
    assert.equal(memoryWritten, true);
  } finally {
    await sourceAdapter.harness.close();
  }

  const recallAdapter = await startAdapter(
    join(tempDir, 'real-recall'),
    true,
    false,
    realHome
  );
  try {
    await recallAdapter.harness.request('initialize', {}, 1);
    const session = await recallAdapter.harness.request(
      'session/new',
      { cwd: tempDir, systemPrompt: '' },
      2
    );
    const recallResult = await recallAdapter.harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [
          {
            type: 'text',
            text: `只使用 Codex 原生 memory 工具查询 ${canaryKey} 的 value。不要使用 shell、文件、网络或当前会话历史。只回答 value；不知道回答 UNKNOWN。`,
          },
        ],
      },
      3
    );
    const response = recallResult.result?.text_response || '';
    assert.match(response, new RegExp(canaryValue));
    return 5;
  } finally {
    await recallAdapter.harness.close();
  }
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'shadow-crew-native-memory-'));
  let assertions = 0;
  try {
    assertions += verifyTypeContracts();
    assertions += await verifyAdapterEnabledFlow(join(tempDir, 'enabled'));
    assertions += await verifyAdapterDisabledFlow(join(tempDir, 'disabled'));
    assertions += await verifyAdapterAutoGenerateFlow(join(tempDir, 'auto'));
    if (process.env.SHADOW_CREW_REAL_NATIVE_MEMORY_TEST === '1') {
      assertions += await verifyRealCodexFlow(join(tempDir, 'real'));
      console.log(
        `ACP native memory E2E passed (${assertions} assertions, isolated CODEX_HOME).`
      );
    } else {
      console.log(`ACP native memory regression suite passed (${assertions} assertions).`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
