// src/proposalScoring.ts
import { Proposal, Vendor, Rfp } from "@prisma/client";

export type ProposalWithVendor = Proposal & { vendor: Vendor };

export type ProposalScoreBreakdown = {
  priceScore: number;      // 0–1
  deliveryScore: number;   // 0–1
  warrantyScore: number;   // 0–1
  totalScore: number;      // weighted sum
};

export type ProposalWithScores = ProposalWithVendor & {
  scores: ProposalScoreBreakdown;
};

export type RfpComparisonResult = {
  rfpId: string;
  rfpTitle: string;
  currency: string | null;
  criteriaWeights: {
    price: number;
    delivery: number;
    warranty: number;
  };
  proposals: ProposalWithScores[];
  bestProposalId: string | null;
};

export function compareProposalsForRfp(
  rfp: Rfp,
  proposals: ProposalWithVendor[]
): RfpComparisonResult {
  if (proposals.length === 0) {
    return {
      rfpId: rfp.id,
      rfpTitle: rfp.title,
      currency: rfp.currency ?? null,
      criteriaWeights: { price: 0.6, delivery: 0.25, warranty: 0.15 },
      proposals: [],
      bestProposalId: null,
    };
  }

  const weights = {
    price: 0.45,
    delivery: 0.35,
    warranty: 0.20,
  };

  const filtered = rfp.currency
    ? proposals.filter(p => p.currency === rfp.currency)
    : proposals;

  const effectiveProposals = filtered.length > 0 ? filtered : proposals;

  const prices = effectiveProposals
    .map(p => p.totalPrice)
    .filter((pr): pr is number => pr !== null);
  const deliveries = effectiveProposals
    .map(p => p.deliveryDays ?? null)
    .filter((d): d is number => d !== null);
  const warranties = effectiveProposals
    .map(p => p.warrantyMonths ?? null)
    .filter((w): w is number => w !== null);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minDelivery = deliveries.length ? Math.min(...deliveries) : null;
  const maxDelivery = deliveries.length ? Math.max(...deliveries) : null;
  const minWarranty = warranties.length ? Math.min(...warranties) : null;
  const maxWarranty = warranties.length ? Math.max(...warranties) : null;

  const scored: ProposalWithScores[] = effectiveProposals.map(p => {
    // price: lower is better (missing = neutral 0.5)
    let priceScore = 0.5;
    if (p.totalPrice != null && prices.length > 0) {
      if (maxPrice === minPrice) {
        priceScore = 1;
      } else {
        priceScore = (maxPrice - p.totalPrice) / (maxPrice - minPrice);
      }
    }

    // delivery: lower is better (missing = neutral 0.5)
    let deliveryScore = 0.5;
    if (p.deliveryDays != null && minDelivery != null && maxDelivery != null) {
      if (maxDelivery === minDelivery) {
        deliveryScore = 1;
      } else {
        deliveryScore =
          (maxDelivery - p.deliveryDays) / (maxDelivery - minDelivery);
      }
    }

    // warranty: higher is better (missing = neutral 0.5)
    let warrantyScore = 0.5;
    if (
      p.warrantyMonths != null &&
      minWarranty != null &&
      maxWarranty != null
    ) {
      if (maxWarranty === minWarranty) {
        warrantyScore = 1;
      } else {
        warrantyScore =
          (p.warrantyMonths - minWarranty) / (maxWarranty - minWarranty);
      }
    }

    const totalScore =
      priceScore * weights.price +
      deliveryScore * weights.delivery +
      warrantyScore * weights.warranty;

    return {
      ...p,
      scores: {
        priceScore,
        deliveryScore,
        warrantyScore,
        totalScore,
      },
    };
  });

  scored.sort((a, b) => b.scores.totalScore - a.scores.totalScore);

  return {
    rfpId: rfp.id,
    rfpTitle: rfp.title,
    currency: rfp.currency ?? null,
    criteriaWeights: weights,
    proposals: scored,
    bestProposalId: scored[0]?.id ?? null,
  };
}
