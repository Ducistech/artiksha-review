-- CreateTable
CREATE TABLE "ReviewImage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewImage_reviewId_idx" ON "ReviewImage"("reviewId");

-- AddForeignKey
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

