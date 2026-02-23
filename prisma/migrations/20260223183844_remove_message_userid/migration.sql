/*
  Warnings:

  - You are about to drop the column `userId` on the `Message` table. All the data in the column will be lost.
  - Made the column `lastMessageAt` on table `Conversation` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_userId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "lastMessageAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "userId";
