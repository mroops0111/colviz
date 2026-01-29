/*
  Warnings:

  - You are about to drop the `Actor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Dataset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Interaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RawItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Source` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Actor";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Dataset";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Interaction";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RawItem";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Source";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "actors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attributes_json" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "actors_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "raw_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset_id" TEXT NOT NULL,
    "source_id" INTEGER NOT NULL,
    "source_item_type" TEXT NOT NULL,
    "source_item_id" TEXT NOT NULL,
    "occurred_at" DATETIME,
    "author_actor_id" TEXT,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_format" TEXT NOT NULL DEFAULT 'plain',
    "payload_json" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_items_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "raw_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "raw_items_author_actor_id_fkey" FOREIGN KEY ("author_actor_id") REFERENCES "actors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset_id" TEXT NOT NULL,
    "raw_item_id" TEXT,
    "source_id" INTEGER NOT NULL,
    "occurred_at" DATETIME NOT NULL,
    "date" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "behavior" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "team_id" TEXT,
    "from_actor_id" TEXT NOT NULL,
    "to_actor_id" TEXT NOT NULL,
    "attributes_json" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interactions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "interactions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "interactions_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "interactions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "actors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "interactions_from_actor_id_fkey" FOREIGN KEY ("from_actor_id") REFERENCES "actors" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "interactions_to_actor_id_fkey" FOREIGN KEY ("to_actor_id") REFERENCES "actors" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "datasets_name_key" ON "datasets"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sources_key_key" ON "sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "actors_dataset_id_actor_key_key" ON "actors"("dataset_id", "actor_key");

-- CreateIndex
CREATE INDEX "raw_items_dataset_id_occurred_at_idx" ON "raw_items"("dataset_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_items_dataset_id_source_id_source_item_type_source_item_id_key" ON "raw_items"("dataset_id", "source_id", "source_item_type", "source_item_id");

-- CreateIndex
CREATE INDEX "interactions_dataset_id_occurred_at_idx" ON "interactions"("dataset_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_dataset_id_behavior_occurred_at_idx" ON "interactions"("dataset_id", "behavior", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_dataset_id_team_id_occurred_at_idx" ON "interactions"("dataset_id", "team_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_dataset_id_from_actor_id_to_actor_id_behavior_occurred_at_idx" ON "interactions"("dataset_id", "from_actor_id", "to_actor_id", "behavior", "occurred_at");
