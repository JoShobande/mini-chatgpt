import { Router } from "express";
import { prisma } from "../db";
import { MessageRole, MessageStatus } from "@prisma/client";
import {
  createAssistantPlaceholder,
  createMessage,
  findOwnedConversationWithNextSeq,
  updateConversationMetadata,
} from "../helpers/routeHelper";

export const conversationsRouter = Router();

function getPreview(content: string) {
  return content.slice(0, 120);
}

function getCurrentDate() {
  return new Date();
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

conversationsRouter.get("/:id/stream", async (req, res, next) => {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;

    const theConversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!theConversation) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Conversation not found" },
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const chunks = ["This ", "is ", "a ", "streamed ", "reply."];
    let index = 0;

    const intervalId = setInterval(() => {
      if (index < chunks.length) {
        res.write(`data: ${chunks[index]}\n\n`);
        index += 1;
        return;
      }

      clearInterval(intervalId);
      res.write(`event: done\n`);
      res.write(`data: complete\n\n`);
      res.end();
    }, 500);

    req.on("close", () => {
      console.log("SSE client disconnected");
      clearInterval(intervalId);
    });

    res.write(`data: connected\n\n`);
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

      const message = createMessage(tx, conversation.id, 1, "USER", content);
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
      const convo = await findOwnedConversationWithNextSeq(
        tx,
        conversationId,
        userId,
      );

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
        { preview },
      );

      return { notFound: false as const, conversation, message };
    });

    if (result.notFound) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Conversation not found" },
      });
    }

    const assistantResult = await prisma.$transaction(async (tx) => {
      const convo = await findOwnedConversationWithNextSeq(
        tx,
        conversationId,
        userId,
      );

      if (!convo) {
        return { notFound: true as const };
      }

      const assistantMessage = await createAssistantPlaceholder(
        tx,
        conversationId,
        convo.nextSeq,
      );

      const conversation = await updateConversationMetadata(
        tx,
        conversationId,
        now,
      );

      return {
        notFound: false as const,
        conversation,
        assistantMessage,
      };
    });

    if (assistantResult.notFound) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Conversation not found" },
      });
    }

    setTimeout(async () => {
      await prisma.message.update({
        where: { id: assistantResult.assistantMessage.id },
        data: {
          content: "This is a simulated assistant reply.",
          status: MessageStatus.COMPLETE,
        },
      });
    }, 1500);

    return res.status(201).json({
      conversation: result.conversation,
      message: result.message,
      assistantMessage: assistantResult.assistantMessage,
    });
  } catch (err) {
    next(err);
  }
});
