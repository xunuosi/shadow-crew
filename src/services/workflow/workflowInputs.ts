import type { Message } from '../../types';

export const WORKFLOW_USER_ID = 'user-norris';

type MessageLike = Pick<Message, 'id' | 'authorId'>;

/**
 * 判断 kickoff 用户消息之后是否又出现了新的用户消息。
 * 只比较 kickoff 之后的消息，避免同一议题中更早的用户输入被误判为「新一轮指令」
 * 而导致工作流在首个阶段结束后被立即取消。
 */
export function hasUserMessageAfterKickoff(
  messages: ReadonlyArray<MessageLike>,
  kickoffUserMessageId: string
): boolean {
  const kickoffIndex = messages.findIndex((message) => message.id === kickoffUserMessageId);
  if (kickoffIndex < 0) {
    return messages.some((message) => message.authorId === WORKFLOW_USER_ID);
  }
  return messages
    .slice(kickoffIndex + 1)
    .some((message) => message.authorId === WORKFLOW_USER_ID);
}
