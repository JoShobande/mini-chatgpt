import { prisma } from "../db";

async function main() {
  const user = await prisma.user.create({
    data: {
      email: "josephine@test.com",
    },
  });

  console.log("Created user:", user);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
