// Uso: npm run claim -- seu@email.com
// Atribui à sua conta os grupos criados antes do login existir (sem membros).
import { newToken } from "../web/auth";
import { client, groups, people, users } from "../config/db";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npm run claim -- seu@email.com");
  await client.connect();
  const me = await users.findOne({ email });
  if (!me) throw new Error("Conta não encontrada. Cadastre-se no site primeiro.");

  const orphans = await groups.find({ members: { $exists: false } }).toArray();
  for (const g of orphans) {
    await groups.updateOne(
      { _id: g._id },
      { $set: { members: [{ userId: me._id, role: "owner" }], inviteToken: newToken() } },
    );
    // liga você à pessoa de mesmo nome dentro do grupo, se existir e estiver livre
    await people.updateOne(
      { groupId: g._id, name: me.name, userId: { $exists: false } },
      { $set: { userId: me._id } },
    );
  }
  console.log(`${orphans.length} grupo(s) agora pertencem a ${me.name}.`);
  await client.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
