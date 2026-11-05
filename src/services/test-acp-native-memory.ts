import assert from 'node:assert/strict';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
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
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Agent } from '../types';
import { INITIAL_AGENTS } from '../data/mockData';
import { ThemeProvider } from '../context/ThemeContext';
import { AgentDashboard } from '../components/AgentDashboard';
import { AcpInspector } from '../components/AcpInspector';
import { ConnectAgentModal } from '../components/ConnectAgentModal';
import {
  ACP_NATIVE_MEMORY_ENV,
  ACP_NATIVE_MEMORY_AUTO_GENERATE_ENV,
  AGENT_MEMORY_SCHEMA_VERSION,
  createAgentMemoryBank,
  migrateAgentMemoryV1,
  normalizeHydratedAgent,
  parseNativeMemoryCapability,
} from './agentMemory';
import {
  buildAgentLaunchEnv,
  probeRemoteAcpConnection,
  sendPromptToAcpAgent,
  sendPromptToRemoteAcpWebSocket,
  setOnAcpNativeMemoryCapabilityUpdated,
} from './acpClient';
import {
  applyLocalStatusChangeEvent,
  applyPromptNativeMemoryCapability,
  applyRemoteProbeOutcome,
  beginLocalSpawn,
  beginRemoteProbe,
  cancelLocalSpawn,
  cancelRemoteProbe,
  completeLocalSpawn,
  completeRemoteProbe,
  isAgentActivelyRunning,
  isCurrentLocalSpawnGeneration,
  markRemoteAgentStarting,
  nativeMemoryCapabilityChanged,
  reconcileLocalAgentsRuntimeStatus,
  recordRemoteProbeSuccess,
  resolveSavedAgentNativeMemoryState,
  shouldStopLocalAgentProcess,
  shouldRefreshRemoteProbe,
  stopAgentRuntimeState,
} from './remoteAgentLifecycle';

interface AdapterHarness {
  child: ChildProcessWithoutNullStreams;
  lines: Interface;
  send(message: unknown): void;
  request(method: string, params: unknown, id: number): Promise<any>;
  close(): Promise<void>;
}

interface FakeCodexAction {
  args: string[];
  nativeMemory: string;
  nativeMemoryAutoGenerate: string;
  configMemoriesEnabled: boolean;
  effectiveMemoriesEnabled: boolean;
  effectiveUseMemories: boolean;
  effectiveGenerateMemories: boolean;
  effectiveDedicatedTools: boolean;
}

interface StartAdapterOptions {
  featureFailures?: number;
}

const EXPECTED_NATIVE_MEMORY_PROBE_ATTEMPTS = 2;

function createFakeCodex(
  tempDir: string
): { binary: string; actionsFile: string; featureCounterFile: string } {
  mkdirSync(tempDir, { recursive: true });
  const binary = join(tempDir, 'fake-codex.cjs');
  const actionsFile = join(tempDir, 'fake-codex-actions.jsonl');
  const featureCounterFile = join(tempDir, 'fake-codex-feature-counter.txt');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const codexHome = process.env.CODEX_HOME || '';
const configPath = codexHome ? path.join(codexHome, 'config.toml') : '';
const configText = configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
const configMemoriesEnabled = /^\\s*memories\\s*=\\s*true\\s*$/m.test(configText);
let effectiveMemoriesEnabled = configMemoriesEnabled;
let effectiveUseMemories = /^\\s*use_memories\\s*=\\s*true\\s*$/m.test(configText) || configMemoriesEnabled;
let effectiveGenerateMemories = /^\\s*generate_memories\\s*=\\s*true\\s*$/m.test(configText);
let effectiveDedicatedTools = /^\\s*dedicated_tools\\s*=\\s*true\\s*$/m.test(configText) || configMemoriesEnabled;

for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  const next = args[i + 1];
  if (token === '--enable' && next === 'memories') {
    effectiveMemoriesEnabled = true;
    i += 1;
  } else if (token === '--disable' && next === 'memories') {
    effectiveMemoriesEnabled = false;
    i += 1;
  } else if (token === '-c' && typeof next === 'string') {
    if (next === 'features.memories=true') effectiveMemoriesEnabled = true;
    if (next === 'features.memories=false') effectiveMemoriesEnabled = false;
    if (next === 'memories.use_memories=true') effectiveUseMemories = true;
    if (next === 'memories.use_memories=false') effectiveUseMemories = false;
    if (next === 'memories.generate_memories=true') effectiveGenerateMemories = true;
    if (next === 'memories.generate_memories=false') effectiveGenerateMemories = false;
    if (next === 'memories.dedicated_tools=true') effectiveDedicatedTools = true;
    if (next === 'memories.dedicated_tools=false') effectiveDedicatedTools = false;
    i += 1;
  }
}

fs.appendFileSync(process.env.FAKE_CODEX_ACTIONS, JSON.stringify({
  args,
  nativeMemory: process.env.SHADOW_CREW_ACP_NATIVE_MEMORY || '',
  nativeMemoryAutoGenerate: process.env.SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE || '',
  configMemoriesEnabled,
  effectiveMemoriesEnabled,
  effectiveUseMemories,
  effectiveGenerateMemories,
  effectiveDedicatedTools,
}) + '\\n');
if (args.includes('--version')) {
  console.log('codex-cli 99.0.0-test');
  process.exit(0);
}
if (args.includes('features') && args.includes('list')) {
  const counterPath = process.env.FAKE_CODEX_FEATURE_COUNTER;
  let featureRequestCount = 0;
  if (counterPath) {
    featureRequestCount = fs.existsSync(counterPath)
      ? Number(fs.readFileSync(counterPath, 'utf8')) || 0
      : 0;
    featureRequestCount += 1;
    fs.writeFileSync(counterPath, String(featureRequestCount));
  }
  const featureFailures = Number(process.env.FAKE_CODEX_FEATURE_FAILURES || 0);
  if (featureRequestCount <= featureFailures) {
    console.error('transient feature probe failure ' + featureRequestCount);
    process.exit(75);
  }
  console.log(\`memories stable \${effectiveMemoriesEnabled ? 'true' : 'false'}\`);
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
  return { binary, actionsFile, featureCounterFile };
}

async function startAdapter(
  tempDir: string,
  nativeMemoryEnabled: boolean,
  autoGenerate = false,
  realHome?: string,
  options: StartAdapterOptions = {}
): Promise<{
  harness: AdapterHarness;
  actionsFile?: string;
  featureCounterFile?: string;
}> {
  const fake = realHome ? null : createFakeCodex(tempDir);
  const home =
    realHome ||
    join(tempDir, nativeMemoryEnabled ? 'home-enabled' : 'home-disabled');
  const codexHome = realHome || join(home, '.codex-unused');
  mkdirSync(codexHome, { recursive: true });
  if (realHome) {
    const configPath = join(realHome, 'config.toml');
    const authLink = join(realHome, 'auth.json');
    const realConfig = join(homedir(), '.codex', 'config.toml');
    const realAuth = join(homedir(), '.codex', 'auth.json');
    if (existsSync(realConfig) && !existsSync(configPath)) {
      copyFileSync(realConfig, configPath);
    }
    if (existsSync(realAuth) && !existsSync(authLink)) {
      symlinkSync(realAuth, authLink);
    }
  } else {
    // Simulate a user global config.toml that explicitly enables Codex memories,
    // verifying that Shadow Crew's `disabled` mode actively overrides user config.
    writeFileSync(
      join(codexHome, 'config.toml'),
      [
        '[features]',
        'memories = true',
        '',
        '[memories]',
        'use_memories = true',
        'generate_memories = true',
        'dedicated_tools = true',
        '',
      ].join('\n'),
      'utf8'
    );
  }
  const adapter = join(process.cwd(), 'bin', 'codex-acp');
  const child = spawn(process.execPath, [adapter], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: realHome ? homedir() : home,
      CODEX_HOME: codexHome,
      SHADOW_CREW_HOME: realHome
        ? join(realHome, 'shadow-crew-home')
        : join(home, '.shadow-crew'),
      ...(fake ? { CODEX_BINARY: fake.binary } : {}),
      SHADOW_CREW_ACP_NATIVE_MEMORY: nativeMemoryEnabled ? '1' : '0',
      SHADOW_CREW_ACP_NATIVE_MEMORY_AUTO_GENERATE: autoGenerate ? '1' : '0',
      ...(fake
        ? {
            FAKE_CODEX_ACTIONS: fake.actionsFile,
            FAKE_CODEX_FEATURE_COUNTER: fake.featureCounterFile,
            FAKE_CODEX_FEATURE_FAILURES: String(options.featureFailures || 0),
          }
        : {}),
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

  return {
    harness,
    actionsFile: fake?.actionsFile,
    featureCounterFile: fake?.featureCounterFile,
  };
}

function readActions(actionsFile: string): FakeCodexAction[] {
  if (!existsSync(actionsFile)) return [];
  return readFileSync(actionsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function upsertTomlSectionValue(
  content: string,
  section: string,
  key: string,
  value: string
): string {
  const lines = content.split(/\r?\n/);
  const header = `[${section}]`;
  const sectionStart = lines.findIndex((line) => line.trim() === header);

  if (sectionStart === -1) {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}${header}\n${key} = ${value}\n`;
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (keyPattern.test(lines[index])) {
      lines[index] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }

  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === '') {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, `${key} = ${value}`);
  return lines.join('\n');
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
      assert.equal(action.configMemoriesEnabled, true);
      assert.equal(action.effectiveMemoriesEnabled, true);
      assert.equal(action.effectiveUseMemories, true);
      assert.equal(action.effectiveGenerateMemories, false);
      assert.equal(action.effectiveDedicatedTools, true);
    }
    assert.ok(execActions[0].args.includes('-'));
    assert.ok(
      execActions[1].args.includes('resume') &&
        execActions[1].args.includes('thread-native-memory-test')
    );
    assert.ok(execActions[1].args.indexOf('-') > execActions[1].args.indexOf('thread-native-memory-test'));
    assertions += 36;
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
    assert.ok(execAction!.args.includes('--disable'));
    assert.ok(execAction!.args.includes('memories'));
    assert.ok(execAction!.args.includes('features.memories=false'));
    assert.ok(execAction!.args.includes('memories.use_memories=false'));
    assert.ok(execAction!.args.includes('memories.generate_memories=false'));
    assert.ok(execAction!.args.includes('memories.dedicated_tools=false'));
    assert.equal(execAction!.nativeMemory, '0');
    assert.equal(execAction!.nativeMemoryAutoGenerate, '0');
    // User config.toml has [features] memories = true, but CLI flags override all effective flags to false
    assert.equal(execAction!.configMemoriesEnabled, true);
    assert.equal(execAction!.effectiveMemoriesEnabled, false);
    assert.equal(execAction!.effectiveUseMemories, false);
    assert.equal(execAction!.effectiveGenerateMemories, false);
    assert.equal(execAction!.effectiveDedicatedTools, false);
    return 17;
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
    assert.equal(execAction!.effectiveGenerateMemories, true);
    return 5;
  } finally {
    await harness.close();
  }
}

async function verifyAdapterMetaPolicyOverrideFlow(tempDir: string): Promise<number> {
  const { harness, actionsFile } = await startAdapter(tempDir, true, false);
  try {
    const initDisabled = await harness.request(
      'initialize',
      {
        _meta: {
          shadowCrew: {
            nativeMemory: { enabled: false, autoGenerate: true },
          },
        },
      },
      1
    );
    const disabledCap = initDisabled.result?.agentCapabilities?.nativeMemory;
    assert.equal(disabledCap?.supported, true);
    assert.equal(disabledCap?.enabled, false);

    const initEnabled = await harness.request(
      'initialize',
      {
        _meta: {
          shadowCrew: {
            nativeMemory: { enabled: true, autoGenerate: true },
          },
        },
      },
      2
    );
    const enabledCap = initEnabled.result?.agentCapabilities?.nativeMemory;
    assert.equal(enabledCap?.supported, true);
    assert.equal(enabledCap?.enabled, true);

    const session = await harness.request('session/new', { cwd: tempDir }, 3);
    const sessionId = session.result?.sessionId;
    await harness.request(
      'session/prompt',
      {
        sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'meta disabled override' }],
        _meta: {
          shadowCrew: {
            nativeMemory: { enabled: false, autoGenerate: true },
          },
        },
      },
      4
    );
    await harness.request(
      'session/prompt',
      {
        sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'meta enabled autoGenerate override' }],
        _meta: {
          shadowCrew: {
            nativeMemory: { enabled: true, autoGenerate: true },
          },
        },
      },
      5
    );

    const execActions = readActions(actionsFile!).filter((entry) => entry.args[0] === 'exec');
    assert.equal(execActions.length, 2);
    assert.ok(execActions[0].args.includes('--disable'));
    assert.ok(execActions[0].args.includes('features.memories=false'));
    assert.ok(execActions[0].args.includes('memories.use_memories=false'));
    assert.ok(execActions[0].args.includes('memories.generate_memories=false'));
    assert.ok(execActions[0].args.includes('memories.dedicated_tools=false'));
    assert.equal(execActions[0].nativeMemory, '0');
    assert.equal(execActions[0].nativeMemoryAutoGenerate, '0');
    assert.equal(execActions[0].configMemoriesEnabled, true);
    assert.equal(execActions[0].effectiveMemoriesEnabled, false);
    assert.equal(execActions[0].effectiveUseMemories, false);
    assert.equal(execActions[0].effectiveGenerateMemories, false);
    assert.equal(execActions[0].effectiveDedicatedTools, false);
    assert.ok(execActions[1].args.includes('memories'));
    assert.ok(execActions[1].args.includes('memories.generate_memories=true'));
    assert.equal(execActions[1].nativeMemory, '1');
    assert.equal(execActions[1].nativeMemoryAutoGenerate, '1');
    assert.equal(execActions[1].effectiveMemoriesEnabled, true);
    assert.equal(execActions[1].effectiveUseMemories, true);
    assert.equal(execActions[1].effectiveGenerateMemories, true);
    assert.equal(execActions[1].effectiveDedicatedTools, true);
    return 25;
  } finally {
    await harness.close();
  }
}

async function verifyAdapterFeatureProbeRetryFlow(tempDir: string): Promise<number> {
  let assertions = 0;
  const transient = await startAdapter(
    join(tempDir, 'feature-retry'),
    true,
    false,
    undefined,
    { featureFailures: 1 }
  );
  try {
    const init = await transient.harness.request('initialize', {}, 1);
    const capability = init.result?.agentCapabilities?.nativeMemory;
    assert.equal(capability?.supported, true);
    assert.equal(capability?.enabled, true);
    assert.equal(
      readFileSync(transient.featureCounterFile!, 'utf8').trim(),
      '2',
      'one transient probe failure must be retried once and then cached'
    );
    await transient.harness.request('initialize', {}, 2);
    assert.equal(
      readFileSync(transient.featureCounterFile!, 'utf8').trim(),
      '2',
      'definitive success must remain process-cached'
    );
    assertions += 4;
  } finally {
    await transient.harness.close();
  }

  const exhausted = await startAdapter(
    join(tempDir, 'feature-unknown'),
    false,
    false,
    undefined,
    { featureFailures: 99 }
  );
  try {
    const init = await exhausted.harness.request('initialize', {}, 1);
    const capability = init.result?.agentCapabilities?.nativeMemory;
    assert.equal(Object.hasOwn(capability || {}, 'supported'), false);
    assert.equal(Object.hasOwn(capability || {}, 'enabled'), false);
    assert.match(capability?.detail || '', /无法确认/);
    assert.equal(
      readFileSync(exhausted.featureCounterFile!, 'utf8').trim(),
      String(EXPECTED_NATIVE_MEMORY_PROBE_ATTEMPTS)
    );

    const session = await exhausted.harness.request(
      'session/new',
      { cwd: tempDir },
      2
    );
    await exhausted.harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'fail-closed disabled probe' }],
      },
      3
    );
    assert.equal(
      readFileSync(exhausted.featureCounterFile!, 'utf8').trim(),
      String(EXPECTED_NATIVE_MEMORY_PROBE_ATTEMPTS * 2),
      'inconclusive probe results must not be cached across requests'
    );
    assert.equal(typeof exhausted.actionsFile, 'string');
    const execAction = readActions(exhausted.actionsFile!).find(
      (entry) => entry.args[0] === 'exec'
    );
    assert.ok(execAction?.args.includes('--disable'));
    assert.ok(execAction?.args.includes('features.memories=false'));
    assertions += 7;
  } finally {
    await exhausted.harness.close();
  }

  // When initialize exhausts its bounded retries (2 failures -> unknown), a subsequent
  // session/prompt that succeeds on attempt 3 must both activate native memory CLI flags
  // AND report the recovered agentCapabilities.nativeMemory in the prompt result so the
  // host can transition out of `unknown`.
  const recoveredOnPrompt = await startAdapter(
    join(tempDir, 'feature-recover-on-prompt'),
    true,
    false,
    undefined,
    { featureFailures: EXPECTED_NATIVE_MEMORY_PROBE_ATTEMPTS }
  );
  try {
    const init = await recoveredOnPrompt.harness.request('initialize', {}, 1);
    assert.equal(
      parseNativeMemoryCapability(init.result).status,
      'unknown',
      'initialize must report unknown when both bounded attempts fail'
    );
    const session = await recoveredOnPrompt.harness.request(
      'session/new',
      { cwd: tempDir },
      2
    );
    const promptRes = await recoveredOnPrompt.harness.request(
      'session/prompt',
      {
        sessionId: session.result?.sessionId,
        cwd: tempDir,
        prompt: [{ type: 'text', text: 'recover native memory on prompt' }],
      },
      3
    );
    const recoveredCap = parseNativeMemoryCapability(promptRes.result);
    assert.equal(recoveredCap.status, 'enabled');
    assert.equal(recoveredCap.provider, 'codex-memories');
    assert.equal(
      readFileSync(recoveredOnPrompt.featureCounterFile!, 'utf8').trim(),
      String(EXPECTED_NATIVE_MEMORY_PROBE_ATTEMPTS + 1),
      'session/prompt must succeed on the 3rd probe attempt without extra redundant probes'
    );
    const execAction = readActions(recoveredOnPrompt.actionsFile!).find(
      (entry) => entry.args[0] === 'exec'
    );
    assert.ok(execAction?.args.includes('--enable'));
    assert.ok(execAction?.args.includes('memories'));
    assertions += 6;
  } finally {
    await recoveredOnPrompt.harness.close();
  }

  return assertions;
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

  const missingEnabled = parseNativeMemoryCapability({
    agentCapabilities: {
      nativeMemory: {
        supported: true,
      },
    },
  });
  assert.equal(missingEnabled.status, 'unknown');
  const explicitDisabled = parseNativeMemoryCapability({
    agentCapabilities: {
      nativeMemory: {
        supported: true,
        enabled: false,
      },
    },
  });
  assert.equal(explicitDisabled.status, 'disabled');
  const explicitUnsupported = parseNativeMemoryCapability({
    agentCapabilities: {
      nativeMemory: {
        supported: false,
        enabled: true,
      },
    },
  });
  assert.equal(explicitUnsupported.status, 'unsupported');
  assertions += 3;

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

  // NM-09: Offline persisted v1 agent must NOT retain stale handshake capability across reload
  const staleOfflineAgent: Agent = {
    ...migrated.agent,
    status: 'idle',
    memory: {
      ...migrated.agent.memory,
      schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
      mode: 'native',
      nativeCapability: {
        status: 'enabled',
        persistent: true,
        crossThread: true,
        provider: 'codex-memories',
        scope: 'runtime',
        detail: 'stale capability from previous process',
        lastCheckedAt: 12345,
      },
    },
    capabilities: {
      ...migrated.agent.capabilities!,
      canUseInternalMemory: true,
      supportsLoadSession: true,
      supportsResumeSession: true,
      loadSession: true,
    },
  };
  const reloadedOffline = migrateAgentMemoryV1(staleOfflineAgent);
  assert.equal(reloadedOffline.changed, true);
  assert.equal(reloadedOffline.agent.memory.nativeCapability.status, 'unknown');
  assert.equal(reloadedOffline.agent.capabilities?.canUseInternalMemory, false);

  // Reloaded Agents always start without trusting a capability probed by a
  // previous process, even when the persisted runtime status says running.
  const activeOnlineAgent: Agent = {
    ...staleOfflineAgent,
    status: 'running',
    statusDetail: 'stale process status',
  };
  const reloadedOnline = normalizeHydratedAgent(activeOnlineAgent);
  assert.equal(reloadedOnline.changed, true);
  assert.equal(reloadedOnline.agent.status, 'idle');
  assert.equal(reloadedOnline.agent.statusDetail, undefined);
  assert.equal(reloadedOnline.agent.memory.nativeCapability.status, 'unknown');
  assert.equal(reloadedOnline.agent.capabilities?.canUseInternalMemory, false);
  assert.equal(reloadedOnline.agent.capabilities?.supportsLoadSession, undefined);
  assert.equal(reloadedOnline.agent.capabilities?.supportsResumeSession, undefined);
  assert.equal(reloadedOnline.agent.capabilities?.loadSession, undefined);

  // Offline agent with only stale supportsLoadSession/supportsResumeSession must also be cleaned
  const offlineWithStaleSessionCaps = normalizeHydratedAgent({
    ...INITIAL_AGENTS[0],
    status: 'idle',
    capabilities: {
      ...INITIAL_AGENTS[0].capabilities!,
      supportsLoadSession: true,
      supportsResumeSession: true,
      loadSession: true,
    },
  });
  assert.equal(offlineWithStaleSessionCaps.changed, true);
  assert.equal(
    offlineWithStaleSessionCaps.agent.capabilities?.supportsLoadSession,
    undefined
  );
  assert.equal(
    offlineWithStaleSessionCaps.agent.capabilities?.supportsResumeSession,
    undefined
  );
  assert.equal(
    offlineWithStaleSessionCaps.agent.capabilities?.loadSession,
    undefined
  );

  // INITIAL_AGENTS offline preset must not fake enabled handshake state
  assert.equal(INITIAL_AGENTS[0].status, 'idle');
  assert.equal(INITIAL_AGENTS[0].memory.nativeCapability.status, 'unknown');
  assert.equal(INITIAL_AGENTS[0].memory.autoGenerate, false);
  assert.equal(INITIAL_AGENTS[0].capabilities?.canUseInternalMemory, false);
  assert.equal(INITIAL_AGENTS[0].capabilities?.supportsLoadSession, undefined);
  assert.equal(INITIAL_AGENTS[0].capabilities?.supportsResumeSession, undefined);
  assertions += 21;

  // Behavioral state machine tests for remote Agent lifecycle:
  // 1) Start -> Stop before probe finishes -> late probe does NOT resurrect Agent to running
  const probeStore = new Map<string, {
    generation: number;
    inFlight: boolean;
    lastAttemptAt: number;
  }>();
  const baseRemoteAgent: Agent = {
    ...migrated.agent,
    id: 'remote-agent',
    isRemote: true,
    acpTransport: 'websocket',
    remoteUrl: 'ws://127.0.0.1:9000',
    status: 'idle',
  };
  let agentsState: Agent[] = [baseRemoteAgent];
  const staleGeneration = beginRemoteProbe(probeStore, 'remote-agent', 1000);
  agentsState = markRemoteAgentStarting(agentsState, 'remote-agent');
  assert.equal(agentsState[0].status, 'starting');
  assert.equal(isAgentActivelyRunning(agentsState[0], probeStore), true);

  // User clicks Stop (or Stop All) while probe is in flight
  agentsState = stopAgentRuntimeState(agentsState, probeStore, 'remote-agent');
  assert.equal(agentsState[0].status, 'idle');
  assert.equal(agentsState[0].memory.nativeCapability.status, 'unknown');
  assert.equal(agentsState[0].capabilities?.canUseInternalMemory, false);

  // Late probe arrives after stop -> must be rejected by lease & state machine
  const lateApplied = applyRemoteProbeOutcome(
    agentsState,
    probeStore,
    'remote-agent',
    staleGeneration,
    {
      ok: true,
      latencyMs: 18,
      loadSession: true,
      resumeSession: true,
      nativeMemory: {
        status: 'enabled',
        persistent: true,
        crossThread: true,
        provider: 'remote-codex',
        scope: 'runtime',
      },
    },
    true
  );
  assert.equal(lateApplied.applied, false);
  assert.equal(lateApplied.agents[0].status, 'idle');
  assert.equal(lateApplied.agents[0].memory.nativeCapability.status, 'unknown');
  assert.equal(lateApplied.agents[0].capabilities?.canUseInternalMemory, false);

  // 2) Fresh start -> probe succeeds -> transitions to running + enabled capability
  const freshGeneration = beginRemoteProbe(probeStore, 'remote-agent', 2000);
  agentsState = markRemoteAgentStarting(agentsState, 'remote-agent');
  const freshApplied = applyRemoteProbeOutcome(
    agentsState,
    probeStore,
    'remote-agent',
    freshGeneration,
    {
      ok: true,
      latencyMs: 12,
      loadSession: true,
      resumeSession: true,
      nativeMemory: {
        status: 'enabled',
        persistent: true,
        crossThread: true,
        provider: 'remote-codex',
        scope: 'runtime',
      },
    },
    true
  );
  assert.equal(freshApplied.applied, true);
  agentsState = freshApplied.agents;
  assert.equal(agentsState[0].status, 'running');
  assert.equal(agentsState[0].memory.nativeCapability.status, 'enabled');
  assert.equal(agentsState[0].capabilities?.canUseInternalMemory, true);
  assert.equal(
    shouldRefreshRemoteProbe(probeStore, 'remote-agent', 15_000, 5_000),
    false
  );
  assert.equal(
    shouldRefreshRemoteProbe(probeStore, 'remote-agent', 15_000, 17_001),
    true
  );

  // 3) Periodic 15s refresh detects remote disconnect -> transitions to error + resets capability to unknown
  const refreshGen = beginRemoteProbe(probeStore, 'remote-agent', 18_000);
  // Silent background refresh keeps status 'running' until probe finishes
  assert.equal(agentsState[0].status, 'running');
  const disconnectApplied = applyRemoteProbeOutcome(
    agentsState,
    probeStore,
    'remote-agent',
    refreshGen,
    {
      ok: false,
      latencyMs: 0,
      error: 'WebSocket connection closed (Code: 1006)',
    },
    false
  );
  assert.equal(disconnectApplied.applied, true);
  agentsState = disconnectApplied.agents;
  assert.equal(agentsState[0].status, 'error');
  assert.equal(agentsState[0].isModelHealthy, false);
  assert.equal(agentsState[0].memory.nativeCapability.status, 'unknown');
  assert.equal(agentsState[0].capabilities?.canUseInternalMemory, false);
  assert.equal(agentsState[0].capabilities?.supportsLoadSession, undefined);
  assert.equal(agentsState[0].capabilities?.supportsResumeSession, undefined);
  assert.equal(agentsState[0].capabilities?.loadSession, undefined);
  const disconnectedNativeCapability = agentsState[0].memory.nativeCapability;
  // Error state must NOT be treated as actively running by Stop All
  assert.equal(isAgentActivelyRunning(agentsState[0], probeStore), false);

  // 4) A later successful probe recovers both running state and health flag
  const recoveryGen = beginRemoteProbe(probeStore, 'remote-agent', 25_000);
  const recovered = applyRemoteProbeOutcome(
    agentsState,
    probeStore,
    'remote-agent',
    recoveryGen,
    {
      ok: true,
      latencyMs: 9,
      loadSession: true,
      resumeSession: true,
      nativeMemory: {
        status: 'enabled',
        persistent: true,
        crossThread: true,
        provider: 'remote-codex',
        scope: 'runtime',
      },
    },
    true
  );
  assert.equal(recovered.applied, true);
  agentsState = recovered.agents;
  assert.equal(agentsState[0].status, 'running');
  assert.equal(agentsState[0].isModelHealthy, true);
  assert.equal(agentsState[0].memory.nativeCapability.status, 'enabled');

  // 5) Health-only recovery must re-materialize the Agent instead of taking the
  // unchanged early return. All other fields are intentionally identical.
  const healthOnlyStale = agentsState.map((agent) => ({
    ...agent,
    isModelHealthy: false,
  }));
  const healthOnlyGeneration = beginRemoteProbe(probeStore, 'remote-agent', 28_000);
  const healthOnlyRecovered = applyRemoteProbeOutcome(
    healthOnlyStale,
    probeStore,
    'remote-agent',
    healthOnlyGeneration,
    {
      ok: true,
      latencyMs: 9,
      loadSession: true,
      resumeSession: true,
      nativeMemory: agentsState[0].memory.nativeCapability,
    },
    false
  );
  assert.equal(healthOnlyRecovered.applied, true);
  assert.notEqual(healthOnlyRecovered.agents[0], healthOnlyStale[0]);
  assert.equal(healthOnlyRecovered.agents[0].isModelHealthy, true);

  // 6) Edit-save fresh probe records timestamp so 5s poll does not immediately re-probe
  recordRemoteProbeSuccess(probeStore, 'remote-agent', 30_000);
  assert.equal(
    shouldRefreshRemoteProbe(probeStore, 'remote-agent', 15_000, 40_000),
    false
  );
  assert.equal(
    nativeMemoryCapabilityChanged(
      disconnectedNativeCapability,
      freshApplied.agents[0].memory.nativeCapability
    ),
    true
  );
  assertions += 34;

  // 7) Local process exit (`acp:status_change` -> `stopped`) and 3s poll reconciliation:
  //    Verify that stopping/exiting immediately clears `nativeCapability` and `canUseInternalMemory`,
  //    and even if `status` was already `'idle'`, `reconcileLocalAgentsRuntimeStatus` cleans up
  //    any residual `enabled` capability.
  const runningLocalAgent: Agent = {
    ...migrated.agent,
    id: 'local-codex',
    isRemote: false,
    acpTransport: 'stdio',
    status: 'running',
    memory: {
      ...migrated.agent.memory,
      mode: 'native',
      nativeCapability: {
        status: 'enabled',
        persistent: true,
        crossThread: true,
        provider: 'codex-memories',
        scope: 'runtime',
      },
    },
    capabilities: {
      ...migrated.agent.capabilities!,
      canUseInternalMemory: true,
    },
  };
  const afterStoppedEvent = applyLocalStatusChangeEvent([runningLocalAgent], {
    agent_id: 'local-codex',
    status: 'stopped',
  });
  assert.equal(afterStoppedEvent[0].status, 'idle');
  assert.equal(afterStoppedEvent[0].memory.nativeCapability.status, 'unknown');
  assert.equal(afterStoppedEvent[0].capabilities?.canUseInternalMemory, false);
  assert.equal(afterStoppedEvent[0].capabilities?.supportsLoadSession, undefined);
  assert.equal(
    afterStoppedEvent[0].capabilities?.supportsResumeSession,
    undefined
  );
  assert.equal(afterStoppedEvent[0].capabilities?.loadSession, undefined);

  const idleWithStaleCap: Agent = {
    ...runningLocalAgent,
    status: 'idle',
  };
  const reconciledIdle = reconcileLocalAgentsRuntimeStatus([idleWithStaleCap], []);
  assert.equal(reconciledIdle.changed, true);
  assert.equal(reconciledIdle.agents[0].status, 'idle');
  assert.equal(reconciledIdle.agents[0].memory.nativeCapability.status, 'unknown');
  assert.equal(reconciledIdle.agents[0].capabilities?.canUseInternalMemory, false);

  // A fresh start invalidates all previous initialize-derived capabilities.
  const staleRemoteForStart: Agent = {
    ...runningLocalAgent,
    id: 'remote-start-invalidates',
    isRemote: true,
    acpTransport: 'websocket',
    capabilities: {
      ...runningLocalAgent.capabilities!,
      supportsLoadSession: true,
      supportsResumeSession: true,
    },
  };
  const markedRemoteStarting = markRemoteAgentStarting(
    [staleRemoteForStart],
    staleRemoteForStart.id
  );
  assert.equal(markedRemoteStarting[0].status, 'starting');
  assert.equal(markedRemoteStarting[0].memory.nativeCapability.status, 'unknown');
  assert.equal(markedRemoteStarting[0].capabilities?.canUseInternalMemory, false);
  assert.equal(markedRemoteStarting[0].capabilities?.supportsLoadSession, undefined);
  assert.equal(
    markedRemoteStarting[0].capabilities?.supportsResumeSession,
    undefined
  );
  assert.equal(markedRemoteStarting[0].capabilities?.loadSession, undefined);

  // Normal polling preserves an in-flight starting state, while explicit post-spawn
  // reconciliation must settle a starting Agent whose backend process is gone.
  const staleStartingAgent: Agent = {
    ...runningLocalAgent,
    status: 'starting',
  };
  const stillStarting = reconcileLocalAgentsRuntimeStatus(
    [staleStartingAgent],
    []
  );
  assert.equal(stillStarting.changed, false);
  assert.equal(stillStarting.agents[0].status, 'starting');
  const settledStarting = reconcileLocalAgentsRuntimeStatus(
    [staleStartingAgent],
    [],
    { settleUnmatchedStarting: true }
  );
  assert.equal(settledStarting.changed, true);
  assert.equal(settledStarting.agents[0].status, 'idle');
  assert.equal(settledStarting.agents[0].memory.nativeCapability.status, 'unknown');
  assert.equal(
    settledStarting.agents[0].capabilities?.canUseInternalMemory,
    false
  );

  // 8) Modal save capability state resolution (`resolveSavedAgentNativeMemoryState`):
  //    - New/offline remote Agent must NOT save `enabled` capability while `idle`.
  //    - Online remote Agent whose save-time `healthCheck` fails (`ok: false`) must reset to `unknown`.
  //    - Online local Agent on save resets to `unknown` pending respawn handshake.
  //    - Online remote Agent with `healthCheck.ok === true` preserves probed `enabled` capability.
  const enabledCap = runningLocalAgent.memory.nativeCapability;
  const savedNewRemote = resolveSavedAgentNativeMemoryState({
    isEditMode: false,
    isRemoteMode: true,
    wasOnline: false,
    nativeMemoryEnabled: true,
    nativeMemoryAutoGenerate: false,
    healthCheck: null,
  });
  assert.equal(savedNewRemote.nativeCapability.status, 'unknown');
  assert.equal(savedNewRemote.canUseInternalMemory, false);

  const savedFailedOnlineRemote = resolveSavedAgentNativeMemoryState({
    isEditMode: true,
    isRemoteMode: true,
    wasOnline: true,
    nativeMemoryEnabled: true,
    nativeMemoryAutoGenerate: false,
    healthCheck: { ok: false },
  });
  assert.equal(savedFailedOnlineRemote.nativeCapability.status, 'unknown');
  assert.equal(savedFailedOnlineRemote.canUseInternalMemory, false);

  const savedOnlineLocal = resolveSavedAgentNativeMemoryState({
    isEditMode: true,
    isRemoteMode: false,
    wasOnline: true,
    nativeMemoryEnabled: true,
    nativeMemoryAutoGenerate: false,
    healthCheck: null,
  });
  assert.equal(savedOnlineLocal.nativeCapability.status, 'unknown');
  assert.equal(savedOnlineLocal.canUseInternalMemory, false);

  const savedHealthyOnlineRemote = resolveSavedAgentNativeMemoryState({
    isEditMode: true,
    isRemoteMode: true,
    wasOnline: true,
    nativeMemoryEnabled: true,
    nativeMemoryAutoGenerate: true,
    healthCheck: {
      ok: true,
      loadSession: true,
      resumeSession: true,
      nativeMemory: enabledCap,
    },
  });
  assert.equal(savedHealthyOnlineRemote.status, 'running');
  assert.equal(savedHealthyOnlineRemote.nativeCapability.status, 'enabled');
  assert.equal(savedHealthyOnlineRemote.canUseInternalMemory, true);
  assert.equal(savedHealthyOnlineRemote.autoGenerate, true);
  assert.equal(savedHealthyOnlineRemote.supportsLoadSession, true);
  assert.equal(savedHealthyOnlineRemote.supportsResumeSession, true);
  assert.equal(savedNewRemote.status, 'idle');
  assert.equal(savedNewRemote.supportsLoadSession, undefined);
  assert.equal(savedNewRemote.supportsResumeSession, undefined);
  assert.equal(savedFailedOnlineRemote.status, 'error');
  assert.equal(savedFailedOnlineRemote.supportsLoadSession, undefined);
  assert.equal(savedFailedOnlineRemote.supportsResumeSession, undefined);
  assert.equal(savedOnlineLocal.status, 'idle');
  assert.equal(savedOnlineLocal.supportsLoadSession, undefined);
  assert.equal(savedOnlineLocal.supportsResumeSession, undefined);

  // 9) Local spawn generation lease prevents a cancelled in-flight spawn from
  //    overwriting a stopped idle Agent with error or stale running state.
  const localSpawnStore = new Map<string, number>();
  const spawnGen1 = beginLocalSpawn(localSpawnStore, 'local-codex');
  assert.equal(completeLocalSpawn(localSpawnStore, 'local-codex', spawnGen1), true);
  const stoppedLocal = stopAgentRuntimeState(
    [{ ...runningLocalAgent, status: 'starting' }],
    probeStore,
    'local-codex',
    localSpawnStore
  );
  assert.equal(stoppedLocal[0].status, 'idle');
  assert.equal(
    completeLocalSpawn(localSpawnStore, 'local-codex', spawnGen1),
    false,
    'stopAgentRuntimeState must invalidate any in-flight local spawn generation'
  );
  const spawnGen2 = beginLocalSpawn(localSpawnStore, 'local-codex');
  const cancelledSpawnGen = cancelLocalSpawn(localSpawnStore, 'local-codex');
  assert.equal(completeLocalSpawn(localSpawnStore, 'local-codex', spawnGen2), false);
  assert.equal(
    isCurrentLocalSpawnGeneration(
      localSpawnStore,
      'local-codex',
      cancelledSpawnGen
    ),
    true
  );

  const supersededSpawn = beginLocalSpawn(localSpawnStore, 'local-codex');
  assert.equal(
    isCurrentLocalSpawnGeneration(
      localSpawnStore,
      'local-codex',
      cancelledSpawnGen
    ),
    false
  );
  const newerSpawn = beginLocalSpawn(localSpawnStore, 'local-codex');
  assert.equal(
    completeLocalSpawn(localSpawnStore, 'local-codex', supersededSpawn),
    false
  );
  cancelLocalSpawn(localSpawnStore, 'local-codex');
  assert.equal(
    isCurrentLocalSpawnGeneration(localSpawnStore, 'local-codex', newerSpawn),
    false
  );
  assert.equal(shouldStopLocalAgentProcess(runningLocalAgent), true);
  assert.equal(shouldStopLocalAgentProcess(staleRemoteForStart), false);

  // 10) Prompt-level nativeMemory capability recovery updates running remote Agent
  //     while ignoring idle/stopped Agents.
  const remoteUnknownRunning: Agent = {
    ...baseRemoteAgent,
    status: 'running',
    memory: createAgentMemoryBank('native', false),
  };
  const updatedFromPrompt = applyPromptNativeMemoryCapability(
    [remoteUnknownRunning],
    'remote-agent',
    enabledCap
  );
  assert.equal(updatedFromPrompt[0].memory.nativeCapability.status, 'enabled');
  assert.equal(updatedFromPrompt[0].capabilities?.canUseInternalMemory, true);
  const promptSourceAgent: Agent = {
    ...remoteUnknownRunning,
    status: 'thinking',
    remoteUrl: 'ws://127.0.0.1:9100/old',
  };
  const appliedForSameSource = applyPromptNativeMemoryCapability(
    [
      {
        ...remoteUnknownRunning,
        remoteUrl: promptSourceAgent.remoteUrl,
      },
    ],
    'remote-agent',
    enabledCap,
    promptSourceAgent
  );
  assert.equal(appliedForSameSource[0].memory.nativeCapability.status, 'enabled');
  assert.equal(appliedForSameSource[0].capabilities?.canUseInternalMemory, true);

  const ignoredForChangedEndpoint = applyPromptNativeMemoryCapability(
    [
      {
        ...remoteUnknownRunning,
        remoteUrl: 'ws://127.0.0.1:9100/new',
      },
    ],
    'remote-agent',
    enabledCap,
    promptSourceAgent
  );
  assert.equal(
    ignoredForChangedEndpoint[0].memory.nativeCapability.status,
    'unknown'
  );
  assert.equal(
    ignoredForChangedEndpoint[0].capabilities?.canUseInternalMemory,
    false
  );

  const ignoredForPolicyChange = applyPromptNativeMemoryCapability(
    [
      {
        ...remoteUnknownRunning,
        remoteUrl: promptSourceAgent.remoteUrl,
        memory: createAgentMemoryBank('disabled', false),
      },
    ],
    'remote-agent',
    enabledCap,
    promptSourceAgent
  );
  assert.equal(
    ignoredForPolicyChange[0].memory.nativeCapability.status,
    'unknown'
  );
  assert.equal(ignoredForPolicyChange[0].capabilities?.canUseInternalMemory, false);
  const localPromptSource: Agent = {
    ...runningLocalAgent,
    id: 'remote-agent',
    status: 'thinking',
  };
  const ignoredAfterLocalToRemote = applyPromptNativeMemoryCapability(
    [
      {
        ...remoteUnknownRunning,
        remoteUrl: 'ws://127.0.0.1:9100/new',
      },
    ],
    'remote-agent',
    enabledCap,
    localPromptSource
  );
  assert.equal(
    ignoredAfterLocalToRemote[0].memory.nativeCapability.status,
    'unknown'
  );
  assert.equal(
    ignoredAfterLocalToRemote[0].capabilities?.canUseInternalMemory,
    false
  );
  const ignoredForIdle = applyPromptNativeMemoryCapability(
    [{ ...remoteUnknownRunning, status: 'idle' }],
    'remote-agent',
    enabledCap
  );
  assert.equal(ignoredForIdle[0].memory.nativeCapability.status, 'unknown');
  assert.equal(ignoredForIdle[0].capabilities?.canUseInternalMemory, false);
  const ignoredForStarting = applyPromptNativeMemoryCapability(
    [{ ...remoteUnknownRunning, status: 'starting' }],
    'remote-agent',
    enabledCap,
    promptSourceAgent
  );
  assert.equal(ignoredForStarting[0].status, 'starting');
  assert.equal(
    ignoredForStarting[0].memory.nativeCapability.status,
    'unknown'
  );
  assertions += 65;

  return assertions;
}

async function verifyRemoteWebSocketAndUiContracts(): Promise<number> {
  let assertions = 0;
  const originalWebSocket = (globalThis as any).WebSocket;
  const sentMessages: any[] = [];
  let responder: ((payload: any, ws: any) => void) | null = null;

  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((evt: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      queueMicrotask(() => {
        this.onopen?.();
      });
    }

    send(raw: string) {
      const parsed = JSON.parse(raw);
      sentMessages.push(parsed);
      queueMicrotask(() => {
        responder?.(parsed, this);
      });
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  (globalThis as any).WebSocket = MockWebSocket;
  try {
    sentMessages.length = 0;
    responder = (payload, ws) => {
      if (payload.method === 'initialize') {
        ws.onmessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              agentCapabilities: {
                loadSession: true,
                nativeMemory: {
                  supported: true,
                  enabled: false,
                  persistent: true,
                  crossThread: true,
                  provider: 'remote-codex',
                  scope: 'runtime',
                },
              },
              sessionCapabilities: {
                resume: {},
              },
            },
          }),
        });
      }
    };

    const probeDisabled = await probeRemoteAcpConnection(
      'ws://127.0.0.1:9000',
      'token-1',
      2000,
      { enabled: false, autoGenerate: true }
    );
    assert.equal(probeDisabled.ok, true);
    assert.equal(probeDisabled.loadSession, true);
    assert.equal(probeDisabled.resumeSession, true);
    assert.equal(probeDisabled.nativeMemory?.status, 'disabled');
    assert.deepEqual(sentMessages[0]?.params?._meta?.shadowCrew?.nativeMemory, {
      enabled: false,
      autoGenerate: false,
    });
    assertions += 5;

    // Fail-closed when initialize returns JSON-RPC error
    sentMessages.length = 0;
    responder = (payload, ws) => {
      ws.onmessage?.({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32000, message: 'Unauthorized handshake' },
        }),
      });
    };
    const probeError = await probeRemoteAcpConnection('ws://127.0.0.1:9000');
    assert.equal(probeError.ok, false);
    assert.match(probeError.error || '', /Unauthorized handshake/);
    assertions += 2;

    // sendPromptToRemoteAcpWebSocket gates autoGenerate with nativeMemoryEnabled
    sentMessages.length = 0;
    responder = (payload, ws) => {
      if (payload.method === 'initialize') {
        ws.onmessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: { agentCapabilities: {} },
          }),
        });
      } else if (payload.method === 'session/new') {
        ws.onmessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: { sessionId: 'remote-sess-1' },
          }),
        });
      } else if (payload.method === 'session/prompt') {
        ws.onmessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              text_response: 'REMOTE_OK',
              agentCapabilities: {
                nativeMemory: {
                  supported: true,
                  enabled: true,
                  persistent: true,
                  crossThread: true,
                  provider: 'remote-codex',
                  scope: 'runtime',
                },
              },
            },
          }),
        });
      }
    };
    let callbackAgentId = '';
    let callbackStatus = '';
    setOnAcpNativeMemoryCapabilityUpdated((agentId, cap) => {
      callbackAgentId = agentId;
      callbackStatus = cap.status;
    });
    const promptRes = await sendPromptToAcpAgent({
      agent: {
        ...INITIAL_AGENTS[0],
        id: 'remote-prompt-recover',
        isRemote: true,
        acpTransport: 'websocket',
        remoteUrl: 'ws://127.0.0.1:9000',
        status: 'running',
        memory: createAgentMemoryBank('disabled', true),
      },
      roomId: 'thread-remote-test',
      prompt: 'hello',
      systemPrompt: 'system',
    });
    setOnAcpNativeMemoryCapabilityUpdated(null);
    assert.equal(promptRes.textResponse, 'REMOTE_OK');
    assert.equal(promptRes.nativeMemoryCapability?.status, 'enabled');
    assert.equal(callbackAgentId, 'remote-prompt-recover');
    assert.equal(callbackStatus, 'enabled');
    const promptRpc = sentMessages.find((m) => m.method === 'session/prompt');
    assert.deepEqual(promptRpc?.params?._meta?.shadowCrew?.nativeMemory, {
      enabled: false,
      autoGenerate: false,
    });
    assertions += 5;
  } finally {
    (globalThis as any).WebSocket = originalWebSocket;
  }

  // Behavioral React SSR UI Rendering Verification (<AcpInspector /> & <ConnectAgentModal />)
  const baseAgent: Agent = {
    ...INITIAL_AGENTS[0],
    status: 'running',
  };
  const statusMatrix: Array<{
    status: Agent['memory']['nativeCapability']['status'];
    expectedRustTabBadge: string;
    expectedMemoryTabBadge: string;
    persistent?: boolean;
    crossThread?: boolean;
    expectedPersistenceText: string;
  }> = [
    {
      status: 'enabled',
      expectedRustTabBadge: '已启用 ✓',
      expectedMemoryTabBadge: '>enabled<',
      persistent: true,
      crossThread: true,
      expectedPersistenceText: 'YES / YES',
    },
    {
      status: 'disabled',
      expectedRustTabBadge: '已关闭',
      expectedMemoryTabBadge: '>disabled<',
      persistent: false,
      crossThread: false,
      expectedPersistenceText: 'NO / NO',
    },
    {
      status: 'unsupported',
      expectedRustTabBadge: '不支持 ✕',
      expectedMemoryTabBadge: '>unsupported<',
      expectedPersistenceText: 'UNKNOWN / UNKNOWN',
    },
    {
      status: 'unknown',
      expectedRustTabBadge: '待握手 ⚠️',
      expectedMemoryTabBadge: '>unknown<',
      expectedPersistenceText: 'UNKNOWN / UNKNOWN',
    },
  ];

  for (const item of statusMatrix) {
    const agentVariant: Agent = {
      ...baseAgent,
      memory: {
        ...baseAgent.memory,
        mode: item.status === 'disabled' ? 'disabled' : 'native',
        nativeCapability: {
          status: item.status,
          persistent: item.persistent,
          crossThread: item.crossThread,
          provider: 'codex-memories',
          scope: 'runtime',
        },
      },
    };
    const rustTabHtml = renderToStaticMarkup(
      React.createElement(AcpInspector, {
        selectedAgent: agentVariant,
        rpcLogs: [],
        workspaceFiles: [],
        initialTab: 'rust_tauri',
        onRunAgentSkill: () => {},
        onClose: () => {},
      })
    );
    assert.ok(rustTabHtml.includes('agentCapabilities.nativeMemory'));
    assert.ok(rustTabHtml.includes(item.expectedRustTabBadge));

    const memoryTabHtml = renderToStaticMarkup(
      React.createElement(AcpInspector, {
        selectedAgent: agentVariant,
        rpcLogs: [],
        workspaceFiles: [],
        initialTab: 'memory',
        onRunAgentSkill: () => {},
        onClose: () => {},
      })
    );
    assert.ok(memoryTabHtml.includes(item.expectedMemoryTabBadge));
    assert.ok(memoryTabHtml.includes(item.expectedPersistenceText));
    assertions += 4;
  }

  // Render <ConnectAgentModal /> across remote nativeMemory states (enabled / disabled / unsupported / unknown)
  const remoteAgent: Agent = {
    ...baseAgent,
    isRemote: true,
    acpTransport: 'websocket',
    remoteUrl: 'ws://127.0.0.1:9000',
    memory: createAgentMemoryBank('disabled', false),
  };
  const modalDisabledHtml = renderToStaticMarkup(
    React.createElement(ConnectAgentModal, {
      isOpen: true,
      onClose: () => {},
      onConnectAgent: () => {},
      initialAgent: remoteAgent,
      initialRemoteTestResult: {
        ok: true,
        latencyMs: 14,
        loadSession: true,
        resumeSession: true,
        nativeMemory: {
          status: 'disabled',
          persistent: true,
          crossThread: true,
          provider: 'remote-codex',
          scope: 'runtime',
        },
      },
    })
  );
  assert.ok(modalDisabledHtml.includes('data-theme="light"'));
  assert.ok(modalDisabledHtml.includes('已声明 (已关闭)'));
  assert.ok(modalDisabledHtml.includes('启用 ACP 端点原生长期记忆'));
  assert.ok(modalDisabledHtml.includes('已关闭原生记忆请求'));
  // When nativeMemoryEnabled is false (mode === 'disabled'), the autoGenerate sub-checkbox is hidden
  assert.equal(modalDisabledHtml.includes('允许自动提炼历史对话'), false);

  const modalEnabledHtml = renderToStaticMarkup(
    React.createElement(ConnectAgentModal, {
      isOpen: true,
      onClose: () => {},
      onConnectAgent: () => {},
      initialAgent: {
        ...remoteAgent,
        memory: createAgentMemoryBank('native', true),
      },
      initialRemoteTestResult: {
        ok: true,
        latencyMs: 11,
        loadSession: true,
        resumeSession: true,
        nativeMemory: {
          status: 'enabled',
          persistent: true,
          crossThread: true,
          provider: 'remote-codex',
          scope: 'runtime',
        },
      },
    })
  );
  assert.ok(modalEnabledHtml.includes('已声明 ✓'));
  assert.ok(modalEnabledHtml.includes('允许自动提炼历史对话'));
  assertions += 7;

  const modalDisabledDarkHtml = renderToStaticMarkup(
    React.createElement(ConnectAgentModal, {
      isOpen: true,
      onClose: () => {},
      onConnectAgent: () => {},
      initialAgent: remoteAgent,
      initialThemeMode: 'dark',
      initialRemoteTestResult: {
        ok: true,
        latencyMs: 14,
        loadSession: true,
        resumeSession: true,
        nativeMemory: {
          status: 'disabled',
          persistent: true,
          crossThread: true,
          provider: 'remote-codex',
          scope: 'runtime',
        },
      },
    })
  );
  assert.ok(modalDisabledDarkHtml.includes('data-theme="dark"'));
  assert.ok(modalDisabledDarkHtml.includes('bg-[#0f141f]'));
  assert.ok(modalDisabledDarkHtml.includes('bg-emerald-500/15'));
  assert.ok(modalDisabledDarkHtml.includes('bg-amber-500/15'));
  assert.ok(modalDisabledDarkHtml.includes('text-amber-300'));
  assert.ok(modalDisabledDarkHtml.includes('text-slate-50'));
  assert.equal(modalDisabledDarkHtml.includes('data-theme="light"'), false);

  // Verify that while an Agent is in `starting` or `error` (where handshake capabilities
  // are cleared), neither <AgentDashboard /> nor <AcpInspector /> misreports session recovery
  // as "仅单次 ⚠️" / "未实现" or fabricates an initialize response before handshake completes.
  const startingAgent: Agent = {
    ...INITIAL_AGENTS[0],
    status: 'starting',
    statusDetail: 'ACP 进程启动与协议握手中...',
  };
  const dashboardStartingHtml = renderToStaticMarkup(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(AgentDashboard, {
        agents: [startingAgent],
        teams: [],
        channels: [],
        onOpenConnectAgentModal: () => {},
        onDuplicateAgent: () => {},
        onOpenCreateTeamModal: () => {},
        onOpenAgentDefaultsModal: () => {},
        onOpenPermissionCenter: () => {},
        onEditAgent: () => {},
        onToggleAgentStatus: () => {},
        onLaunchTeamThread: () => {},
        onStart1on1Chat: () => {},
        onInspectAgent: () => {},
        onDeleteAgent: () => {},
        onDeleteTeam: () => {},
      })
    )
  );
  assert.ok(dashboardStartingHtml.includes('待握手'));
  assert.equal(dashboardStartingHtml.includes('仅单次 ⚠️'), false);

  const inspectorStartingHtml = renderToStaticMarkup(
    React.createElement(AcpInspector, {
      selectedAgent: startingAgent,
      rpcLogs: [],
      workspaceFiles: [],
      initialTab: 'rust_tauri',
      onRunAgentSkill: () => {},
      onClose: () => {},
    })
  );
  assert.ok(inspectorStartingHtml.includes('recovery: pending'));
  assert.equal(inspectorStartingHtml.includes('未实现'), false);
  assert.equal(inspectorStartingHtml.includes('"id": 101'), false);
  assertions += 12;

  return assertions;
}

async function verifyRealCodexFlow(tempDir: string): Promise<number> {
  const realHome = join(tempDir, 'real-codex-home');
  const canaryKey = 'ACP_NATIVE_MEMORY_CANARY_20261102';
  const canaryValue = 'ORBIT-7742-LYNX';
  const logStage = (stage: string) => {
    if (process.env.SHADOW_CREW_TEST_VERBOSE === '1') {
      console.log(`[acp-native-memory-real] ${stage}`);
    }
  };

  logStage('source: initialize');
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
    logStage('source: write native memory');
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

  logStage('recall: initialize');
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
    logStage('recall: prompt');
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
  } finally {
    await recallAdapter.harness.close();
  }

  // Verify that even when user's CODEX_HOME/config.toml explicitly enables `[features] memories = true`
  // and `memories_v2` already stores the canary on disk, Shadow Crew's `disabled` mode overrides
  // Codex CLI configuration and prevents native memory recall.
  const realConfigPath = join(realHome, 'config.toml');
  const existingConfig = existsSync(realConfigPath)
    ? readFileSync(realConfigPath, 'utf8')
    : '';
  let mergedConfig = upsertTomlSectionValue(
    existingConfig,
    'features',
    'memories',
    'true'
  );
  mergedConfig = upsertTomlSectionValue(
    mergedConfig,
    'memories',
    'use_memories',
    'true'
  );
  mergedConfig = upsertTomlSectionValue(
    mergedConfig,
    'memories',
    'dedicated_tools',
    'true'
  );
  writeFileSync(
    realConfigPath,
    mergedConfig,
    'utf8'
  );

  logStage('disabled: initialize');
  const disabledAdapter = await startAdapter(
    join(tempDir, 'real-disabled'),
    false,
    false,
    realHome
  );
  try {
    const initDisabled = await disabledAdapter.harness.request('initialize', {}, 1);
    assert.equal(
      initDisabled.result?.agentCapabilities?.nativeMemory?.supported,
      true,
      JSON.stringify(initDisabled.result?.agentCapabilities?.nativeMemory)
    );
    assert.equal(
      initDisabled.result?.agentCapabilities?.nativeMemory?.enabled,
      false,
      JSON.stringify(initDisabled.result?.agentCapabilities?.nativeMemory)
    );
    const session = await disabledAdapter.harness.request(
      'session/new',
      { cwd: tempDir, systemPrompt: '' },
      2
    );
    logStage('disabled: prompt');
    const disabledRecall = await disabledAdapter.harness.request(
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
    const disabledResponse = disabledRecall.result?.text_response || '';
    assert.doesNotMatch(disabledResponse, /Codex 执行退出|failed to load|TOML parse error/i);
    assert.equal(
      disabledResponse.includes(canaryValue),
      false,
      `Expected disabled native memory not to recall ${canaryValue}, got: ${disabledResponse}`
    );
    return 10;
  } finally {
    await disabledAdapter.harness.close();
  }
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'shadow-crew-native-memory-'));
  let assertions = 0;
  try {
    assertions += verifyTypeContracts();
    assertions += await verifyRemoteWebSocketAndUiContracts();
    assertions += await verifyAdapterEnabledFlow(join(tempDir, 'enabled'));
    assertions += await verifyAdapterDisabledFlow(join(tempDir, 'disabled'));
    assertions += await verifyAdapterAutoGenerateFlow(join(tempDir, 'auto'));
    assertions += await verifyAdapterMetaPolicyOverrideFlow(join(tempDir, 'meta'));
    assertions += await verifyAdapterFeatureProbeRetryFlow(join(tempDir, 'feature-probe'));
    if (
      process.env.SHADOW_CREW_REAL_NATIVE_MEMORY_TEST === '1' ||
      process.argv.includes('--real')
    ) {
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
