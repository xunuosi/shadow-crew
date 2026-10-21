import { Agent, AgentModelConfig, ModelProviderType } from '../types';
import { saveWorkspaceStateToDb } from './dbClient';

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
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        label: 'DeepSeek V4.1 Flash (2026 旗舰 · 1M 上下文)',
        description: '第四代 Engram 稀疏记忆架构，吞吐与代码推演全面超越 V4 Pro',
      },
      {
        id: 'deepseek-v4',
        name: 'DeepSeek V4',
        label: 'DeepSeek V4 (1M 上下文 · 384K 输出)',
        description: '第四代旗舰基座，超大输出配额与极低单价普及前缀缓存',
      },
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
        id: 'claude-sonnet-5-5-2026',
        name: 'Claude Sonnet 5.5',
        label: 'Claude Sonnet 5.5 (2026 旗舰代码架构 · 1M 上下文)',
        description: 'Anthropic 旗舰自主 Agent 引擎，输出速度提升 30%，最高支持 128K 单次输出',
      },
      {
        id: 'claude-opus-5-5-2026',
        name: 'Claude Opus 5.5',
        label: 'Claude Opus 5.5 (2026 自适应思考 · 1M 上下文)',
        description: '前沿复杂企业级架构推演，分级自适应思考与高可信控制',
      },
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        label: 'Claude 3.7 Sonnet (旗舰混合推理)',
        description: 'Anthropic 经典代码架构推演与混合推理',
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
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        label: 'GPT-5.6 Sol (2026 企业智能体主力 · 1M 上下文)',
        description: '第五代最高代码模型，Token 编码效率提升 54%，原生多智能体协同',
      },
      {
        id: 'gpt-5.6-cyber',
        name: 'GPT-5.6 Cyber',
        label: 'GPT-5.6 Cyber (网安与防御分析专攻)',
        description: '针对漏洞审计、契约攻防与沙箱验证定制',
      },
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
    id: 'zhipu',
    name: '智谱 AI (Zhipu GLM)',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      {
        id: 'glm-5.3',
        name: 'GLM-5.3',
        label: 'GLM-5.3 (2026 旗舰代码 Agent · 1M 上下文)',
        description: '编程能力较 5.2 提升 50%，长程系统工程闭环，输出放宽至 32K~64K',
      },
      {
        id: 'glm-5.3-flash',
        name: 'GLM-5.3 Flash',
        label: 'GLM-5.3 Flash (MoE 极速 · 1M 上下文)',
        description: '线性与稀疏注意力混合 MoE (总参320B/激活18B)，极致吞吐',
      },
      {
        id: 'glm-5-turbo',
        name: 'GLM-5 Turbo',
        label: 'GLM-5 Turbo (OpenClaw 工具链优化)',
        description: '针对自主工具链调用与多 Agent 接地做深度对齐优化',
      },
      {
        id: 'glm-4-flash',
        name: 'GLM-4-Flash',
        label: 'GLM-4-Flash (免费高速)',
        description: '智谱高并发极速模型，适合日常推演与代码执行',
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4-Plus',
        label: 'GLM-4-Plus (高精度基座)',
        description: '智谱全栈大模型，复杂逻辑与长上下文能力出众',
      },
    ],
    apiKeyPlaceholder: '智谱 API Key (来自 open.bigmodel.cn)',
    apiKeyHelpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Moonshot / Kimi)',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    models: [
      {
        id: 'kimi-k3-max',
        name: 'Kimi K3 Max',
        label: 'Kimi K3 Max (2.8T 巨规推理 · 2M 原生上下文)',
        description: '刷新全球开源规模纪录，GPU 内核级优化，超长上下文深度检索召回',
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        label: 'Kimi K3 (2026 旗舰推理 · 1M 上下文)',
        description: '前沿闭源推理引擎，长文本与代码架构深度推理',
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        label: 'Kimi K2.6 (经典长文本增强)',
        description: '稳定高效的百万级长文本与文献工程推演',
      },
    ],
    apiKeyPlaceholder: 'sk-... (来自 platform.moonshot.cn)',
    apiKeyHelpUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      {
        id: 'gemini-4-argon',
        name: 'Gemini 4 Argon',
        label: 'Gemini 4 Argon (2026 旗舰突破 · 2M 上下文)',
        description: '自回归生成输出突破至 1,000,000 Token，主攻千万行代码重构与网安',
      },
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        label: 'Gemini 3.8 Flash (极速混合推理 · 1M 上下文)',
        description: '高频极速前沿推理模型，兼具超低延迟与 1M 原生窗口',
      },
      {
        id: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        label: 'Gemini 3.1 Pro (前沿多模态 · 1M 上下文)',
        description: '全域多模态理解与深度逻辑推演',
      },
    ],
    apiKeyPlaceholder: 'AIzaSy... (来自 aistudio.google.com)',
    apiKeyHelpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'qwen',
    name: '通义千问 (Alibaba Qwen)',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      {
        id: 'qwen3.8-2.4t-a95b',
        name: 'Qwen 3.8 2.4T',
        label: 'Qwen3.8-2.4T-A95B (万亿稀疏 MoE · 1M 上下文)',
        description: '总参 2.4T / 激活 95B，全域思考 (All-field Thinking) 统一图文码推理',
      },
      {
        id: 'qwen3.7-max',
        name: 'Qwen 3.7 Max',
        label: 'Qwen 3.7 Max (全域思考旗舰 · 1M 上下文)',
        description: 'Agentic Coding 标杆，支持长序列稠密检索',
      },
      {
        id: 'qwen2.5-coder-32b-instruct',
        name: 'Qwen 2.5 Coder 32B',
        label: 'Qwen 2.5 Coder 32B (经典代码)',
        description: '成熟稳定的专业代码编程模型',
      },
    ],
    apiKeyPlaceholder: 'sk-... (来自 bailian.console.aliyun.com)',
    apiKeyHelpUrl: 'https://bailian.console.aliyun.com/',
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
        label: '自定义模型标识 (如 qwen-plus, deepseek-v4, claude-proxy 等)',
        description: '适用于 OneAPI, NewAPI, 企业自建私有网关或 vLLM',
      },
    ],
    apiKeyPlaceholder: 'sk-...',
  },
];

/**
 * 智能判定当前模型配置匹配的 ProviderPreset 预设
 */
export function getActiveProviderPreset(config: AgentModelConfig): ProviderPreset {
  if (config.provider === 'deepseek' || config.baseUrl?.includes('deepseek.com')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'deepseek') || PROVIDER_PRESETS[0];
  }
  if (config.baseUrl?.includes('bigmodel.cn') || config.modelId?.toLowerCase().includes('glm')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'zhipu') || PROVIDER_PRESETS[0];
  }
  if (config.baseUrl?.includes('siliconflow')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'siliconflow') || PROVIDER_PRESETS[0];
  }
  if (config.provider === 'anthropic' || config.baseUrl?.includes('anthropic.com')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'anthropic') || PROVIDER_PRESETS[0];
  }
  if (config.provider === 'ollama' || config.baseUrl?.includes('localhost:11434')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'ollama') || PROVIDER_PRESETS[0];
  }
  if (config.provider === 'custom' || (!config.baseUrl?.includes('openai.com') && config.provider === 'openai_compatible')) {
    return PROVIDER_PRESETS.find((p) => p.id === 'custom') || PROVIDER_PRESETS[0];
  }
  return (
    PROVIDER_PRESETS.find((p) => p.id === 'openai') ||
    PROVIDER_PRESETS.find((p) => p.provider === config.provider) ||
    PROVIDER_PRESETS[0]
  );
}

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
    saveWorkspaceStateToDb('global_model_config', config);
    localStorage.setItem(GLOBAL_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('shinobi_global_model_updated', { detail: config }));
  } catch (e) {
    console.warn('[llmService] Failed to write global model config:', e);
  }
}

/**
 * 智能解析特定 Agent 的最终生效模型配置
 * 遵循策略：Agent 私有自定义 > 全局默认配置
 */
export function resolveAgentModelConfig(agent: Agent): AgentModelConfig {
  const globalConfig = getGlobalModelConfig();

  // 1. 如果 Agent 显式配置了独立的私有模型，且没有勾选使用全局默认
  if (agent.modelConfig && !agent.modelConfig.useGlobalDefault && agent.modelConfig.modelId) {
    const cfg = { ...agent.modelConfig };
    // 没有独立配置时回退到全局默认 Key。
    if (!cfg.apiKey && globalConfig.apiKey) {
      cfg.apiKey = globalConfig.apiKey;
    }
    return cfg;
  }

  // 2. 否则使用全局默认配置，但模型显示 Badge 遵循 Agent 自身的个性化设定
  const fallback = { ...globalConfig };
  if (
    agent.modelBadge &&
    agent.modelBadge !== 'Rust Native' &&
    agent.modelBadge !== 'Local ACP' &&
    agent.modelBadge !== 'Remote ACP' &&
    agent.modelBadge !== 'ACP Stdio' &&
    agent.modelBadge !== agent.name &&
    agent.modelBadge !== agent.role &&
    agent.modelBadge !== agent.localAcpProfile
  ) {
    fallback.modelName = agent.modelBadge;
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
 * 规范化 OpenAI 兼容 chat/completions 端点地址
 * 兼容用户输入：Base URL、带 /v1、带 /chat/completions 或尾随斜杠等各种写法
 */
export function buildChatCompletionsUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/v1')) return `${url}/chat/completions`;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
      return `${url}/v1/chat/completions`;
    }
  } catch {}
  return `${url}/chat/completions`;
}

/**
 * 规范化 Anthropic messages 端点地址
 */
export function buildAnthropicMessagesUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (url.endsWith('/v1/messages') || url.endsWith('/messages')) return url;
  if (url.endsWith('/v1')) return `${url}/messages`;
  return `${url}/v1/messages`;
}

export interface PostJsonResponse {
  ok: boolean;
  status: number;
  data: any;
  rawText: string;
  error?: string;
}

export interface RequestJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

/**
 * 全环境通用 HTTP 请求转发器 (支持 GET / POST)
 * 优先级：
 * 1. Tauri 原生 Rust 管道转发 (native_http_post) - 彻底击穿浏览器 WebKit CORS 限制，支持公司内网自签证书
 * 2. Vite 本地开发服务器代理 (/api/llm-proxy) - 浏览器预览模式下无缝避开同源策略
 * 3. 标准 Web 浏览器原生 fetch 回退
 */
export async function requestJsonUniversal(
  url: string,
  options: RequestJsonOptions = {}
): Promise<PostJsonResponse> {
  const method = (options.method || 'POST').toUpperCase() as 'GET' | 'POST';
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeoutMs || 15000;

  // 1. 尝试使用 Tauri 原生后端转发
  const tauriInvoke =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke
      : null;

  if (tauriInvoke) {
    try {
      const res = await tauriInvoke('native_http_post', {
        req: {
          url,
          headers,
          body: method === 'POST' ? body : undefined,
          method,
          timeoutSecs: Math.ceil(timeoutMs / 1000),
        },
      });
      if (res) {
        const hasPayload = Boolean(
          (res.body && (res.body.choices || res.body.id || res.body.content || res.body.data || res.body.models)) ||
          (res.raw_text && (res.raw_text.includes('"choices"') || res.raw_text.includes('"id"') || res.raw_text.includes('"content"') || res.raw_text.includes('"data"') || res.raw_text.includes('"models"')))
        );
        return {
          ok: res.ok || hasPayload,
          status: hasPayload ? 200 : res.status,
          data: res.body,
          rawText: res.raw_text,
          error: (res.ok || hasPayload) ? undefined : res.body?.error?.message || res.raw_text || `HTTP ${res.status}`,
        };
      }
    } catch (tauriErr: any) {
      console.warn('[llmService] Tauri native_http_post error, falling back:', tauriErr);
    }
  }

  // 2. 尝试使用 Vite 开发服务器中间件代理（在浏览器 Dev 预览模式下避开 CORS 限制）
  if (typeof window !== 'undefined' && window.location && window.location.port) {
    try {
      const proxyRes = await fetch('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          headers,
          body: method === 'POST' ? body : undefined,
          method,
          timeoutMs,
        }),
      });
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const hasProxyPayload = Boolean(
          (proxyData.body && (proxyData.body.choices || proxyData.body.id || proxyData.body.content || proxyData.body.data || proxyData.body.models)) ||
          (proxyData.raw_text && (proxyData.raw_text.includes('"choices"') || proxyData.raw_text.includes('"id"') || proxyData.raw_text.includes('"content"') || proxyData.raw_text.includes('"data"') || proxyData.raw_text.includes('"models"')))
        );
        return {
          ok: proxyData.ok || hasProxyPayload,
          status: hasProxyPayload ? 200 : proxyData.status,
          data: proxyData.body,
          rawText: proxyData.raw_text,
          error: (proxyData.ok || hasProxyPayload) ? undefined : proxyData.body?.error?.message || proxyData.error || `HTTP ${proxyData.status}`,
        };
      }
    } catch (proxyErr) {
      // Continue to browser fetch
    }
  }

  // 3. 回退到标准浏览器 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (method === 'POST' && body !== undefined && body !== null) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const rawText = await res.text();
    let data = null;
    try {
      data = JSON.parse(rawText);
    } catch {}

    const hasValid = Boolean(
      (data && (data.choices || data.id || data.content || data.data || data.models)) ||
      (rawText && (rawText.includes('"choices"') || rawText.includes('"id"') || rawText.includes('"data"') || rawText.includes('"models"')))
    );

    return {
      ok: res.ok || hasValid,
      status: res.status,
      data,
      rawText,
      error: (res.ok || hasValid) ? undefined : data?.error?.message || `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    let msg = err.message || '网络连接失败';
    if (msg.includes('Load failed') || msg.includes('Failed to fetch')) {
      msg = `网络请求被浏览器拦截 (Load failed)。原因通常是：目标服务「${new URL(url).host}」未开启跨域(CORS)策略，或企业内网证书未受信任。在 Shadow Crew 桌面端运行将自动通过底层原生网络转发，彻底规避此限制。`;
    }
    return {
      ok: false,
      status: 0,
      data: null,
      rawText: '',
      error: msg,
    };
  }
}

/**
 * 全环境智能 HTTP POST 转发器 (兼容旧版调用)
 */
export async function postJsonUniversal(
  url: string,
  headers: Record<string, string>,
  body: any,
  timeoutMs = 15000
): Promise<PostJsonResponse> {
  return requestJsonUniversal(url, {
    method: 'POST',
    headers,
    body,
    timeoutMs,
  });
}

export interface GatewayModelItem {
  id: string;
  name: string;
  description?: string;
  ownedBy?: string;
  contextWindow?: number;
  supportsImages?: boolean;
}

export interface FetchGatewayModelsResult {
  ok: boolean;
  models: GatewayModelItem[];
  error?: string;
}

/**
 * 动态拉取网关支持的大模型列表
 * 适配标准：
 * - OpenAI 兼容网关 / 企业 AI 网关: GET /v1/models 或 /models
 * - Ollama: GET /api/tags 或 /v1/models
 * - Anthropic: GET /v1/models
 */
export async function fetchGatewayModels(config: {
  baseUrl: string;
  apiKey?: string;
  provider?: string;
}): Promise<FetchGatewayModelsResult> {
  const rawBaseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
  if (!rawBaseUrl) {
    return { ok: false, models: [], error: '请先填写接口 Base URL' };
  }

  const apiKey = (config.apiKey || '').trim();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) {
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  // 组装端点地址
  let modelsUrl = '';
  if (config.provider === 'anthropic') {
    modelsUrl = rawBaseUrl.endsWith('/v1') ? `${rawBaseUrl}/models` : `${rawBaseUrl}/v1/models`;
  } else if (config.provider === 'ollama') {
    modelsUrl = `${rawBaseUrl}/api/tags`;
  } else {
    // OpenAI Compatible / 企业 AI 网关 (ai-gateway)
    if (rawBaseUrl.endsWith('/models')) {
      modelsUrl = rawBaseUrl;
    } else if (rawBaseUrl.endsWith('/v1')) {
      modelsUrl = `${rawBaseUrl}/models`;
    } else {
      modelsUrl = `${rawBaseUrl}/v1/models`;
    }
  }

  try {
    const res = await requestJsonUniversal(modelsUrl, {
      method: 'GET',
      headers,
      timeoutMs: 12000,
    });

    let data = res.data;
    if (!data && res.rawText) {
      try {
        data = JSON.parse(res.rawText);
      } catch {}
    }

    // 若 404 且原地址带 /v1/models，尝试回退至 /models
    if ((!res.ok || !data) && modelsUrl.endsWith('/v1/models')) {
      const fallbackUrl = `${rawBaseUrl}/models`;
      const fallbackRes = await requestJsonUniversal(fallbackUrl, {
        method: 'GET',
        headers,
        timeoutMs: 10000,
      });
      if (fallbackRes.ok && (fallbackRes.data || fallbackRes.rawText)) {
        data = fallbackRes.data || JSON.parse(fallbackRes.rawText);
      }
    }

    if (!data) {
      return {
        ok: false,
        models: [],
        error: res.error || `网关未返回有效模型数据 (HTTP ${res.status})`,
      };
    }

    const rawList = Array.isArray(data)
      ? data
      : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.models)
      ? data.models
      : [];

    const models: GatewayModelItem[] = rawList
      .map((item: any) => {
        const id = item.id || item.name || (typeof item === 'string' ? item : '');
        if (!id) return null;
        let desc = item.description;
        if (!desc && item.owned_by) {
          desc = `来源: ${item.owned_by}`;
        }
        if (item.context_window || item.context) {
          const ctxK = Math.round((item.context_window || item.context) / 1024);
          desc = desc ? `${desc} · ${ctxK}k 上下文` : `${ctxK}k 上下文`;
        }
        return {
          id,
          name: item.name || id,
          description: desc,
          ownedBy: item.owned_by,
          contextWindow: item.context_window || item.context,
          supportsImages: item.supports_images,
        };
      })
      .filter(Boolean) as GatewayModelItem[];

    if (models.length === 0) {
      return {
        ok: false,
        models: [],
        error: data.error?.message || '网关返回的模型列表为空',
      };
    }

    return {
      ok: true,
      models,
    };
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err.message || '拉取网关模型列表失败',
    };
  }
}

/**
 * 测试大模型 API 连通性
 */
export async function testModelConnection(config: AgentModelConfig): Promise<ModelProbeResult> {
  const start = Date.now();
  const rawBaseUrl = (config.baseUrl || '').trim();
  const apiKey = (config.apiKey || '').trim();

  if (config.provider !== 'ollama' && !apiKey) {
    return {
      ok: false,
      latencyMs: 0,
      error: '请先填写 API Key (访问密钥不能为空)',
    };
  }

  if (!rawBaseUrl) {
    return {
      ok: false,
      latencyMs: 0,
      error: '接口 Base URL 不能为空',
    };
  }

  try {
    let endpoint = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let body: any = null;

    if (config.provider === 'anthropic') {
      endpoint = buildAnthropicMessagesUrl(rawBaseUrl);
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      body = {
        model: config.modelId || 'claude-3-7-sonnet-20250219',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
      };
    } else {
      endpoint = buildChatCompletionsUrl(rawBaseUrl);
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      body = {
        model: config.modelId || 'deepseek-chat',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 16,
      };
    }

    const res = await postJsonUniversal(endpoint, headers, body, 15000);
    const latencyMs = Date.now() - start;

    let payload = res.data;
    if (!payload && res.rawText) {
      try { payload = JSON.parse(res.rawText); } catch {}
    }
    if (!payload && res.error) {
      try { payload = JSON.parse(res.error); } catch {}
    }

    // 容错检测：如果响应中已经携带了合法的 choices、id、或 content，无论底层网络连接如何断开，均判定为大模型连通成功
    if (payload?.choices || payload?.id || payload?.content) {
      const modelName = payload?.model || config.modelId || 'Ready';
      return {
        ok: true,
        latencyMs,
        modelName,
      };
    }

    if (!res.ok) {
      let errText = res.error || `HTTP ${res.status}`;
      try {
        const parsed = typeof res.data === 'object' ? res.data : JSON.parse(errText);
        if (parsed?.error?.message) errText = parsed.error.message;
        else if (parsed?.message) errText = parsed.message;
      } catch {}

      return {
        ok: false,
        latencyMs,
        error: errText,
      };
    }

    const modelName = res.data?.model || config.modelId || 'Ready';
    return {
      ok: true,
      latencyMs,
      modelName,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    let msg = err?.message || '测试失败';
    if (msg.includes('Load failed') || msg.includes('Failed to fetch')) {
      msg = `网络请求被浏览器拦截 (Load failed)。原因通常是：目标网关未允许浏览器跨域(CORS)；请确保在 Shadow Crew 桌面端运行。`;
    }
    return {
      ok: false,
      latencyMs,
      error: msg,
    };
  }
}

/**
 * 直连大模型运行时的会话级多轮对话缓存 (Key: 完整命名空间命名格式)
 * 确保在 Web 预览或直连 HTTP API 模式下，增量 `<delta-events>` 批次与本地 ACP 有状态 Session 行为完全一致，
 * 并通过 Token 自适应紧缩（Compaction）与 Prefix Caching 友好的折叠摘要，杜绝多 Agent 协同上下文超限。
 */
const MAX_SESSION_HISTORY_MESSAGES = 24;
const llmSessionHistoryMap = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

/**
 * 轻量级字符-Token 启发式加权估算器
 * - 中文/CJK 字符标点：每个字符约 0.85 ~ 1.0 Token
 * - 英文单词与代码符号：约每 3.8 ~ 4 字符 1 Token
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let otherCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }
  return Math.ceil(cjkCount * 1.0 + otherCount / 3.8);
}

export interface ModelContextSpec {
  maxContextTokens: number;
  defaultMaxOutput: number;
  family: string;
}

/**
 * 2026 主流前沿大模型与经典基座上下文规格解析器
 * 适配智谱 GLM-5 系列、月之暗面 Kimi K3 系列、阿里通义千问 Qwen3 系列、
 * DeepSeek-V4 系列、Anthropic Claude 5 系列、Google Gemini 4/3 系列与 OpenAI GPT-5.6 系列
 */
export function resolveModelContextSpec(modelIdOrName: string, provider?: string): ModelContextSpec {
  const norm = (modelIdOrName || '').toLowerCase().trim();

  // 1. Google Gemini 系列 (Gemini 4 Argon: 原生 1M~2M 上下文，超大输出; Gemini 3.8/3.7/3.6/3.5 Flash/Pro)
  if (norm.includes('gemini-4') || norm.includes('gemini 4') || norm.includes('argon')) {
    return { maxContextTokens: 2_000_000, defaultMaxOutput: 131_072, family: 'Gemini 4 Argon' };
  }
  if (norm.includes('gemini-3') || norm.includes('gemini 3') || norm.includes('gemini-2') || norm.includes('gemini')) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 65_536, family: 'Gemini 3' };
  }

  // 2. 月之暗面 Moonshot / Kimi 系列 (Kimi K3 / K3 Max: 原生 1M~2M 上下文; K2.6, K2.5)
  if (norm.includes('k3') || norm.includes('k3-max') || norm.includes('k3_max')) {
    return { maxContextTokens: 2_000_000, defaultMaxOutput: 65_536, family: 'Kimi K3' };
  }
  if (norm.includes('kimi') || norm.includes('moonshot') || norm.includes('k2.6') || norm.includes('k2.5')) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 32_768, family: 'Kimi K2' };
  }

  // 3. 智谱 AI (GLM-5.3 / 5.3-Flash, GLM-5.2/5.1/5.0, GLM-5-Turbo, GLM-4.7)
  if (norm.includes('glm-5') || norm.includes('glm 5') || norm.includes('glm-4.7') || norm.includes('glm4.7')) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 65_536, family: 'GLM-5' };
  }
  if (norm.includes('glm-4-plus') || norm.includes('glm-4-air') || norm.includes('glm-4-flash') || norm.includes('glm-4')) {
    return { maxContextTokens: 128_000, defaultMaxOutput: 16_384, family: 'GLM-4' };
  }

  // 4. 通义千问 Alibaba Qwen 系列 (Qwen3.8-2.4T-A95B, Qwen3.7-Max/Plus, Qwen3.6, Qwen3)
  if (norm.includes('qwen3') || norm.includes('qwen-3') || norm.includes('qwen 3')) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 32_768, family: 'Qwen 3' };
  }
  if (norm.includes('qwen2.5') || norm.includes('qwen-2.5')) {
    return { maxContextTokens: 128_000, defaultMaxOutput: 8_192, family: 'Qwen 2.5' };
  }

  // 5. DeepSeek 深度求索 (DeepSeek-V4.1-Flash, DeepSeek-V4 Flash/Pro, V4-Flash-Vision-Exp)
  if (norm.includes('deepseek-v4') || norm.includes('deepseek v4') || norm.includes('v4.1') || norm.includes('v4-flash') || norm.includes('v4-pro')) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 131_072, family: 'DeepSeek V4' };
  }
  if (norm.includes('r1') || norm.includes('deepseek-chat') || norm.includes('deepseek-v3') || norm.includes('deepseek')) {
    return { maxContextTokens: 64_000, defaultMaxOutput: 8_192, family: 'DeepSeek V3/R1' };
  }

  // 6. Anthropic Claude (Claude Opus 5.5/5.0, Claude Sonnet 5.5/5.0, Claude Fable 5.1/5.0, Claude Mythos 5.1)
  if (
    norm.includes('opus 5') ||
    norm.includes('opus-5') ||
    norm.includes('sonnet 5') ||
    norm.includes('sonnet-5') ||
    norm.includes('claude-5') ||
    norm.includes('claude 5') ||
    norm.includes('fable') ||
    norm.includes('mythos')
  ) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 131_072, family: 'Claude 5' };
  }
  if (norm.includes('claude-3-7') || norm.includes('claude 3.7') || norm.includes('claude-3-5') || norm.includes('claude 3.5')) {
    return { maxContextTokens: 200_000, defaultMaxOutput: 65_536, family: 'Claude 3.5/3.7' };
  }
  if (norm.includes('claude-3-haiku') || norm.includes('haiku')) {
    return { maxContextTokens: 200_000, defaultMaxOutput: 8_192, family: 'Claude Haiku' };
  }

  // 7. OpenAI (GPT-5.6 Sol/Terra/Luna, GPT-5.6-Cyber, GPT-5.5, GPT-5)
  if (
    norm.includes('gpt-5') ||
    norm.includes('gpt 5') ||
    norm.includes('sol') ||
    norm.includes('terra') ||
    norm.includes('luna') ||
    norm.includes('cyber')
  ) {
    return { maxContextTokens: 1_000_000, defaultMaxOutput: 131_072, family: 'GPT-5' };
  }
  if (norm.includes('gpt-4o') || norm.includes('gpt-4') || norm.includes('o3-mini') || norm.includes('o1')) {
    return { maxContextTokens: 128_000, defaultMaxOutput: 16_384, family: 'GPT-4o/o3' };
  }

  // 8. 本地轻量级部署 (Ollama / Local Engine)
  if (provider === 'ollama' || norm.includes('ollama') || norm.includes('local') || norm.includes('shinobi-engine')) {
    if (norm.includes('32k')) {
      return { maxContextTokens: 32_768, defaultMaxOutput: 4_096, family: 'Local 32K' };
    }
    if (norm.includes('16k')) {
      return { maxContextTokens: 16_384, defaultMaxOutput: 4_096, family: 'Local 16K' };
    }
    return { maxContextTokens: 8_192, defaultMaxOutput: 4_096, family: 'Local Default' };
  }

  // 默认兜底规格 (中大型通用 64K ~ 128K)
  return { maxContextTokens: 64_000, defaultMaxOutput: 4_096, family: 'Standard' };
}

/**
 * 根据大模型配置获取上下文安全预算（Tokens）
 * 全面适配 2026 年主流大模型（GLM-5.3、Kimi K3、Qwen3.8、DeepSeek-V4、Claude 5.5、Gemini 4、GPT-5.6 等原生 1M~2M 窗口）
 */
export function getModelSafeContextBudget(config: AgentModelConfig): {
  maxContextTokens: number;
  historyTokenBudget: number;
  reservedForOutput: number;
  modelFamily: string;
} {
  const spec = resolveModelContextSpec(config.modelId || config.modelName || '', config.provider);
  const maxContext =
    config.contextWindowTokens && config.contextWindowTokens > 0
      ? config.contextWindowTokens
      : spec.maxContextTokens;

  const reservedForOutput =
    config.maxTokens && config.maxTokens > 0 ? config.maxTokens : spec.defaultMaxOutput;

  if (config.customContextBudget && config.customContextBudget > 0) {
    return {
      maxContextTokens: maxContext,
      historyTokenBudget: config.customContextBudget,
      reservedForOutput,
      modelFamily: spec.family,
    };
  }

  // 预留输出空间与系统提示词空间后，按 70% 作为历史上下文安全水位
  const usableTokens = Math.max(2048, maxContext - reservedForOutput);
  let computedBudget = Math.floor(usableTokens * 0.7);

  // 工程稳态守卫：在 1M~2M 超大窗口场景下，将桌面多 Agent 协同历史稳态预算设定在 512,000 Tokens 上限，
  // 兼顾海量长代码 Diff 深度推演与桌面端 JSON 传输/内存稳定性；小模型（8k~32k）则精准贴合其物理上限。
  const MAX_DESKTOP_STEADY_BUDGET = 512_000;
  if (computedBudget > MAX_DESKTOP_STEADY_BUDGET) {
    computedBudget = MAX_DESKTOP_STEADY_BUDGET;
  }

  const historyTokenBudget = Math.max(2048, computedBudget);

  return {
    maxContextTokens: maxContext,
    historyTokenBudget,
    reservedForOutput,
    modelFamily: spec.family,
  };
}

/**
 * 会话历史上下文紧缩算法（Context Compaction）
 * 当历史消息总 Token 超过安全预算（或总消息条数过多）时：
 * 1. 保留最近的活跃工作窗口（默认最近 2 轮，即 4 条消息）；
 * 2. 将早期被淘汰的消息浓缩提炼为单一的 <compacted-summary> 结构；
 * 3. 严格遵循 user / assistant 严格交替契约，杜绝 Anthropic 等 API 校验失败。
 */
export function compactConversationHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  historyTokenBudget: number,
  keepRecentMessages: number = 4
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (history.length <= keepRecentMessages) {
    const totalTokens = history.reduce((acc, m) => acc + estimateTokenCount(m.content), 0);
    if (totalTokens <= historyTokenBudget) {
      return history;
    }
  }

  const totalTokens = history.reduce((acc, m) => acc + estimateTokenCount(m.content), 0);
  if (totalTokens <= historyTokenBudget && history.length <= MAX_SESSION_HISTORY_MESSAGES) {
    return history;
  }

  // 必须保证切片切在 user 消息起点，确保后续 recentMessages 始终以 user 开头
  let splitIdx = Math.max(0, history.length - keepRecentMessages);
  while (splitIdx < history.length && history[splitIdx].role !== 'user') {
    splitIdx++;
  }
  if (splitIdx >= history.length) {
    splitIdx = Math.max(0, history.length - 2);
    while (splitIdx > 0 && history[splitIdx].role !== 'user') {
      splitIdx--;
    }
  }

  const olderMessages = history.slice(0, splitIdx);
  const recentMessages = history.slice(splitIdx);

  if (olderMessages.length === 0) {
    return recentMessages;
  }

  const summaries: string[] = [];
  let olderEstimatedTokens = 0;

  for (const msg of olderMessages) {
    olderEstimatedTokens += estimateTokenCount(msg.content);
    if (msg.content.includes('<compacted-summary')) {
      const innerMatch = msg.content.match(/<compacted-summary[^>]*>([\s\S]*?)<\/compacted-summary>/i);
      if (innerMatch && innerMatch[1]) {
        summaries.push(innerMatch[1].trim());
        continue;
      }
    }

    const cleaned = msg.content
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = cleaned.length > 140 ? `${cleaned.slice(0, 140)}...` : cleaned;
    if (snippet) {
      summaries.push(`• [${msg.role}]: ${snippet}`);
    }
  }

  const summaryUserText = `<compacted-summary folded-turns="${olderMessages.length}" estimated-saved-tokens="${olderEstimatedTokens}">
[系统自适应历史折叠摘要 · 早期上下文已安全压缩]:
${summaries.slice(-8).join('\n')}
</compacted-summary>`;

  const compactedTurn: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: summaryUserText },
    {
      role: 'assistant',
      content: '已对齐上述早期折叠历史与关键决议要点，正基于当前最新上下文专注推进任务。',
    },
  ];

  return [...compactedTurn, ...recentMessages];
}

export function clearLlmSessionHistory(agentIdOrSessionKey?: string): void {
  if (!agentIdOrSessionKey) {
    llmSessionHistoryMap.clear();
    return;
  }
  for (const key of Array.from(llmSessionHistoryMap.keys())) {
    if (key === agentIdOrSessionKey || key.endsWith(`:${agentIdOrSessionKey}`) || key.startsWith(`${agentIdOrSessionKey}:`) || key.includes(`:${agentIdOrSessionKey}:`)) {
      llmSessionHistoryMap.delete(key);
    }
  }
}

/**
 * 调用大模型生成推演回答
 */
export async function callLlmModel(
  config: AgentModelConfig,
  prompt: string,
  systemPrompt?: string,
  sessionKey?: string
): Promise<{ textResponse: string; durationMs: number }> {
  const start = Date.now();
  const rawBaseUrl = (config.baseUrl || '').trim();
  const apiKey = (config.apiKey || '').trim();

  if (config.provider !== 'ollama' && !apiKey) {
    throw new Error('未配置 API Key，请先进入配置面板填写大模型密钥');
  }

  const budget = getModelSafeContextBudget(config);
  const rawHistory = sessionKey ? llmSessionHistoryMap.get(sessionKey) || [] : [];
  const compactedHistory = compactConversationHistory(rawHistory, budget.historyTokenBudget);

  const conversationTurns: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...compactedHistory,
    { role: 'user', content: prompt },
  ];

  const recordTurnSuccess = (assistantReply: string) => {
    if (!sessionKey || !assistantReply.trim()) return;
    const nextHistory = [
      ...compactedHistory,
      { role: 'user' as const, content: prompt },
      { role: 'assistant' as const, content: assistantReply },
    ];
    const bounded = compactConversationHistory(nextHistory, budget.historyTokenBudget);
    llmSessionHistoryMap.set(sessionKey, bounded);
  };

  if (config.provider === 'anthropic') {
    const endpoint = buildAnthropicMessagesUrl(rawBaseUrl);
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model: config.modelId || 'claude-3-7-sonnet-20250219',
      system: systemPrompt || undefined,
      messages: conversationTurns,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };

    const res = await postJsonUniversal(endpoint, headers, body, 60000);
    if (!res.ok) {
      throw new Error(res.error || `Anthropic API Error: HTTP ${res.status}`);
    }

    const text = res.data?.content?.[0]?.text || '';
    recordTurnSuccess(text);
    return { textResponse: text, durationMs: Date.now() - start };
  } else {
    // OpenAI Compatible / Custom / Corporate Gateway
    const endpoint = buildChatCompletionsUrl(rawBaseUrl);
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
    messages.push(...conversationTurns);

    const body = {
      model: config.modelId || 'deepseek-chat',
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };

    const res = await postJsonUniversal(endpoint, headers, body, 60000);
    if (!res.ok) {
      throw new Error(res.error || `LLM API Error: HTTP ${res.status}`);
    }

    const text = res.data?.choices?.[0]?.message?.content || '';
    recordTurnSuccess(text);
    return { textResponse: text, durationMs: Date.now() - start };
  }
}
