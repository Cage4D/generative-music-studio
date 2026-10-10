-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "patterns" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT,
    "generatorId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "remixCount" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentId" UUID,

    CONSTRAINT "patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patterns_slug_key" ON "patterns"("slug");

-- CreateIndex
CREATE INDEX "patterns_createdAt_id_idx" ON "patterns"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "patterns_playCount_id_idx" ON "patterns"("playCount" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "patterns_parentId_idx" ON "patterns"("parentId");

-- AddForeignKey
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

