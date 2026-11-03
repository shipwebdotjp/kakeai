-- Work-wide output canvas profile. Existing works keep the 16:9 default; a
-- derived "short" Work is created with "portrait".
ALTER TABLE "Work" ADD COLUMN "outputProfile" TEXT NOT NULL DEFAULT 'landscape';
