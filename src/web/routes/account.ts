import { Router } from "express";
import { users } from "../../config/db";
import { hashPassword, safeNext, startSession, verifyPassword } from "../auth";
import { h } from "../http";

const router = Router();

router.get("/login", (req, res) => {
  res.render("auth/form", { mode: "login", error: "", name: "", email: "", next: safeNext(req.query.next) });
});

router.get("/cadastro", (req, res) => {
  res.render("auth/form", { mode: "register", error: "", name: "", email: "", next: safeNext(req.query.next) });
});

router.post(
  "/login",
  h(async (req, res) => {
    const dest = safeNext(req.body.next);
    const email = String(req.body.email).trim().toLowerCase();
    const user = await users.findOne({ email });
    // mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta
    if (!user || !(await verifyPassword(String(req.body.password), user.passwordHash))) {
      return res.status(401).render("auth/form", { mode: "login", error: "E-mail ou senha incorretos", name: "", email, next: dest });
    }
    await startSession(req, user._id);
    res.redirect(dest);
  }),
);

router.post(
  "/cadastro",
  h(async (req, res) => {
    const dest = safeNext(req.body.next);
    const name = String(req.body.name).trim();
    const email = String(req.body.email).trim().toLowerCase();
    const password = String(req.body.password);
    const fail = (error: string) =>
      res.status(400).render("auth/form", { mode: "register", error, name, email, next: dest });

    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail("Informe um nome e um e-mail válidos");
    if (password.length < 8) return fail("A senha precisa ter pelo menos 8 caracteres");
    try {
      const { insertedId } = await users.insertOne({
        name, email, passwordHash: await hashPassword(password), createdAt: new Date(),
      });
      await startSession(req, insertedId);
      res.redirect(dest);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return fail("Esse e-mail já tem cadastro");
      throw e;
    }
  }),
);

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

export default router;
