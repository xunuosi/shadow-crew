import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_AGENTS } from '../data/mockData';
import { FALLBACK_PRESET_RUNTIMES } from './acpDiscovery';
import { buildAgentLaunchEnv, sendPromptToAcpAgent } from './acpClient';
import { getGlobalModelConfig } from './llmService';

assert(
  INITIAL_AGENTS.every(
    (agent) =>
      !String(agent.acpCommandOrUrl || '').includes('shadow-crew-agent') &&
      !String(agent.acpCommandOrUrl || '').includes('shinobi-agent')
  ),
  '内置 Shadow Crew Agent 不得出现在默认 Agent 列表中'
);

assert.equal(
  existsSync('crates/shadow-crew-agent'),
  false,
  '内置 Agent crate 必须从工作区物理移除'
);

assert(
  FALLBACK_PRESET_RUNTIMES.every((runtime) => runtime.id !== 'shinobi_core'),
  'ACP 预设中不得再暴露内置 Agent'
);

const viteConfigSource = readFileSync('vite.config.ts', 'utf8');
assert(
  !viteConfigSource.includes('shadow-crew-agent') &&
    !viteConfigSource.includes('shinobi_core'),
  'Vite 开发态 ACP 发现接口不得重新注入内置 Agent 预设'
);

const acpClientSource = readFileSync('src/services/acpClient.ts', 'utf8');
assert(
  !acpClientSource.includes('callLlmModel'),
  'ACP 客户端源码不得包含直连大模型 fallback'
);

const fakeAgent = {
  ...INITIAL_AGENTS[0],
  id: 'agent-no-transport',
  name: 'No Transport ACP',
  acpCommandOrUrl: undefined,
  status: 'running' as const,
};

const response = await sendPromptToAcpAgent({
  agent: fakeAgent,
  roomId: 'thread-1',
  channelId: undefined,
  prompt: 'hello',
  scopeType: 'dm',
});

assert.equal(response.isError, true);
assert(
  response.textResponse.includes('未提供 ACP 调用通道'),
  '缺少 ACP 时必须显式失败，禁止回退到直连 LLM 或模拟回答'
);

const launchEnv = buildAgentLaunchEnv({
  ...fakeAgent,
  modelConfig: {
    provider: 'openai_compatible',
    modelId: 'must-not-be-injected',
    apiKey: 'must-not-be-injected',
    baseUrl: 'https://must-not-be-injected.invalid',
  },
  envVars: [{ key: 'ACP_USER_ENV', value: 'kept' }],
});
assert.deepEqual(
  launchEnv,
  [{ key: 'ACP_USER_ENV', value: 'kept' }],
  'Agent 启动环境不得由平台注入模型参数，只保留用户显式配置的 ACP 环境变量'
);

assert(getGlobalModelConfig().modelId, '应用内全局模型配置必须保留');

console.log('ACP-only runtime regression suite passed.');
