/**
 * Global Model Configuration & Registry
 * 集中管理大模型底座元数据，支持统一增删及后续从远端配置服务/API 动态拉取扩展
 */

export interface ModelOption {
  id: string;            // 唯一标识，如 'claude-3-7-sonnet'
  name: string;          // 显示名称/Badge，如 'Claude 3.7 Sonnet'
  label: string;         // 下拉菜单文案，如 'Claude 3.7 Sonnet (推荐代码架构)'
  description?: string;  // 模型能力特色说明
  vendor: 'anthropic' | 'deepseek' | 'openai' | 'google' | 'local' | 'custom' | string;
  isRecommended?: boolean;
  contextWindow?: string;
}

/**
 * 默认推荐底座推理模型
 */
export const DEFAULT_MODEL_NAME = 'Claude 3.7 Sonnet';

/**
 * 内置官方推荐的大模型列表（全局常量）
 */
export const SUPPORTED_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-5-5-2026',
    name: 'Claude Sonnet 5.5',
    label: 'Claude Sonnet 5.5 (2026 旗舰代码架构 · 1M)',
    description: 'Anthropic 旗舰自主 Agent 引擎，1M 上下文，最高支持 128K 单次输出',
    vendor: 'anthropic',
    isRecommended: true,
    contextWindow: '1M',
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    label: 'DeepSeek V4.1 Flash (2026 旗舰 · 1M)',
    description: '第四代 Engram 记忆架构，极高吞吐与前缀缓存，单轮支持超大输出',
    vendor: 'deepseek',
    isRecommended: true,
    contextWindow: '1M',
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    label: 'GPT-5.6 Sol (2026 企业智能体主力 · 1M)',
    description: '第五代最高代码模型，Token 编码效率提升 54%，原生多智能体协同',
    vendor: 'openai',
    contextWindow: '1M',
  },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    label: 'GLM-5.3 (智谱全栈 Agent · 1M)',
    description: '长程系统工程闭环，编程能力跃升，输出放宽至 32K~64K',
    vendor: 'zhipu',
    contextWindow: '1M',
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    label: 'Kimi K3 (月之暗面旗舰 · 2M)',
    description: '2.8T 超大规模推理模型，原生 2M 超长上下文，深度文档召回',
    vendor: 'moonshot',
    contextWindow: '2M',
  },
  {
    id: 'qwen3.8-2.4t-a95b',
    name: 'Qwen 3.8 2.4T',
    label: 'Qwen 3.8 2.4T (通义千问万亿 MoE · 1M)',
    description: '全域思考 (All-field Thinking) 统一图文码推理，Agentic Coding 标杆',
    vendor: 'qwen',
    contextWindow: '1M',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    label: 'Gemini 4 Argon (Google 旗舰突破 · 2M)',
    description: '原生 2M 超大窗口，突破百万输出天花板，主攻千万行代码重构',
    vendor: 'google',
    contextWindow: '2M',
  },
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    label: 'Claude 3.7 Sonnet (经典代码架构)',
    description: 'Anthropic 混合推理旗舰大模型，代码编写与架构推演标杆',
    vendor: 'anthropic',
    contextWindow: '200k',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    label: 'DeepSeek R1 (数学推演与逻辑论证)',
    description: '开源深度推理大模型，擅长复杂算法论证与边界推导',
    vendor: 'deepseek',
    contextWindow: '64k',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    label: 'DeepSeek V3 (通用全栈推理)',
    description: '高性价比全栈开发大模型，日常推演与代码执行响应迅速',
    vendor: 'deepseek',
    contextWindow: '64k',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    label: 'GPT-4o (多模态理解与执行)',
    description: 'OpenAI 经典全能多模态模型，具备强大的图文综合分析能力',
    vendor: 'openai',
    contextWindow: '128k',
  },
  {
    id: 'shinobi-engine-2',
    name: 'Shinobi-Engine 2.0',
    label: 'Shinobi-Engine 2.0 (本地私密引擎)',
    description: '本地私密离线部署引擎，物理级隔离确保代码与知识零出境',
    vendor: 'local',
    contextWindow: '32k',
  },
];

const DYNAMIC_MODELS_STORAGE_KEY = 'shinobi_dynamic_models';
const DEFAULT_MODEL_STORAGE_KEY = 'shinobi_default_model';

/**
 * 获取当前所有可用模型列表（内置静态模型 + 远端动态拉取/本地扩展的模型）
 */
export function getAvailableModels(): ModelOption[] {
  if (typeof window === 'undefined') return SUPPORTED_MODELS;
  try {
    const cached = localStorage.getItem(DYNAMIC_MODELS_STORAGE_KEY);
    if (cached) {
      const dynamicList: ModelOption[] = JSON.parse(cached);
      if (Array.isArray(dynamicList) && dynamicList.length > 0) {
        const existingNames = new Set(SUPPORTED_MODELS.map((m) => m.name));
        const customModels = dynamicList.filter((m) => !existingNames.has(m.name));
        return [...SUPPORTED_MODELS, ...customModels];
      }
    }
  } catch (e) {
    console.warn('[ModelConfig] Failed to parse dynamic models from cache:', e);
  }
  return SUPPORTED_MODELS;
}

/**
 * 获取当前全局设置的默认模型名称
 */
export function getPersistedDefaultModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_NAME;
  try {
    const saved = localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY);
    if (saved) return saved;
  } catch {}
  return DEFAULT_MODEL_NAME;
}

/**
 * 持久化全局默认模型
 */
export function setPersistedDefaultModel(modelName: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, modelName);
  } catch (e) {
    console.warn('[ModelConfig] Failed to persist default model:', e);
  }
}

/**
 * 动态同步/注册来自远端配置服务的模型列表
 */
export function syncRemoteModels(models: ModelOption[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DYNAMIC_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch (e) {
    console.warn('[ModelConfig] Failed to persist dynamic models:', e);
  }
}
