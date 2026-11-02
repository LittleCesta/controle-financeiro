import { Bot, Context } from "grammy";
import { ObjectId } from "mongodb";
import {
  botState,
  client,
  expenses,
  groups,
  outings,
  payments,
  people,
} from "./db";
import { createExpense } from "./expenses";
import { balances, brl, parseMoney } from "./finance";

const token = process.env.TELEGRAM_TOKEN;
const ownerId = Number(process.env.TELEGRAM_OWNER_ID);
if (!token || !ownerId)
  throw new Error("Defina TELEGRAM_TOKEN e TELEGRAM_OWNER_ID no .env");

const bot = new Bot(token);

// Autorização: só o dono, só em conversa privada. Qualquer outra pessoa é ignorada em silêncio.
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ownerId || ctx.chat?.type !== "private") {
    console.log(`Ignorado: usuário ${ctx.from?.id}`);
    return;
  }
  await next();
});

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

// Acha por nome sem ligar para acento/maiúscula; ambíguo ou inexistente vira erro com as opções
function pick<T extends { name: string }>(
  items: T[],
  query: string,
  what: string,
): T {
  const q = norm(query);
  const exact = items.filter((i) => norm(i.name) === q);
  const matches = exact.length
    ? exact
    : items.filter((i) => norm(i.name).startsWith(q));
  if (matches.length !== 1) {
    throw new Error(
      `${what} "${query}" ${matches.length ? "é ambíguo" : "não encontrado"}. Opções: ${items.map((i) => i.name).join(", ")}`,
    );
  }
  return matches[0];
}

async function activeGroup() {
  const st = await botState.findOne({ _id: ownerId });
  const all = await groups.find().toArray();
  let g = all.find((x) => String(x._id) === String(st?.groupId));
  if (!g && all.length === 1) g = all[0];
  if (!g)
    throw new Error(
      `Escolha o grupo com /grupo Nome. Grupos: ${all.map((x) => x.name).join(", ")}`,
    );
  return { g, st };
}

// Cada handler devolve o texto da resposta; erros viram mensagem em vez de derrubar o bot
const reply =
  (fn: (ctx: Context) => Promise<string>) => async (ctx: Context) => {
    try {
      await ctx.reply(await fn(ctx));
    } catch (e) {
      await ctx.reply(`Erro: ${(e as Error).message}`);
    }
  };
const arg = (ctx: Context) => String(ctx.match ?? "");

const HELP = `Registrar gasto:
/gasto Uber 60 pagou:Cesar quem:Cesar,Ana,Bia saida:Sábado

pagou: quem pagou (padrão: o nome definido em /eu)
quem: participantes (padrão: todos). Valor fixo com Nome:valor, ex.: Davi:20
saida: opcional; use aspas se tiver espaço, ex.: saida:"Sábado no bar"

Outros: /grupo Nome, /eu Nome, /saldo`;

bot.command(["start", "ajuda"], (ctx) => ctx.reply(HELP));

bot.command(
  "grupo",
  reply(async (ctx) => {
    const g = pick(await groups.find().toArray(), arg(ctx), "Grupo");
    await botState.updateOne(
      { _id: ownerId },
      { $set: { groupId: g._id } },
      { upsert: true },
    );
    return `Grupo ativo: ${g.name}`;
  }),
);

bot.command(
  "eu",
  reply(async (ctx) => {
    const { g } = await activeGroup();
    const p = pick(
      await people.find({ groupId: g._id }).toArray(),
      arg(ctx),
      "Pessoa",
    );
    await botState.updateOne(
      { _id: ownerId },
      { $set: { meName: p.name } },
      { upsert: true },
    );
    return `Sem "pagou:", o gasto será de ${p.name}.`;
  }),
);

const KV =
  /\b(pagou|quem|saida|saída):\s*("[^"]*"|“[^”]*”|[^\s,]+(?:\s*,\s*[^\s,]+)*)/gi;

bot.command(
  "gasto",
  reply(async (ctx) => {
    // 1) separa os campos chave:valor; o que sobra é descrição + valor
    const opts: Record<string, string> = {};
    const rest = arg(ctx).replace(KV, (_m, k: string, v: string) => {
      opts[norm(k)] = v.replace(/^["“]|["”]$/g, "").replace(/\s*,\s*/g, ",");
      return " ";
    });
    const words = rest.split(/\s+/).filter(Boolean);
    const i = words.findIndex((w) => /^(R\$)?\d+([.,]\d{1,2})?$/.test(w));
    if (i < 0)
      throw new Error(
        "Não achei o valor. Ex.: /gasto Uber 60 pagou:Cesar quem:Cesar,Ana",
      );
    const cents = parseMoney(words[i]);
    const description = words.filter((_, j) => j !== i).join(" ");

    if (/\b(pagou|quem|saida|saída)\s*:/i.test(description)) {
      throw new Error(
        'Não entendi um dos campos. Use campo:valor, ex.: quem:Cesar,Keven saida:"Sábado Varanda"',
      );
    }

    // 2) resolve nomes dentro do grupo ativo
    const { g, st } = await activeGroup();
    const [ppl, outs] = await Promise.all([
      people.find({ groupId: g._id }).toArray(),
      outings.find({ groupId: g._id }).toArray(),
    ]);
    const payerName = opts.pagou ?? st?.meName;
    if (!payerName)
      throw new Error("Informe pagou:Nome (ou defina um padrão com /eu Nome)");
    const payer = pick(ppl, payerName, "Pessoa");
    const parts = opts.quem
      ? opts.quem.split(",").map((item) => {
          const [name, value] = item.split(":");
          return {
            personId: pick(ppl, name, "Pessoa")._id,
            cents: value ? parseMoney(value) : undefined,
          };
        })
      : ppl.map((p) => ({
          personId: p._id,
          cents: undefined as number | undefined,
        }));
    const outing = opts.saida ? pick(outs, opts.saida, "Saída") : undefined;

    // 3) grava pelo mesmo serviço que o site usa
    const shares = await createExpense({
      groupId: g._id,
      description,
      cents,
      paidBy: payer._id,
      outingId: outing?._id,
      parts,
      date: ctx.message ? new Date(ctx.message.date * 1000) : undefined,
    });
    const nameOf = (id: ObjectId) => ppl.find((p) => p._id.equals(id))!.name;
    return `Registrado: ${description || "Gasto"}, ${brl(cents)}, pago por ${payer.name}${outing ? ` (${outing.name})` : ""}.\nDivisão: ${shares.map((s) => `${nameOf(s.personId)} ${brl(s.cents)}`).join("; ")}`;
  }),
);

bot.command(
  "saldo",
  reply(async () => {
    const { g } = await activeGroup();
    const [ppl, exp, pay] = await Promise.all([
      people.find({ groupId: g._id }).toArray(),
      expenses
        .find({ groupId: g._id, deletedAt: { $exists: false } })
        .toArray(),
      payments.find({ groupId: g._id }).toArray(),
    ]);
    const b = balances(exp, pay);
    return (
      ppl
        .map((p) => `${p.name}: ${brl(b.get(String(p._id)) ?? 0)}`)
        .join("\n") || "Sem pessoas no grupo."
    );
  }),
);

bot.catch((err) => console.error("Erro no bot:", err.message));

client
  .connect()
  .then(() => {
    console.log("Bot rodando. Fale com ele no Telegram.");
    return bot.start();
  })
  .catch((err) => {
    console.error("Falha ao iniciar:", err.message);
    process.exit(1);
  });
