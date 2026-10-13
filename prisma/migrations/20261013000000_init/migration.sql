-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('ALBAIT', 'SPECIALIST', 'GENERAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('INDEED', 'X', 'INSTAGRAM', 'LINE');

-- CreateEnum
CREATE TYPE "ApplicantStatus" AS ENUM ('NEW', 'SCREENING', 'PASSED', 'REJECTED', 'PENDING', 'INTERVIEW_SCHEDULED', 'HIRED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "salary" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "snsPostText" JSONB NOT NULL,
    "indeedText" TEXT NOT NULL,
    "lineQuestions" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "lineDisplayName" TEXT,
    "linePictureUrl" TEXT,
    "status" "ApplicantStatus" NOT NULL DEFAULT 'NEW',
    "step" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB,
    "score" INTEGER,
    "evaluation" TEXT,
    "interviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "channelId" TEXT,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "applies" INTEGER NOT NULL DEFAULT 0,
    "hires" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_jobId_idx" ON "Channel"("jobId");

-- CreateIndex
CREATE INDEX "Applicant_lineUserId_idx" ON "Applicant"("lineUserId");

-- CreateIndex
CREATE INDEX "Applicant_jobId_idx" ON "Applicant"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Applicant_jobId_lineUserId_key" ON "Applicant"("jobId", "lineUserId");

-- CreateIndex
CREATE INDEX "Analytics_jobId_idx" ON "Analytics"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Analytics_jobId_channelId_date_key" ON "Analytics"("jobId", "channelId", "date");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

