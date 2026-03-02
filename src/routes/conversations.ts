import { Router } from "express";
import { prisma } from "../db";
import { ok } from "node:assert";

// type ConversationCursor = { lastMessageAt: string | null; id: string };

// function encodeCursor(cursor: ConversationCursor) {
//   return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
// }

// function decodeCursor(raw: unknown): ConversationCursor | null {
//   if (raw == null) return null; // cursor not provided

//   if (typeof raw !== "string") return null;

//   try {
//     const json = Buffer.from(raw, "base64url").toString("utf8");
//     const parsed = JSON.parse(json);

//     // validate shape
//     if (!parsed || typeof parsed !== "object") return null;
//     if (typeof (parsed as any).id !== "string") return null;

//     const lastMessageAt = (parsed as any).lastMessageAt;
//     const okLast = lastMessageAt === null || typeof lastMessageAt === "string";

//     if (!okLast) return null;

//     return { id: (parsed as any).id, lastMessageAt };
//   } catch {
//     return null;
//   }
// }

// function isUuid(value: string) {
//   return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
//     value,
//   );
// }

export const conversationsRouter = Router();

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

    const now = new Date();
    const preview = content.slice(0, 120);

    const result = await prisma.$transaction(async (tx) => {
      // Ownership check + read nextSeq INSIDE the transaction
      const convo = await tx.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true, nextSeq: true },
      });

      if (!convo) {
        return { notFound: true as const };
      }

      const message = await tx.message.create({
        data: {
          conversationId,
          role: "USER", // <-- change to "USER" if your enum is uppercase
          content,
          seq: convo.nextSeq,
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

      const conversation = await tx.conversation.update({
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

// conversationsRouter.post("/", async (req, res, next) => {
//   try {
//     const userId = req.userId;

//     // MVP: create empty conversation
//     if (!userId) {
//       return res.status(401).json({
//         error: { code: "UNAUTHENTICATED", message: "Missing userId" },
//       });
//     }
//     const convo = await prisma.conversation.create({
//       data: {
//         userId,
//         // lastMessageAt etc can be null initially
//       },
//       select: {
//         id: true,
//         createdAt: true,
//         lastMessageAt: true,
//         lastMessagePreview: true,
//         messageCount: true,
//       },
//     });

//     res.status(201).json({ conversation: convo });
//   } catch (err) {
//     next(err);
//   }
// });

// conversationsRouter.get("/", async (req, res, next) => {
//   try {
//     const userId = req.userId;

//     if (!userId) {
//       return res.status(401).json({
//         error: { code: "UNAUTHENTICATED", message: "Missing userId" },
//       });
//     }

//     const rawLimit = Number(req.query.limit);
//     const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 50) : 20;

//     const rawCursor = req.query.cursor;
//     const decoded = decodeCursor(rawCursor);

//     // If the client provided cursor but it’s invalid => 400
//     if (rawCursor != null && decoded === null) {
//       return res.status(400).json({
//         error: { code: "INVALID_CURSOR", message: "Cursor is invalid" },
//       });
//     }

//     const cursorWhere =
//       decoded && decoded.lastMessageAt
//         ? {
//             OR: [
//               { lastMessageAt: { lt: new Date(decoded.lastMessageAt) } },
//               {
//                 AND: [
//                   { lastMessageAt: new Date(decoded.lastMessageAt) },
//                   { id: { lt: decoded.id } },
//                 ],
//               },
//               { lastMessageAt: null },
//             ],
//           }
//         : null;

//     const cursorWhereNull =
//       decoded && decoded.lastMessageAt === null
//         ? {
//             AND: [{ lastMessageAt: null }, { id: { lt: decoded.id } }],
//           }
//         : null;

//     const conversations = await prisma.conversation.findMany({
//       where: {
//         userId,
//         ...(cursorWhere ? cursorWhere : {}),
//         ...(cursorWhereNull ? cursorWhereNull : {}),
//       },
//       orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
//       take: limit + 1,
//       select: {
//         id: true,
//         title: true,
//         lastMessageAt: true,
//         lastMessagePreview: true,
//         messageCount: true,
//         createdAt: true,
//       },
//     });

//     const hasNext = conversations.length > limit;
//     const page = hasNext ? conversations.slice(0, limit) : conversations;

//     const last = page[page.length - 1];
//     const nextCursor =
//       hasNext && last
//         ? encodeCursor({
//             lastMessageAt: last.lastMessageAt
//               ? last.lastMessageAt.toISOString()
//               : null,
//             id: last.id,
//           })
//         : null;

//     res.json({ conversations: page, nextCursor });
//   } catch (err) {
//     next(err);
//   }
// });

// conversationsRouter.post("/:id/messages", async (req, res, next) => {
//   try {
//     const userId = req.userId;
//     if (!userId) {
//       return res.status(401).json({
//         error: { code: "UNAUTHENTICATED", message: "Missing userId" },
//       });
//     }

//     const conversationId = req.params.id;

//     if (!isUuid(conversationId)) {
//       return res.status(404).json({
//         error: { code: "NOT_FOUND", message: "Conversation not found" },
//       });
//     }

//     const convo = await prisma.conversation.findFirst({
//       where: { id: conversationId, userId },
//       select: { id: true },
//     });
//     if (!convo) {
//       return res.status(404).json({
//         error: { code: "NOT_FOUND", message: "Conversation not found" },
//       });
//     }

//     const content =
//       typeof req.body?.content === "string" ? req.body.content.trim() : "";

//     if (!content) {
//       return res.status(400).json({
//         error: { code: "INVALID_INPUT", message: "content is required" },
//       });
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       // 1) Ownership check + read nextSeq
//       const convo = await tx.conversation.findFirst({
//         where: { id: conversationId, userId },
//         select: { id: true, nextSeq: true },
//       });

//       if (!convo) return { notFound: true as const };

//       const seq = convo.nextSeq;
//       const now = new Date();

//       // 2) Create message
//       const message = await tx.message.create({
//         data: {
//           conversationId: convo.id,
//           seq,
//           role: "USER",
//           content,
//           createdAt: now,
//         },
//         select: {
//           id: true,
//           conversationId: true,
//           seq: true,
//           role: true,
//           content: true,
//           createdAt: true,
//         },
//       });

//       // 3) Update conversation summary fields + nextSeq
//       await tx.conversation.update({
//         where: { id: convo.id },
//         data: {
//           nextSeq: { increment: 1 },
//           messageCount: { increment: 1 },
//           lastMessageAt: now,
//           lastMessagePreview: content.slice(0, 200),
//         },
//       });

//       return { notFound: false as const, message };
//     });

//     if (result.notFound) {
//       return res.status(404).json({
//         error: { code: "NOT_FOUND", message: "Conversation not found" },
//       });
//     }

//     return res.status(201).json({ message: result.message });

//     // res.status(200).json({ ok: true, conversationId, content });
//   } catch (err) {
//     next(err);
//   }
// });
