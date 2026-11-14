import crypto from "node:crypto";
import type { Request, RequestHandler } from "express";
import { ObjectId, type WithId } from "mongodb";
import { groups, users } from "../config/db";
import type { Group, User } from "../domain/finance";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}
declare global {
  namespace Express {
    interface Request {
      user?: WithId<User>;
      group?: WithId<Group>;
      role?: "owner" | "member";
    }
  }
}

const scrypt = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );

// scrypt vem no próprio Node (sem dependência nativa para compilar no Windows).
// Cada senha tem um sal aleatório; guardamos "sal:hash".
export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${(await scrypt(pw, salt)).toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(pw, Buffer.from(salt, "hex"));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const newToken = () => crypto.randomBytes(24).toString("base64url");

// Só aceita caminhos internos como destino pós-login (evita redirecionar para site de terceiros).
// A barra invertida é recusada porque os navegadores a tratam como "/": "/\\evil.com" viraria "//evil.com".
export const safeNext = (v: unknown) =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";

// Troca o id da sessão ao logar, o que impede fixação de sessão
export const startSession = (req: Request, userId: ObjectId) =>
  new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(userId);
      req.session.save((e) => (e ? reject(e) : resolve()));
    }),
  );

export const requireLogin: RequestHandler = async (req, res, next) => {
  try {
    const id = req.session.userId;
    const user = id ? await users.findOne({ _id: new ObjectId(id) }) : null;
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    req.user = user;
    res.locals.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

// Protege tudo em /g/:id: quem não é membro recebe 404, como se o grupo não existisse
export const requireMember: RequestHandler = async (req, res, next) => {
  try {
    const group = await groups.findOne({
      _id: new ObjectId(req.params.id),
      "members.userId": req.user!._id,
    });
    if (!group) return res.status(404).send("Grupo não encontrado");
    req.group = group;
    req.role = group.members?.find((m) => m.userId.equals(req.user!._id))?.role;
    next();
  } catch (e) {
    next(e);
  }
};
