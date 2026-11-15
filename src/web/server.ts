import { client, users } from "../config/db";
import { assertEnv, ENVIRONMENT } from "../config/environment";
import { createApp } from "./app";

async function main() {
  // Em produção, falha cedo em vez de subir apontando para o banco errado
  if (ENVIRONMENT.currentEnv === "production") {
    assertEnv(["MONGO_URL", "SESSION_SECRET"]);
  }

  const app = createApp();
  const port = Number(ENVIRONMENT.currentEnvPort) || 3000;

  // Necessário atrás de Nginx/Cloudflare/proxy com HTTPS: o cookie "secure" depende disso
  if (ENVIRONMENT.currentEnv === "production") app.set("trust proxy", 1);

  // Healthcheck do Docker: só responde "ok" se o banco também responde
  app.get("/health", async (_req, res) => {
    try {
      await client.db().command({ ping: 1 });
      res.status(200).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "banco indisponível" });
    }
  });

  await client.connect();

  // Um cadastro por e-mail: o cadastro depende deste índice para recusar repetidos
  try {
    await users.createIndex({ email: 1 }, { unique: true });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new Error(
        "Existem e-mails repetidos em users. Remova os duplicados e reinicie.",
      );
    }
    throw err;
  }

  const server = app.listen(port, "0.0.0.0", () =>
    console.log(`Servidor web ativo em http://localhost:${port}`),
  );

  const shutdown = (signal: string) => {
    console.log(`Recebido ${signal}. Encerrando servidor web...`);
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref(); // conexão presa: força a saída
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err.message);
  process.exit(1);
});
