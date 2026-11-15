export const ENVIRONMENT = {
  currentEnv: process.env.NODE_ENV,
  currentEnvPort: process.env.PORT,
  sessionSecret: process.env.SESSION_SECRET,
  telegramBot: {
    token: process.env.TELEGRAM_TOKEN,
    ownerId: Number(process.env.TELEGRAM_OWNER_ID),
    botUserEmail: process.env.BOT_USER_EMAIL,
  },
  mongo: {
    mongoUrl: process.env.MONGO_URL,
  },
};

// Falha cedo, com mensagem clara, em vez de subir quebrado (ex.: apontando para o banco errado)
export function assertEnv(names: string[]) {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(", ")}`);
  }
}
