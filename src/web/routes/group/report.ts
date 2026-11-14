import { Router } from "express";
import { ObjectId } from "mongodb";
import { loadReportData, renderReport, reportFileName } from "../../../services/report";
import { h } from "../../http";

const router = Router({ mergeParams: true });

// Relatório em PDF: saldos, transferências para quitar e todos os pagamentos registrados
router.get(
  "/relatorio.pdf",
  h(async (req, res) => {
    const data = await loadReportData(new ObjectId(req.params.id));
    if (!data) return res.status(404).send("Grupo não encontrado");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${reportFileName(data.groupName)}"`,
    );
    renderReport(res, data);
  }),
);

export default router;
