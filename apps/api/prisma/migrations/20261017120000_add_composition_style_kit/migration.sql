-- AlterTable
ALTER TABLE "CompositionDraft" ADD COLUMN "authoringStyleJson" TEXT;

-- AlterTable
ALTER TABLE "CompositionVersion" ADD COLUMN "styleProvenanceJson" TEXT;
