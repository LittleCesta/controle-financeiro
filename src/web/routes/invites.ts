import { Router } from "express";
import { ObjectId } from "mongodb";
import { groups, people } from "../../config/db";
import { requireLogin } from "../auth";
import { h } from "../http";

const router = Router();

router.get(
  "/convite/:token",
  requireLogin,
  h(async (req, res) => {
    const group = await groups.findOne({ inviteToken: req.params.token });
    if (!group) return res.status(404).send("Convite inválido ou expirado");
    if (group.members?.some((m) => m.userId.equals(req.user!._id))) return res.redirect(`/g/${group._id}`);
    const free = await people.find({ groupId: group._id, userId: { $exists: false } }).sort({ name: 1 }).toArray();
    res.render("groups/join", { group, free });
  }),
);

router.post(
  "/convite/:token",
  requireLogin,
  h(async (req, res) => {
    const me = req.user!;
    const group = await groups.findOne({ inviteToken: req.params.token });
    if (!group) return res.status(404).send("Convite inválido ou expirado");
    if (group.members?.some((m) => m.userId.equals(me._id))) return res.redirect(`/g/${group._id}`);

    const chosen = String(req.body.person ?? "");
    if (chosen && chosen !== "new") {
      // só vincula se a pessoa ainda estiver livre: duas contas nunca ficam na mesma pessoa
      const r = await people.updateOne(
        { _id: new ObjectId(chosen), groupId: group._id, userId: { $exists: false } },
        { $set: { userId: me._id } },
      );
      if (!r.matchedCount) throw new Error("Essa pessoa já foi vinculada a outra conta");
    } else {
      await people.insertOne({ groupId: group._id, name: me.name, userId: me._id });
    }
    await groups.updateOne({ _id: group._id }, { $push: { members: { userId: me._id, role: "member" } } });
    res.redirect(`/g/${group._id}`);
  }),
);

export default router;
