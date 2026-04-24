/*
  Warnings:

  - A unique constraint covering the columns `[storagePath]` on the table `FileAsset` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `FieldMapping` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `SurveyQuestion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `SurveyVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FieldMapping" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "SurveyQuestion" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "SurveyVersion" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "ExtractionJob_batchId_idx" ON "ExtractionJob"("batchId");

-- CreateIndex
CREATE INDEX "ExtractionJob_status_idx" ON "ExtractionJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_storagePath_key" ON "FileAsset"("storagePath");

-- CreateIndex
CREATE INDEX "SurveyQuestion_surveyVersionId_displayOrder_idx" ON "SurveyQuestion"("surveyVersionId", "displayOrder");

-- CreateIndex
CREATE INDEX "SurveyResponse_questionId_idx" ON "SurveyResponse"("questionId");
