import { Router } from "express";
import { groups, people } from "../../config/db";
import { newToken, requireLogin } from "../auth";
import { h } from "../http";

const router = Router();

router.get(
  "/",
  requireLogin,
  h(async (req, res) => {
    res.render("groups/list", {
      groups: await groups.find({ "members.userId": req.user!._id }).sort({ _id: -1 }).toArray(),
    });
  }),
);

router.post(
  "/groups",
  requireLogin,
  h(async (req, res) => {
    const me = req.user!;
    const { insertedId } = await groups.insertOne({
      name: String(req.body.name).trim(),
      createdAt: new Date(),
      members: [{ userId: me._id, role: "owner" }],
      inviteToken: newToken(),
    });
    // quem cria o grupo já entra como participante das contas, ligado à própria conta
    await people.insertOne({ groupId: insertedId, name: me.name, userId: me._id });
    res.redirect(`/g/${insertedId}`);
  }),
);

export default router;
