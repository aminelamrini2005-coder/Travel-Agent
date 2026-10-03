-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "currentParams" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "searchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Search" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "params" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "containsMock" BOOLEAN NOT NULL,
    "journeyCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCallLog" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Search_createdAt_idx" ON "Search"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderCallLog_providerId_createdAt_idx" ON "ProviderCallLog"("providerId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Search" ADD CONSTRAINT "Search_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCallLog" ADD CONSTRAINT "ProviderCallLog_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;
