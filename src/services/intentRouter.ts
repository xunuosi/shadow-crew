import type { Agent } from '../types';
import { isAgentOnline } from '../utils/agentRuntime';

/**
 * 简单问题快答路由。
 *
 * 背景：标准讨论模式下，未显式点名时会唤醒议题/频道内全部在线 Agent，
 * 一句“这个函数干什么”也要等 N 路完整回答 + Turn Barrier 收敛。
 * 本模块用保守的规则识别“明显的单点事实型问题”，只唤醒一个 Agent；
 * 任何复杂/多文件/评审类诉求仍走原有的全员并发讨论，避免误降级。
 */

const COMPLEXITY_PATTERN =
  /(评审|审查|重构|架构|方案|选型|对比|权衡|设计|实现|迁移|排查|归因|分析|多文件|整个项目|全量|安全|并发|性能|数据库|接口契约)/;

const INTERROGATIVE_START =
  /^(什么|怎么|如何|为什么|为何|是否|能否|可以|请问|帮我查|what|how|why|when|where|who|which|is |are |can |could |should )/i;

/**
 * 判断文本是否属于“简单问题”：
 * - 短文本、无代码块、无显式 @ 指定；
 * - 以问号结尾，或以疑问词开头且足够短；
 * - 不含架构/评审/多文件等复杂意图关键词。
 */
export function isSimpleQuestion(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  if (trimmed.length > 180) return false;
  if (trimmed.includes('```')) return false;
  if (/@[^\s]+/.test(trimmed)) return false;
  if (COMPLEXITY_PATTERN.test(trimmed)) return false;

  const endsWithQuestion = /[?？]\s*$/.test(trimmed);
  const startsWithInterrogative =
    INTERROGATIVE_START.test(trimmed) && trimmed.length <= 120;
  return endsWithQuestion || startsWithInterrogative;
}

/**
 * 从候选 Agent 中挑选快答者：优先在线 Agent，其次按原有顺序取第一个。
 * 返回 null 表示不应走快答（候选为空）。
 */
export function pickFastPathAgent(agents: Agent[]): Agent | null {
  if (!agents || agents.length === 0) return null;
  return agents.find((agent) => isAgentOnline(agent)) || agents[0];
}

/**
 * 决策入口：简单问题且存在候选 Agent 时返回唯一应答者，否则返回 null。
 * 调用方据此决定保持全员广播还是收窄为单 Agent。
 */
export function resolveFastPathResponder(
  text: string,
  candidates: Agent[]
): Agent | null {
  if (!isSimpleQuestion(text)) return null;
  return pickFastPathAgent(candidates);
}
