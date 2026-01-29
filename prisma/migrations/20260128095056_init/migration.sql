-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Source" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attributesJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Actor_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RawItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "sourceItemType" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "authorActorId" TEXT,
    "title" TEXT,
    "contentText" TEXT NOT NULL,
    "contentFormat" TEXT NOT NULL DEFAULT 'plain',
    "payloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawItem_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RawItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RawItem_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "Actor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "rawItemId" TEXT,
    "sourceId" INTEGER NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "date" TEXT NOT NULL,
    "stage" INTEGER,
    "scope" TEXT NOT NULL,
    "behavior" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "teamActorId" TEXT,
    "fromActorId" TEXT NOT NULL,
    "toActorId" TEXT NOT NULL,
    "attributesJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Interaction_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_rawItemId_fkey" FOREIGN KEY ("rawItemId") REFERENCES "RawItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_teamActorId_fkey" FOREIGN KEY ("teamActorId") REFERENCES "Actor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_fromActorId_fkey" FOREIGN KEY ("fromActorId") REFERENCES "Actor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_toActorId_fkey" FOREIGN KEY ("toActorId") REFERENCES "Actor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_name_key" ON "Dataset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Actor_datasetId_actorKey_key" ON "Actor"("datasetId", "actorKey");

-- CreateIndex
CREATE INDEX "RawItem_datasetId_occurredAt_idx" ON "RawItem"("datasetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawItem_datasetId_sourceId_sourceItemType_sourceItemId_key" ON "RawItem"("datasetId", "sourceId", "sourceItemType", "sourceItemId");

-- CreateIndex
CREATE INDEX "Interaction_datasetId_occurredAt_idx" ON "Interaction"("datasetId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_datasetId_behavior_occurredAt_idx" ON "Interaction"("datasetId", "behavior", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_datasetId_teamActorId_occurredAt_idx" ON "Interaction"("datasetId", "teamActorId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_datasetId_fromActorId_toActorId_behavior_occurredAt_idx" ON "Interaction"("datasetId", "fromActorId", "toActorId", "behavior", "occurredAt");
