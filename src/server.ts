import express, { NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { balances, brl, parseMoney, settle } from "./finance";
import { createExpense, updateExpense, type NewExpense } from "./expenses";
import { loadReportData, renderReport, reportFileName } from "./report";
import { client, groups, people, outings, expenses, payments } from "./db";

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "../public")));

// Express 4 não captura erros de funções async sozinho
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

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

app.get(
  "/",
  h(async (_req, res) => {
    res.render("index", {
      groups: await groups.find().sort({ _id: -1 }).toArray(),
    });
  }),
);

app.post(
  "/groups",
  h(async (req, res) => {
    const { insertedId } = await groups.insertOne({
      name: String(req.body.name).trim(),
      createdAt: new Date(),
    });
    res.redirect(`/g/${insertedId}`);
  }),
);

app.get(
  "/g/:id",
  h(async (req, res) => {
    const gid = new ObjectId(req.params.id);
    const group = await groups.findOne({ _id: gid });
    if (!group) return res.status(404).send("Grupo não encontrado");

    const order = req.query.ordem === "asc" ? "asc" : "desc";
    const dir = order === "asc" ? 1 : -1;

    const [ppl, outs, all, pays] = await Promise.all([
      people.find({ groupId: gid }).sort({ name: 1 }).toArray(),
      outings.find({ groupId: gid }).sort({ _id: -1 }).toArray(),
      expenses
        .find({ groupId: gid, deletedAt: { $exists: false } })
        .sort({ date: dir, _id: dir }) // _id desempata gastos do mesmo dia
        .toArray(),
      payments
        .find({ groupId: gid, deletedAt: { $exists: false } })
        .sort({ date: -1 })
        .toArray(),
    ]);

    const names = new Map(ppl.map((p) => [String(p._id), p.name]));
    const outNames = new Map(outs.map((o) => [String(o._id), o.name]));
    const outing = typeof req.query.outing === "string" ? req.query.outing : "";
    // O filtro por saída só muda o que é LISTADO; o saldo é sempre do grupo inteiro
    const shown = outing
      ? all.filter((e) => String(e.outingId) === outing)
      : all;
    const bal = balances(all, pays);

    res.render("group", {
      group,
      people: ppl,
      outings: outs,
      outing,
      order,
      names,
      outNames,
      brl,
      expenses: shown,
      total: shown.reduce((s, e) => s + e.cents, 0),
      balances: ppl.map((p) => ({
        name: p.name,
        cents: bal.get(String(p._id)) ?? 0,
      })),
      transfers: settle(bal).map((t) => ({
        ...t,
        fromName: names.get(t.from),
        toName: names.get(t.to),
      })),
      payments: pays.slice(0, 10),
      today: new Date().toISOString().slice(0, 10),
    });
  }),
);

app.post(
  "/g/:id/people",
  h(async (req, res) => {
    await people.insertOne({
      groupId: new ObjectId(req.params.id),
      name: String(req.body.name).trim(),
    });
    res.redirect(`/g/${req.params.id}`);
  }),
);

app.post(
  "/g/:id/outings",
  h(async (req, res) => {
    await outings.insertOne({
      groupId: new ObjectId(req.params.id),
      name: String(req.body.name).trim(),
    });
    res.redirect(`/g/${req.params.id}`);
  }),
);

app.post(
  "/g/:id/expenses",
  h(async (req, res) => {
    const gid = new ObjectId(req.params.id);
    const b = req.body as Record<string, string | string[]>;
    await createExpense(expenseFromForm(gid, b));
    res.redirect(`/g/${gid}${b.outingId ? `?outing=${b.outingId}` : ""}`);
  }),
);

app.get(
  "/g/:id/expenses/:eid/edit",
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
    res.render("edit-expense", { group, expense, people: ppl, outings: outs });
  }),
);

app.post(
  "/g/:id/expenses/:eid/edit",
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
app.post(
  "/g/:id/expenses/:eid/delete",
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

app.post(
  "/g/:id/payments",
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
app.post(
  "/g/:id/payments/:pid/delete",
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

// Relatório em PDF: saldos, transferências para quitar e todos os pagamentos registrados
app.get(
  "/g/:id/relatorio.pdf",
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).type("text").send(`Erro: ${err.message}`);
});

const port = Number(process.env.PORT ?? 3000);
client
  .connect()
  .then(() =>
    app.listen(port, () => console.log("Conectando em: http://localhost:3000")),
  )
  .catch((err) => {
    console.error(
      "Não consegui conectar ao MongoDB. Ele está rodando? (docker compose up -d)",
    );
    console.error(err.message);
    process.exit(1);
  });
