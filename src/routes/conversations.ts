import { Router } from "express";
import { prisma } from "../db";

type ConversationCursor = { lastMessageAt: string | null; id: string };

function encodeCursor(cursor: ConversationCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: unknown): ConversationCursor | null {
  if (raw == null) return null; // cursor not provided

  if (typeof raw !== "string") return null;

  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);

    // validate shape
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof (parsed as any).id !== "string") return null;

    const lastMessageAt = (parsed as any).lastMessageAt;
    const okLast = lastMessageAt === null || typeof lastMessageAt === "string";

    if (!okLast) return null;

    return { id: (parsed as any).id, lastMessageAt };
  } catch {
    return null;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export const conversationsRouter = Router();

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
