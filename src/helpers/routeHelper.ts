import { MessageRole, MessageStatus, PrismaClient } from "@prisma/client";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function createMessage(
  tx: Tx,
  conversationId: string,
  seq: number,
  role: MessageRole,
  content: string,
) {
  return tx.message.create({
    data: {
      conversationId,
      role,
      status: MessageStatus.COMPLETE,
      content,
      seq,
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      status: true,
      content: true,
      seq: true,
      createdAt: true,
    },
  });
}

export async function createAssistantPlaceholder(
  tx: Tx,
  conversationId: string,
  seq: number,
) {
  return tx.message.create({
    data: {
      conversationId,
      role: MessageRole.ASSISTANT,
      status: MessageStatus.GENERATING,
      content: "",
      seq,
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      status: true,
      content: true,
      seq: true,
      createdAt: true,
    },
  });
}

export async function updateConversationMetadata(
  tx: Tx,
  conversationId: string,
  now: Date,
  options?: {
    preview?: string;
    messageCountIncrement?: number;
    nextSeqIncrement?: number;
  },
) {
  const data: any = {
    lastMessageAt: now,
    messageCount: { increment: options?.messageCountIncrement ?? 1 },
    nextSeq: { increment: options?.nextSeqIncrement ?? 1 },
  };

  if (options?.preview !== undefined) {
    data.lastMessagePreview = options.preview;
  }

  return tx.conversation.update({
    where: { id: conversationId },
    data,
    select: {
      id: true,
      title: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      messageCount: true,
      nextSeq: true,
      createdAt: true,
    },
  });
}

export async function findOwnedConversationWithNextSeq(
  tx: Tx,
  conversationId: string,
  userId: string,
) {
  return tx.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, nextSeq: true },
  });
}
