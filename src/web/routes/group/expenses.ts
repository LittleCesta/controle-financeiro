import { Router } from "express";
import { ObjectId } from "mongodb";
import { groups, people, outings, expenses } from "../../../config/db";
import { parseMoney } from "../../../domain/finance";
import { createExpense, updateExpense, type NewExpense } from "../../../services/expenses";
import { h } from "../../http";

const router = Router({ mergeParams: true });

// Lê o formulário de gasto (usado ao criar e ao editar)
function expenseFromForm(
  gid: ObjectId,
  b: Record<string, string | string[]>,
): NewExpense {
  const ids = ([] as string[]).concat(b.participants ?? []);
  return {
    groupId: gid,
    description: String(b.description),
    cents: parseMoney(String(b.amount)),
    paidBy: new ObjectId(String(b.paidBy)),
    outingId: b.outingId ? new ObjectId(String(b.outingId)) : undefined,
    date: new Date(`${b.date}T12:00:00`), // meio-dia evita virar o dia por fuso horário
    parts: ids.map((id) => {
      const raw = String(b[`custom_${id}`] ?? "").trim();
      return {
        personId: new ObjectId(id),
        cents: raw ? parseMoney(raw) : undefined,
      };
    }),
  };
}

router.post(
  "/expenses",
  h(async (req, res) => {
    const gid = new ObjectId(req.params.id);
    const b = req.body as Record<string, string | string[]>;
    await createExpense(expenseFromForm(gid, b));
    res.redirect(`/g/${gid}${b.outingId ? `?outing=${b.outingId}` : ""}`);
  }),
);

router.get(
  "/expenses/:eid/edit",
  h(async (req, res) => {
    const gid = new ObjectId(req.params.id);
    const [group, expense, ppl, outs] = await Promise.all([
      groups.findOne({ _id: gid }),
      expenses.findOne({
        _id: new ObjectId(req.params.eid),
        groupId: gid,
        deletedAt: { $exists: false },
      }),
      people.find({ groupId: gid }).sort({ name: 1 }).toArray(),
      outings.find({ groupId: gid }).sort({ _id: -1 }).toArray(),
    ]);
    if (!group || !expense) return res.status(404).send("Gasto não encontrado");
    res.render("expenses/edit", { group, expense, people: ppl, outings: outs });
  }),
);

router.post(
  "/expenses/:eid/edit",
  h(async (req, res) => {
    const gid = new ObjectId(req.params.id);
    await updateExpense(
      new ObjectId(req.params.eid),
      expenseFromForm(gid, req.body),
    );
    res.redirect(`/g/${gid}`);
  }),
);

// Soft delete: o gasto some dos saldos, mas continua no banco
router.post(
  "/expenses/:eid/delete",
  h(async (req, res) => {
    await expenses.updateOne(
      {
        _id: new ObjectId(req.params.eid),
        groupId: new ObjectId(req.params.id),
      },
      { $set: { deletedAt: new Date() } },
    );
    res.redirect(`/g/${req.params.id}`);
  }),
);

export default router;
