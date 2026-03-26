-- CreateEnum
CREATE TYPE "NicheRunStatus" AS ENUM ('pending', 'running', 'stopping', 'stopped', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "NicheRunStage" AS ENUM ('discovering_pages', 'processing_schools', 'exporting_csv', 'syncing_hubspot', 'enrolling_sequence', 'stopped', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "NicheSchoolStatus" AS ENUM ('pending', 'processing', 'completed', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "NicheRun" (
    "id" TEXT NOT NULL,
    "searchUrl" TEXT NOT NULL,
    "normalizedSearchUrl" TEXT NOT NULL,
    "outputFile" TEXT NOT NULL,
    "pageBatchSize" INTEGER NOT NULL DEFAULT 1,
    "maxSchools" INTEGER,
    "sequenceId" INTEGER,
    "senderEmail" TEXT,
    "status" "NicheRunStatus" NOT NULL DEFAULT 'pending',
    "stage" "NicheRunStage" NOT NULL DEFAULT 'discovering_pages',
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "currentPage" INTEGER NOT NULL DEFAULT 1,
    "nextPage" INTEGER NOT NULL DEFAULT 1,
    "totalPages" INTEGER,
    "lastCompletedPage" INTEGER NOT NULL DEFAULT 0,
    "schoolsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "schoolsProcessed" INTEGER NOT NULL DEFAULT 0,
    "schoolsCompleted" INTEGER NOT NULL DEFAULT 0,
    "schoolsSkipped" INTEGER NOT NULL DEFAULT 0,
    "contactsExtracted" INTEGER NOT NULL DEFAULT 0,
    "hubspotSynced" INTEGER NOT NULL DEFAULT 0,
    "hubspotFailed" INTEGER NOT NULL DEFAULT 0,
    "sequenceEnrolled" INTEGER NOT NULL DEFAULT 0,
    "sequenceFailed" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "NicheRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NicheSchool" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "nicheSchoolUrl" TEXT NOT NULL,
    "schoolName" TEXT,
    "officialWebsite" TEXT,
    "status" "NicheSchoolStatus" NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "errorMessage" TEXT,
    "contactsFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NicheSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NicheContact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "schoolId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "schoolName" TEXT,
    "schoolDomain" TEXT,
    "schoolPhone" TEXT,
    "schoolState" TEXT,
    "csvExportedAt" TIMESTAMP(3),
    "hubspotStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "hubspotContactId" TEXT,
    "hubspotAction" TEXT,
    "hubspotError" TEXT,
    "hubspotProcessedAt" TIMESTAMP(3),
    "sequenceStatus" "SyncStatus" NOT NULL DEFAULT 'pending',
    "sequenceError" TEXT,
    "sequenceProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NicheContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NicheRun_normalizedSearchUrl_status_idx" ON "NicheRun"("normalizedSearchUrl", "status");

-- CreateIndex
CREATE INDEX "NicheRun_status_updatedAt_idx" ON "NicheRun"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NicheSchool_runId_nicheSchoolUrl_key" ON "NicheSchool"("runId", "nicheSchoolUrl");

-- CreateIndex
CREATE INDEX "NicheSchool_runId_pageNumber_status_idx" ON "NicheSchool"("runId", "pageNumber", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NicheContact_runId_email_key" ON "NicheContact"("runId", "email");

-- CreateIndex
CREATE INDEX "NicheContact_runId_hubspotStatus_idx" ON "NicheContact"("runId", "hubspotStatus");

-- CreateIndex
CREATE INDEX "NicheContact_runId_sequenceStatus_idx" ON "NicheContact"("runId", "sequenceStatus");

-- AddForeignKey
ALTER TABLE "NicheRun" ADD CONSTRAINT "NicheRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheSchool" ADD CONSTRAINT "NicheSchool_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NicheRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheContact" ADD CONSTRAINT "NicheContact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NicheRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NicheContact" ADD CONSTRAINT "NicheContact_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "NicheSchool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
