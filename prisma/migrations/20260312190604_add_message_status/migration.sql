-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('GENERATING', 'COMPLETE');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "status" "MessageStatus" NOT NULL DEFAULT 'COMPLETE';
