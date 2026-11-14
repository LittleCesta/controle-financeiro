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
