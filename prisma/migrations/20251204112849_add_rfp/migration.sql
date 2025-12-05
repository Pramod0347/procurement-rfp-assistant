-- CreateTable
CREATE TABLE "Rfp" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "naturalLanguageInput" TEXT NOT NULL,
    "structuredSpec" JSONB NOT NULL,
    "budget" DOUBLE PRECISION,
    "currency" TEXT,
    "deliveryDeadline" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "minimumWarrantyMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfp_pkey" PRIMARY KEY ("id")
);
