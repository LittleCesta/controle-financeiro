import { Router } from "express";
import { ObjectId } from "mongodb";
import {
  groups,
  people,
  outings,
  expenses,
  payments,
  users,
} from "../../../config/db";
import { balances, brl, settle } from "../../../domain/finance";
import { newToken } from "../../auth";
import { paginate } from "../../../domain/pagination";
import { h } from "../../http";

const router = Router({ mergeParams: true });

router.post(
  "/convite/renovar",
  h(async (req, res) => {
    if (req.role !== "owner")
      return res.status(403).send("Só o dono do grupo pode gerar um novo link");
    await groups.updateOne(
      { _id: req.group!._id },
      { $set: { inviteToken: newToken() } },
    );
    res.redirect(`/g/${req.params.id}`);
  }),
);

router.get(
  "/",
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

    const memberUsers = await users
      .find({ _id: { $in: (group.members ?? []).map((m) => m.userId) } })
      .toArray();
    const members = (group.members ?? []).map((m) => ({
      name: memberUsers.find((u) => u._id.equals(m.userId))?.name ?? "?",
      role: m.role,
    }));
    const inviteUrl = group.inviteToken
      ? `${req.protocol}://${req.get("host")}/convite/${group.inviteToken}`
      : "";

    // A paginação só limita o que a lista mostra: saldos, total e resumo usam todos os gastos filtrados
    const pg = paginate(shown, req.query.pagina);
    const pageHref = (p: number) => {
      const q = new URLSearchParams();
      if (outing) q.set("outing", outing);
      q.set("ordem", order);
      if (p > 1) q.set("pagina", String(p));
      return `/g/${group._id}?${q}`;
    };

    res.render("groups/show", {
      group,
      people: ppl,
      outings: outs,
      outing,
      order,
      role: req.role,
      members,
      inviteUrl,
      names,
      outNames,
      brl,
      expenses: pg.items,
      summary: shown,
      page: pg.page,
      pages: pg.pages,
      count: pg.total,
      pageHref,
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

router.post(
  "/people",
  h(async (req, res) => {
    await people.insertOne({
      groupId: new ObjectId(req.params.id),
      name: String(req.body.name).trim(),
    });
    res.redirect(`/g/${req.params.id}`);
  }),
);

router.post(
  "/outings",
  h(async (req, res) => {
    await outings.insertOne({
      groupId: new ObjectId(req.params.id),
      name: String(req.body.name).trim(),
    });
    res.redirect(`/g/${req.params.id}`);
  }),
);

export default router;
