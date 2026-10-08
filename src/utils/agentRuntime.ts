import type { Agent } from '../types';

/**
 * 判定 Agent 是否处于「运行期不可用」状态。
 *
 * - `idle`：用户尚未点击 Start，ACP 进程未拉起；
 * - `error`：进程启动或 ACP initialize 握手失败（例如适配器后端二进制缺失）。
 *   此时进程可能仍然存活，但无法承载任何 prompt——UI 绝不能显示 online。
 *
 * 这两类状态都不具备接收 prompt 的能力，讨论编排必须在派发前拦截，
 * 而不是让请求在某个博弈阶段中途以错误文本返回。
 */
export function isAgentOffline(agent: Pick<Agent, 'status'>): boolean {
  return agent.status === 'idle' || agent.status === 'error';
}

export function isAgentOnline(agent: Pick<Agent, 'status'>): boolean {
  return !isAgentOffline(agent);
}
