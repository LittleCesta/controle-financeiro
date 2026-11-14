import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "node:path";
import { client } from "../config/db";
import accountRoutes from "./routes/account";
import groupRoutes from "./routes/group";
import homeRoutes from "./routes/home";
import inviteRoutes from "./routes/invites";

// O store da sessão é um parâmetro: em produção é o MongoDB, nos testes é a memória
export function createApp(
  store: session.Store = MongoStore.create({
    client,
    dbName: "divisao_gastos",
    collectionName: "sessions",
  }),
) {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../../views"));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, "../../public")));

  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("Defina SESSION_SECRET no .env");
  }
  // Sessões ficam no MongoDB (coleção "sessions", com expiração automática)
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dev-apenas-local",
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(accountRoutes);
  app.use(homeRoutes);
  app.use(inviteRoutes);
  app.use("/g/:id", groupRoutes);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).type("text").send(`Erro: ${err.message}`);
  });

  return app;
}
