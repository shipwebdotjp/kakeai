-- Add the per-appearance Standing Layout (scale / edge / vertical).
ALTER TABLE "CharacterAppearance" ADD COLUMN "standingScale" REAL NOT NULL DEFAULT 1;
ALTER TABLE "CharacterAppearance" ADD COLUMN "standingEdge" TEXT NOT NULL DEFAULT 'margin';
ALTER TABLE "CharacterAppearance" ADD COLUMN "standingVertical" TEXT NOT NULL DEFAULT 'standard';
