import { Bot, Context, InputFile } from "grammy";
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
import { loadReportData, renderReportBuffer, reportFileName } from "./report";
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

const HTML = { parse_mode: "HTML" as const };
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Cada handler devolve o texto da resposta; erros viram mensagem em vez de derrubar o bot
const reply =
  (fn: (ctx: Context) => Promise<string>) => async (ctx: Context) => {
    try {
      await ctx.reply(await fn(ctx), HTML);
    } catch (e) {
      await ctx.reply(
        `⚠️ <b>Não consegui</b>\n${esc((e as Error).message)}`,
        HTML,
      );
    }
  };
const arg = (ctx: Context) => String(ctx.match ?? "");

const HELP = `<b>Registrar um gasto</b>
<code>/gasto Uber 60 pagou:Cesar quem:Cesar,Ana,Bia saida:Sábado data:02/11</code>

<b>Campos</b> (opcionais, além da descrição e do valor)
• <b>pagou</b>: quem pagou (padrão: o nome definido em /eu)
• <b>quem</b>: participantes (padrão: todos). Valor fixo: <code>Davi:20</code>
• <b>saida</b>: use aspas se tiver espaço: <code>saida:"Sábado no bar"</code>
• <b>data</b>: <code>02/11</code>, <code>02/11/2026</code> ou <code>ontem</code>. Sem data, vale o dia do envio

<b>Outros comandos</b>
/grupo Nome, /eu Nome, /saldo
/relatorio (envia o PDF de saldos e pagamentos)`;

bot.command(["start", "ajuda"], (ctx) => ctx.reply(HELP, HTML));

bot.command(
  "grupo",
  reply(async (ctx) => {
    const g = pick(await groups.find().toArray(), arg(ctx), "Grupo");
    await botState.updateOne(
      { _id: ownerId },
      { $set: { groupId: g._id } },
      { upsert: true },
    );
    return `📂 Grupo ativo: <b>${esc(g.name)}</b>`;
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
    return `👤 Sem <code>pagou:</code>, o gasto será de <b>${esc(p.name)}</b>.`;
  }),
);

// "02/11", "02/11/2026", "hoje" ou "ontem". Sem data, vale o momento em que a mensagem foi enviada
function parseDate(input: string | undefined, sent: Date): Date {
  if (!input) return sent;
  const t = norm(input);
  const day = new Date(sent);
  day.setHours(12, 0, 0, 0);
  if (t === "hoje") return day;
  if (t === "ontem") {
    day.setDate(day.getDate() - 1);
    return day;
  }
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m)
    throw new Error(
      `Data inválida: "${input}". Use data:02/11, data:02/11/2026 ou data:ontem`,
    );
  const year = m[3]
    ? m[3].length === 2
      ? 2000 + Number(m[3])
      : Number(m[3])
    : sent.getFullYear();
  const out = new Date(year, Number(m[2]) - 1, Number(m[1]), 12);
  if (out.getMonth() !== Number(m[2]) - 1)
    throw new Error(`Essa data não existe: "${input}"`); // ex.: 31/02 viraria março
  // dia/mês sem ano que cairia no futuro: considera o ano anterior
  if (!m[3] && out.getTime() > sent.getTime() + 864e5)
    out.setFullYear(year - 1);
  return out;
}

const KV =
  /\b(pagou|quem|saida|saída|data):\s*("[^"]*"|“[^”]*”|[^\s,]+(?:\s*,\s*[^\s,]+)*)/gi;

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

    if (/\b(pagou|quem|saida|saída|data)\s*:/i.test(description)) {
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

    const sent = ctx.message ? new Date(ctx.message.date * 1000) : new Date();
    const date = parseDate(opts.data, sent);

    // 3) grava pelo mesmo serviço que o site usa
    const shares = await createExpense({
      groupId: g._id,
      description,
      cents,
      paidBy: payer._id,
      outingId: outing?._id,
      parts,
      date,
    });
    const nameOf = (id: ObjectId) => ppl.find((p) => p._id.equals(id))!.name;
    return [
      `✅ <b>${esc(description || "Gasto")}</b> registrado`,
      `💰 ${brl(cents)}, pago por <b>${esc(payer.name)}</b>`,
      ...(outing ? [`🚩 ${esc(outing.name)}`] : []),
      `📅 ${date.toLocaleDateString("pt-BR")}`,
      "",
      "<b>Divisão</b>",
      ...shares.map((s) => `• ${esc(nameOf(s.personId))}: ${brl(s.cents)}`),
    ].join("\n");
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
      payments
        .find({ groupId: g._id, deletedAt: { $exists: false } })
        .toArray(),
    ]);
    const b = balances(exp, pay);
    if (!ppl.length) return "Sem pessoas no grupo.";
    return [
      "<b>Saldos</b>",
      ...ppl.map((p) => {
        const c = b.get(String(p._id)) ?? 0;
        return `${c < 0 ? "🔴" : c > 0 ? "🟢" : "⚪"} ${esc(p.name)}: <b>${brl(c)}</b>`;
      }),
    ].join("\n");
  }),
);

bot.command("relatorio", async (ctx) => {
  try {
    const { g } = await activeGroup();
    const data = await loadReportData(g._id);
    if (!data) throw new Error("Grupo não encontrado");
    const pdf = await renderReportBuffer(data);
    await ctx.replyWithDocument(
      new InputFile(pdf, reportFileName(data.groupName)),
      {
        caption: `📄 Relatório de <b>${esc(data.groupName)}</b>`,
        parse_mode: "HTML",
      },
    );
  } catch (e) {
    await ctx.reply(
      `⚠️ <b>Não consegui</b>\n${esc((e as Error).message)}`,
      HTML,
    );
  }
});

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
