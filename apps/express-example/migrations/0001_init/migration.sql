-- Prisma Migrate's layout (migrations/<name>/migration.sql), which the PGlite twin applies at boot.
CREATE TABLE "Counter" (
    "id" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);
