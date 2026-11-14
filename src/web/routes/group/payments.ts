import { Router } from "express";
import { ObjectId } from "mongodb";
import { payments } from "../../../config/db";
import { parseMoney } from "../../../domain/finance";
import { h } from "../../http";

const router = Router({ mergeParams: true });

router.post(
  "/payments",
  h(async (req, res) => {
    const cents = parseMoney(String(req.body.amount));
    if (cents <= 0 || req.body.from === req.body.to)
      throw new Error("Pagamento inválido");
    await payments.insertOne({
      groupId: new ObjectId(req.params.id),
      from: new ObjectId(String(req.body.from)),
      to: new ObjectId(String(req.body.to)),
      cents,
      date: new Date(),
    });
    res.redirect(`/g/${req.params.id}`);
  }),
);

// Soft delete também nos pagamentos: o saldo volta ao que era, e o registro fica no banco
router.post(
  "/payments/:pid/delete",
  h(async (req, res) => {
    await payments.updateOne(
      {
        _id: new ObjectId(req.params.pid),
        groupId: new ObjectId(req.params.id),
      },
      { $set: { deletedAt: new Date() } },
    );
    res.redirect(`/g/${req.params.id}`);
  }),
);

export default router;
