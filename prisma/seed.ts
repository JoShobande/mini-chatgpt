import "dotenv/config";
import { prisma } from "../src/db";

function preview(text: string, max = 80) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

async function main() {
  // Optional dev wipe (safe for early sprint)
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  // (User can stay; we upsert it)

  const email = "josephine@test.com";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  const now = new Date();
  const sameTimestamp = new Date(now); // identical timestamp for tie-breaker testing
  const totalConvos = 50;

  for (let i = 0; i < totalConvos; i++) {
    const isTieGroup = i < 5;
    const ts = isTieGroup
      ? sameTimestamp
      : new Date(now.getTime() - i * 60_000);

    const content = isTieGroup
      ? `Tie-group message ${i + 1}: same timestamp to test (lastMessageAt, id) ordering.`
      : `Hello from seeded conversation ${i + 1}.`;

    await prisma.$transaction(async (tx) => {
      const convo = await tx.conversation.create({
        data: {
          userId: user.id,
          title: null,
          createdAt: ts,

          lastMessageAt: ts,
          lastMessagePreview: preview(content),
          messageCount: 1,

          nextSeq: 2,
        },
      });

      await tx.message.create({
        data: {
          conversationId: convo.id,
          role: "USER",
          content,
          seq: 1,
          createdAt: ts,
        },
      });
    });
  }

  console.log(
    `Seeded user=${user.email}, conversations=${totalConvos} (first 5 share same lastMessageAt).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
