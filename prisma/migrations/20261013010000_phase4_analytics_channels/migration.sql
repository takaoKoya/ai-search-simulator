-- Analytics.channelId becomes required. Nothing wrote Analytics rows before this
-- migration, so any NULL-channel rows can be discarded safely.
DELETE FROM "Analytics" WHERE "channelId" IS NULL;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelType" ADD VALUE 'TIKTOK';
ALTER TYPE "ChannelType" ADD VALUE 'DIRECT';

-- DropForeignKey
ALTER TABLE "Analytics" DROP CONSTRAINT "Analytics_channelId_fkey";

-- AlterTable
ALTER TABLE "Channel" ALTER COLUMN "content" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Applicant" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "interviewConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "statusManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Analytics" DROP COLUMN "clicks",
DROP COLUMN "hires",
ADD COLUMN     "interviews" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "channelId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_jobId_type_key" ON "Channel"("jobId", "type");

-- CreateIndex
CREATE INDEX "Applicant_channelId_idx" ON "Applicant"("channelId");

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

