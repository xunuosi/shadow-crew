import { Agent, AgentModelConfig, ModelProviderType } from '../types';

export interface ProviderPreset {
  id: string;
  name: string;
  provider: ModelProviderType;
  defaultBaseUrl: string;
  models: Array<{ id: string; name: string; label: string; description?: string }>;
  apiKeyPlaceholder: string;
  apiKeyHelpUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    provider: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        label: 'DeepSeek V3 (通用全栈推理 · 推荐)',
        description: '高性价比架构推演与代码执行大模型',
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        label: 'DeepSeek R1 (深度思考与数学论证)',
        description: '复杂算法逻辑与边界反例深度剖析',
      },
    ],
    apiKeyPlaceholder: 'sk-... (来自 platform.deepseek.com)',
    apiKeyHelpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    provider: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        label: 'Claude 3.7 Sonnet (旗舰混合推理)',
        description: 'Anthropic 旗舰代码架构推演与混合推理',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        label: 'Claude 3.5 Sonnet (经典代码专家)',
        description: '稳定高效的工程实现',
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        label: 'Claude 3.5 Haiku (轻量毫秒极速)',
        description: '快速语法分析与小任务',
      },
    ],
    apiKeyPlaceholder: 'sk-ant-api03-...',
    apiKeyHelpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        label: 'GPT-4o (全能多模态旗舰)',
        description: 'OpenAI 综合多模态旗舰模型',
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        label: 'GPT-4o Mini (极速轻量低延迟)',
        description: '轻量快速响应',
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        label: 'o3-mini (深度逻辑推理)',
        description: 'STEM 与代码逻辑深度优化',
      },
    ],
    apiKeyPlaceholder: 'sk-proj-...',
    apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (本地私密引擎)',
    provider: 'ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: [
      {
        id: 'llama3.3',
        name: 'Llama 3.3',
        label: 'Llama 3.3 (本地离线私密)',
        description: '代码与知识零出境',
      },
      {
        id: 'qwen2.5-coder:32b',
        name: 'Qwen 2.5 Coder 32B',
        label: 'Qwen 2.5 Coder (本地代码专家)',
        description: '通义千问专业代码大模型',
      },
      {
        id: 'deepseek-r1:14b',
        name: 'DeepSeek R1 (本地版)',
        label: 'DeepSeek R1 (本地蒸馏推理)',
        description: '本地运行 R1 思考链',
      },
    ],
    apiKeyPlaceholder: '本地部署无需 Key (免密)',
    apiKeyHelpUrl: 'https://ollama.com',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      {
        id: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3 (硅基)',
        label: 'DeepSeek-V3 (国内高速直连)',
        description: '高并发托管 DeepSeek-V3',
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1 (硅基)',
        label: 'DeepSeek-R1 (国内高速推理)',
        description: '深度推理模型托管版',
      },
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        name: 'Qwen 2.5 Coder 32B',
        label: 'Qwen2.5-Coder-32B (硅基)',
        description: '代码构建与分析专家',
      },
    ],
    apiKeyPlaceholder: 'sk-... (来自 siliconflow.cn)',
    apiKeyHelpUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口 (Custom Proxy/Relay)',
    provider: 'custom',
    defaultBaseUrl: 'https://api.your-proxy.com/v1',
    models: [
      {
        id: 'custom-model',
        name: '自定义模型',
        label: '自定义模型标识 (如 qwen-plus, claude-proxy 等)',
        description: '适用于 OneAPI, NewAPI, vLLM 或私有中转网关',
      },
    ],
    apiKeyPlaceholder: 'sk-...',
  },
];

export const GLOBAL_MODEL_CONFIG_STORAGE_KEY = 'shinobi_global_model_config';

export const DEFAULT_GLOBAL_MODEL_CONFIG: AgentModelConfig = {
  provider: 'deepseek',
  modelId: 'deepseek-chat',
  modelName: 'DeepSeek V3',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 4096,
  useGlobalDefault: false,
};

/**
 * 读取全局默认模型配置
 */
export function getGlobalModelConfig(): AgentModelConfig {
  if (typeof window === 'undefined') return DEFAULT_GLOBAL_MODEL_CONFIG;
  try {
    const raw = localStorage.getItem(GLOBAL_MODEL_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_GLOBAL_MODEL_CONFIG, ...parsed };
    }
  } catch (e) {
    console.warn('[llmService] Failed to read global model config:', e);
  }
  return DEFAULT_GLOBAL_MODEL_CONFIG;
}

/**
 * 保存全局默认模型配置
 */
export function setGlobalModelConfig(config: AgentModelConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GLOBAL_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('shinobi_global_model_updated', { detail: config }));
  } catch (e) {
    console.warn('[llmService] Failed to write global model config:', e);
  }
}

/**
 * 智能解析特定 Agent 的最终生效模型配置
 * 遵循策略：Agent 私有自定义 > 全局默认配置 > 检查 Agent 环境变量补齐 API Key
 */
export function resolveAgentModelConfig(agent: Agent): AgentModelConfig {
  const globalConfig = getGlobalModelConfig();

  // 1. 如果 Agent 显式配置了独立的私有模型，且没有勾选使用全局默认
  if (agent.modelConfig && !agent.modelConfig.useGlobalDefault && agent.modelConfig.modelId) {
    const cfg = { ...agent.modelConfig };
    // 如果没有独立填 API Key，尝试从 envVars 中寻找
    if (!cfg.apiKey && agent.envVars) {
      const foundKey = agent.envVars.find(
        (v) =>
          v.key === 'DEEPSEEK_API_KEY' ||
          v.key === 'OPENAI_API_KEY' ||
          v.key === 'ANTHROPIC_API_KEY' ||
          v.key.endsWith('_API_KEY')
      );
      if (foundKey && foundKey.value) {
        cfg.apiKey = foundKey.value;
      }
    }
    // 依然没有则回退复用全局 Key（若厂商匹配）
    if (!cfg.apiKey && globalConfig.apiKey) {
      cfg.apiKey = globalConfig.apiKey;
    }
    return cfg;
  }

  // 2. 否则使用全局默认配置，但模型显示 Badge 遵循 Agent 自身的个性化设定
  const fallback = { ...globalConfig };
  if (agent.modelBadge && agent.modelBadge !== 'Rust Native' && agent.modelBadge !== 'Local ACP') {
    fallback.modelName = agent.modelBadge;
  }
  if (!fallback.apiKey && agent.envVars) {
    const foundKey = agent.envVars.find(
      (v) =>
        v.key === 'DEEPSEEK_API_KEY' ||
        v.key === 'OPENAI_API_KEY' ||
        v.key === 'ANTHROPIC_API_KEY' ||
        v.key.endsWith('_API_KEY')
    );
    if (foundKey && foundKey.value) {
      fallback.apiKey = foundKey.value;
    }
  }
  return fallback;
}

/**
 * 校验模型配置是否已完整就绪（具备调用模型所需的 Key 或本地免密条件）
 */
export function isModelConfigReady(config: AgentModelConfig): boolean {
  if (config.provider === 'ollama') {
    return true; // 本地 Ollama 无需 API Key
  }
  return Boolean(config.apiKey && config.apiKey.trim().length > 0);
}

export interface ModelProbeResult {
  ok: boolean;
  latencyMs: number;
  modelName?: string;
  error?: string;
}

/**
 * 测试大模型 API 连通性
 */
export async function testModelConnection(config: AgentModelConfig): Promise<ModelProbeResult> {
  const start = Date.now();
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  const apiKey = (config.apiKey || '').trim();

  if (config.provider !== 'ollama' && !apiKey) {
    return {
      ok: false,
      latencyMs: 0,
      error: '请先填写 API Key (密钥不能为空)',
    };
  }

  if (!baseUrl) {
    return {
      ok: false,
      latencyMs: 0,
      error: '接口 Base URL 不能为空',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s 超时

    if (config.provider === 'anthropic') {
      // Anthropic Messages API
      const endpoint = `${baseUrl}/v1/messages`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: config.modelId || 'claude-3-7-sonnet-20250219',
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errMsg = errorData?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
        return { ok: false, latencyMs, error: errMsg };
      }

      const data = await res.json();
      return {
        ok: true,
        latencyMs,
        modelName: data?.model || config.modelId,
      };
    } else {
      // OpenAI / DeepSeek / Ollama / SiliconFlow / Custom OpenAI-compatible
      const endpoint = `${baseUrl}/chat/completions`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.modelId || 'deepseek-chat',
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errMsg = errorData?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
        return { ok: false, latencyMs, error: errMsg };
      }

      const data = await res.json();
      return {
        ok: true,
        latencyMs,
        modelName: data?.model || config.modelId,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError') {
      return { ok: false, latencyMs, error: '连接超时 (超过 12 秒无响应，请检查端点 URL)' };
    }
    return {
      ok: false,
      latencyMs,
      error: err.message || '网络连接失败，请检查网络或跨域设置',
    };
  }
}

/**
 * 调用大模型生成推演回答
 */
export async function callLlmModel(
  config: AgentModelConfig,
  prompt: string,
  systemPrompt?: string
): Promise<{ textResponse: string; durationMs: number }> {
  const start = Date.now();
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  const apiKey = (config.apiKey || '').trim();

  if (config.provider !== 'ollama' && !apiKey) {
    throw new Error('未配置 API Key，请先进入配置面板填写大模型密钥');
  }

  if (config.provider === 'anthropic') {
    const endpoint = `${baseUrl}/v1/messages`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.modelId || 'claude-3-7-sonnet-20250219',
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error?.message || `Anthropic API Error: HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    return { textResponse: text, durationMs: Date.now() - start };
  } else {
    // OpenAI Compatible
    const endpoint = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.modelId || 'deepseek-chat',
        messages,
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error?.message || `LLM API Error: HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { textResponse: text, durationMs: Date.now() - start };
  }
}
