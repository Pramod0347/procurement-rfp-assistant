-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "totalPrice" DOUBLE PRECISION,
    "currency" TEXT,
    "deliveryDays" INTEGER,
    "warrantyMonths" INTEGER,
    "terms" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
