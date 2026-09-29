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
    id: 'zhipu',
    name: '智谱 AI (Zhipu GLM)',
    provider: 'openai_compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      {
        id: 'glm-4-flash',
        name: 'GLM-4-Flash',
        label: 'GLM-4-Flash (免费高速 · 推荐)',
        description: '智谱高并发极速模型，适合日常推演与代码执行',
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4-Plus',
        label: 'GLM-4-Plus (高精度旗舰)',
        description: '智谱旗舰级全栈大模型，复杂逻辑与长上下文能力出众',
      },
      {
        id: 'glm-4-air',
        name: 'GLM-4-Air',
        label: 'GLM-4-Air (极致性价比)',
        description: '轻量低延迟代码与任务执行大模型',
      },
    ],
    apiKeyPlaceholder: '智谱 API Key (来自 open.bigmodel.cn)',
    apiKeyHelpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
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
 * 调用大模型生成推演回答
 */
export async function callLlmModel(
  config: AgentModelConfig,
  prompt: string,
  systemPrompt?: string
): Promise<{ textResponse: string; durationMs: number }> {
  const start = Date.now();
  const rawBaseUrl = (config.baseUrl || '').trim();
  const apiKey = (config.apiKey || '').trim();

  if (config.provider !== 'ollama' && !apiKey) {
    throw new Error('未配置 API Key，请先进入配置面板填写大模型密钥');
  }

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
      messages: [{ role: 'user', content: prompt }],
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };

    const res = await postJsonUniversal(endpoint, headers, body, 60000);
    if (!res.ok) {
      throw new Error(res.error || `Anthropic API Error: HTTP ${res.status}`);
    }

    const text = res.data?.content?.[0]?.text || '';
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
    messages.push({ role: 'user', content: prompt });

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
    return { textResponse: text, durationMs: Date.now() - start };
  }
}
