import { Router } from "express";
import { requireLogin, requireMember } from "../../auth";
import expensesRoutes from "./expenses";
import paymentsRoutes from "./payments";
import reportRoutes from "./report";
import showRoutes from "./show";

// Tudo em /g/:id exige login e participação no grupo (uma guarda só, para não esquecer nenhuma rota)
const router = Router({ mergeParams: true });
router.use(requireLogin, requireMember);
router.use(showRoutes, expensesRoutes, paymentsRoutes, reportRoutes);

export default router;
