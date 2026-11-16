/**
 * SPRT 早停阈值外置配置 (Threshold Externalization)
 *
 * 目的：让 Wald-SPRT 的 alpha/beta/sensitivity/中性基线/漏斗衰减等硬编码阈值
 * 可以由真实流量标定后显式覆盖，而不必改源码重新构建。
 *
 * 数据治理准则：配置项采用严格白名单 + 数值区间校验；
 * 非法值直接剔除并显式告警，绝不做类型强转或旧字段回退猜测。
 */

export interface SprtThresholdOverrides {
  /** 第一类错误率（虚假早停），(0, 0.5] */
  alpha?: number;
  /** 第二类错误率（漏报 / 死锁误判），(0, 0.5] */
  beta?: number;
  /** 基础敏感度（似然比增量放大系数），[0.5, 10] */
  sensitivity?: number;
  /** 中性基线 theta_0，[0.05, 0.95] */
  neutralThreshold?: number;
  /** 最小探索轮次（0~6） */
  minExplorationRounds?: number;
  /** 漏斗上界收缩率，[0, 0.9] */
  funnelDecayRate?: number;
  /** 存在接地证据时的接地权重，[0, 1] */
  groundingWeightWhenPresent?: number;
  /** 安全轮次上限（1~12） */
  maxRounds?: number;
}

export const SPRT_THRESHOLD_STORAGE_KEY = 'shadow_crew_sprt_thresholds_v1';

interface NumericRule {
  min: number;
  max: number;
  integer?: boolean;
}

/**
 * 每个可外置阈值的合法区间。集中定义，供校验与文档/测试共用。
 */
export const SPRT_THRESHOLD_LIMITS: Record<keyof SprtThresholdOverrides, NumericRule> = {
  alpha: { min: 0.001, max: 0.5 },
  beta: { min: 0.001, max: 0.5 },
  sensitivity: { min: 0.5, max: 10 },
  neutralThreshold: { min: 0.05, max: 0.95 },
  minExplorationRounds: { min: 0, max: 6, integer: true },
  funnelDecayRate: { min: 0, max: 0.9 },
  groundingWeightWhenPresent: { min: 0, max: 1 },
  maxRounds: { min: 1, max: 12, integer: true },
};

const KNOWN_KEYS = Object.keys(SPRT_THRESHOLD_LIMITS) as (keyof SprtThresholdOverrides)[];

function isValidValue(key: keyof SprtThresholdOverrides, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const rule = SPRT_THRESHOLD_LIMITS[key];
  if (rule.integer && !Number.isInteger(value)) return false;
  return value >= rule.min && value <= rule.max;
}

/**
 * 解析并严格校验外置阈值。返回只含合法字段的对象；
 * 非法字段被剔除，并在控制台显式告警（不猜测、不强转）。
 */
export function parseSprtThresholdOverrides(raw: unknown): SprtThresholdOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: SprtThresholdOverrides = {};
  for (const key of KNOWN_KEYS) {
    if (!(key in source) || source[key] === undefined) continue;
    const value = source[key];
    if (!isValidValue(key, value)) {
      console.warn(
        `[SprtThresholdConfig] Ignoring invalid '${key}'=${JSON.stringify(value)}; expected number in [${SPRT_THRESHOLD_LIMITS[key].min}, ${SPRT_THRESHOLD_LIMITS[key].max}]${SPRT_THRESHOLD_LIMITS[key].integer ? ' (integer)' : ''}`
      );
      continue;
    }
    result[key] = value;
  }
  return result;
}

let cachedOverrides: SprtThresholdOverrides | undefined;

function readFromStorage(): SprtThresholdOverrides {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(SPRT_THRESHOLD_STORAGE_KEY);
      if (!raw) return {};
      return parseSprtThresholdOverrides(JSON.parse(raw));
    }
  } catch (err) {
    console.warn('[SprtThresholdConfig] Failed to read overrides from localStorage:', err);
  }
  return {};
}

/** 读取当前生效的外置阈值（进程内缓存，保存/重置时同步更新）。 */
export function getSprtThresholdOverrides(): SprtThresholdOverrides {
  if (cachedOverrides === undefined) {
    cachedOverrides = readFromStorage();
  }
  return cachedOverrides;
}

/** 强制从 localStorage 重新加载（用于外部修改配置文件后的热刷新）。 */
export function reloadSprtThresholdOverrides(): SprtThresholdOverrides {
  cachedOverrides = readFromStorage();
  return cachedOverrides;
}

/**
 * 持久化外置阈值。传入值同样经过严格校验，非法字段被剔除；
 * 传入空对象等价于清空全部覆盖，回落到运行时拟合/领域默认值。
 */
export function saveSprtThresholdOverrides(raw: unknown): SprtThresholdOverrides {
  const validated = parseSprtThresholdOverrides(raw);
  cachedOverrides = validated;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (Object.keys(validated).length === 0) {
        window.localStorage.removeItem(SPRT_THRESHOLD_STORAGE_KEY);
      } else {
        window.localStorage.setItem(SPRT_THRESHOLD_STORAGE_KEY, JSON.stringify(validated));
      }
    }
  } catch (err) {
    console.warn('[SprtThresholdConfig] Failed to persist overrides:', err);
  }
  return validated;
}

/** 清空外置阈值，回到领域默认 + 历史拟合。 */
export function clearSprtThresholdOverrides(): void {
  saveSprtThresholdOverrides({});
}
