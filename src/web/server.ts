import path from "node:path";
import mongoose from "mongoose";
import { createApp } from "./app"; // ajuste conforme sua exportação
import { ENVIRONMENT } from "../config/environment";

const app = createApp();

// Necessário quando rodar atrás de Nginx/Cloudflare/proxy com HTTPS
if (ENVIRONMENT.currentEnv === "production") {
  app.set("trust proxy", 1);
}

// Garante resolução correta de views e assets após compilar para dist/
app.set("views", path.join(process.cwd(), "views"));

// Rota leve para o healthcheck do Docker
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const port = Number(ENVIRONMENT.currentEnvPort);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor web ativo http://localhost:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Recebido ${signal}. Encerrando servidor web...`);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });

  // Força encerramento caso alguma conexão fique presa após 8s
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
