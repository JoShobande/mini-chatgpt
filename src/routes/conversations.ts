import { Router } from "express";
import { prisma } from "../db";
import { ok } from "node:assert";

export const conversationsRouter = Router();

function getPreview(content: string) {
  return content.slice(0, 120);
}

function getCurrentDate() {
  return new Date();
}

async function updateConversationMetadata(
  tx: any,
  conversationId: string,
  now: Date,
  preview: string,
) {
  return tx.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      lastMessagePreview: preview,
      messageCount: { increment: 1 },
      nextSeq: { increment: 1 },
    },
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

async function createMessage(
  tx: any,
  conversationId: string,
  seq: number,
  role: string,
  content: string,
) {
  return tx.message.create({
    data: {
      conversationId,
      role,
      content,
      seq,
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      content: true,
      seq: true,
      createdAt: true,
    },
  });
}

/**
 * GET /v1/conversations
 * Returns sidebar summaries only, ordered by last activity.
 */

conversationsRouter.get("/", async (req, res, next) => {
  const userId = req.userId; // comes from mockAuth

  const take = 20;

  const cursorLastMessageAt = req.query.cursorLastMessageAt
    ? new Date(String(req.query.cursorLastMessageAt))
    : null;

  const cursorId = req.query.cursorId ? String(req.query.cursorId) : null;

  const where: any = { userId };

  if (cursorLastMessageAt && cursorId) {
    where.OR = [
      { lastMessageAt: { lt: cursorLastMessageAt } },
      { lastMessageAt: cursorLastMessageAt, id: { lt: cursorId } },
    ];
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        messageCount: true,
        createdAt: true,
      },
    });

    const last = conversations[conversations.length - 1];

    const nextCursor =
      conversations.length === take && last
        ? {
            cursorLastMessageAt: last.lastMessageAt.toISOString(),
            cursorId: last.id,
          }
        : null;

    res.json({ conversations, nextCursor });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.get("/:id/messages", async (req, res, next) => {
  const userId = req.userId; // comes from mockAuth

  const conversationId = req.params.id;

  try {
    const theConversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!theConversation) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Conversation not found" },
      });
    }
  } catch (err) {
    next(err);
  }

  const take = 20;
  const where: any = { conversationId };

  const cursorSeqRaw = req.query.cursorSeq;
  const cursorSeq =
    typeof cursorSeqRaw === "string" ? Number(cursorSeqRaw) : null;

  if (cursorSeq !== null && !Number.isNaN(cursorSeq)) {
    where.seq = { gt: cursorSeq }; // forward pagination
  }

  try {
    const messages = await prisma.message.findMany({
      where,
      orderBy: [{ seq: "asc" }],
      take,
      select: {
        id: true,
        seq: true,
        role: true,
        createdAt: true,
        content: true,
      },
    });

    const lastMessage = messages[messages.length - 1];
    const nextCursor =
      messages.length === take && lastMessage
        ? { cursorSeq: lastMessage.seq }
        : null;

    res.json({ messages, nextCursor });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post("/", async (req, res, next) => {
  try {
    const content = (req.body?.content ?? "").trim();
    if (!content) {
      return res.status(400).json({
        error: { code: "BAD_REQUEST", message: "content is required" },
      });
    }

    const title = (req.body?.title ?? "").trim() || null;
    const now = new Date();
    const preview = content.slice(0, 120);
    const userId = req.userId;

    const result = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          userId,
          title,
          lastMessageAt: now,
          lastMessagePreview: preview,
          messageCount: 1,
          nextSeq: 2,
        },
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

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role: "USER",
          content,
          seq: 1,
        },
        select: {
          id: true,
          conversationId: true,
          role: true,
          content: true,
          seq: true,
          createdAt: true,
        },
      });

      return { conversation, message };
    });

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post("/:id/messages", async (req, res, next) => {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;

    const content = (req.body?.content ?? "").trim();
    if (!content) {
      return res.status(400).json({
        error: { code: "BAD_REQUEST", message: "content is required" },
      });
    }

    const now = getCurrentDate();
    const preview = getPreview(content);

    const result = await prisma.$transaction(async (tx) => {
      // Ownership check + read nextSeq INSIDE the transaction
      const convo = await tx.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true, nextSeq: true },
      });

      if (!convo) {
        return { notFound: true as const };
      }

      const message = await createMessage(
        tx,
        conversationId,
        convo.nextSeq,
        "USER",
        content,
      );

      const conversation = await updateConversationMetadata(
        tx,
        conversationId,
        now,
        preview,
      );

      return { notFound: false as const, conversation, message };
    });

    if (result.notFound) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Conversation not found" },
      });
    }

    return res.status(201).json({
      conversation: result.conversation,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
});
