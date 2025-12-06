import { Router } from "express";
import healthRoutes from "./health";
import vendorRoutes from "./vendor";
import rfpRoutes from "./rfps";
import proposalRoutes from "./proposals";
import emailRoutes from "./emails";
import webhookRoutes from "./webhooks";

const router = Router();

router.use(healthRoutes);
router.use(vendorRoutes);
router.use(rfpRoutes);
router.use(proposalRoutes);
router.use(emailRoutes);
router.use(webhookRoutes);

export default router;
