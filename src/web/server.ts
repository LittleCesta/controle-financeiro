import { client, users } from "../config/db";
import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

client
  .connect()
  .then(() => users.createIndex({ email: 1 }, { unique: true })) // um cadastro por e-mail
  .then(() => app.listen(port, () => console.log(`Servidor em http://localhost:${port}`)))
  .catch((err) => {
    console.error("Não consegui iniciar. Confira o MONGO_URL, a internet e o Network Access do Atlas.");
    console.error(err.message);
    process.exit(1);
  });
