import { randomBytes } from "node:crypto";
import { Api, Bot, Context, InlineKeyboard } from "grammy";
import type { ObjectId } from "mongodb";
import { brl, type Share } from "../domain/finance";
import { applyAction, cardText, type Draft, type Screen } from "./draft";

export interface WizardDeps {
  activeGroup: () => Promise<{
    g: { _id: ObjectId };
    st: { meName?: string } | null;
  }>;
  getMe: () => Promise<{ _id: ObjectId }>;
  load: (groupId: ObjectId) => Promise<{
    people: { _id: ObjectId; name: string; userId?: ObjectId }[];
    outings: { _id: ObjectId; name: string }[];
  }>;
  save: (e: {
    groupId: ObjectId;
    description: string;
    cents: number;
    paidBy: ObjectId;
    outingId?: ObjectId;
    date: Date;
    parts: { personId: ObjectId }[];
  }) => Promise<Share[]>;
  parseDate: (input: string | undefined, sent: Date) => Date;
  esc: (s: string) => string;
  norm: (s: string) => string;
}

const TTL = 30 * 60 * 1000;
const HTML = { parse_mode: "HTML" as const };

// Assistente de /gasto com botões: um único cartão que se edita a cada toque.
// Os rascunhos ficam em memória (se o bot reiniciar, basta enviar /gasto de novo).
export function createWizard(deps: WizardDeps) {
  const drafts = new Map<string, Draft>();
  let awaitingDate: string | null = null;

  function keyboard(d: Draft, screen: Screen) {
    const kb = new InlineKeyboard();
    const cb = (a: string) => `d:${d.id}:${a}`;
    if (screen === "main") {
      d.people.forEach((p, i) => {
        kb.text(`${d.on.has(i) ? "✅" : "⬜"} ${p.name}`, cb(`t:${i}`));
        if (i % 2 === 1) kb.row();
      });
      kb.row()
        .text("👤 Quem pagou", cb("pay"))
        .text("🚩 Saída", cb("out"))
        .text("📅 Data", cb("dt"))
        .row()
        .text("Todos", cb("all"))
        .text("✅ Confirmar", cb("ok"))
        .text("✖ Cancelar", cb("no"));
    } else if (screen === "pay") {
      d.people.forEach((p, i) => {
        kb.text(`${d.payer === i ? "● " : ""}${p.name}`, cb(`p:${i}`));
        if (i % 2 === 1) kb.row();
      });
      kb.row().text("← Voltar", cb("back"));
    } else if (screen === "out") {
      kb.text(d.outing === null ? "● Nenhuma" : "Nenhuma", cb("o:x")).row();
      d.outings.forEach((o, i) =>
        kb.text(`${d.outing === i ? "● " : ""}${o.name}`, cb(`o:${i}`)).row(),
      );
      kb.text("← Voltar", cb("back"));
    } else {
      kb.text("Hoje", cb("dd:0"))
        .text("Ontem", cb("dd:1"))
        .row()
        .text("2 dias atrás", cb("dd:2"))
        .text("3 dias atrás", cb("dd:3"))
        .row()
        .text("Outra data…", cb("dx"))
        .row()
        .text("← Voltar", cb("back"));
    }
    return kb;
  }

  async function render(api: Api, d: Draft, screen: Screen, note?: string) {
    try {
      await api.editMessageText(
        d.chatId,
        d.messageId,
        cardText(d, deps.esc, note),
        {
          ...HTML,
          reply_markup: keyboard(d, screen),
        },
      );
    } catch (e) {
      if (!/not modified/i.test(String((e as Error).message))) throw e; // toque que não mudou nada
    }
  }

  async function start(
    ctx: Context,
    input: { description: string; cents: number; sent: Date },
  ) {
    const now = Date.now();
    for (const [k, v] of drafts) if (v.expires < now) drafts.delete(k);

    const { g, st } = await deps.activeGroup();
    const [{ people, outings }, me] = await Promise.all([
      deps.load(g._id),
      deps.getMe(),
    ]);
    if (!people.length)
      throw new Error("Esse grupo ainda não tem pessoas cadastradas.");

    // quem paga por padrão: a pessoa ligada à sua conta; senão, o nome definido em /eu
    const mine = people.findIndex((p) => p.userId?.equals(me._id));
    const named = st?.meName
      ? people.findIndex((p) => deps.norm(p.name) === deps.norm(st.meName!))
      : -1;

    const d: Draft = {
      id: randomBytes(4).toString("hex"),
      chatId: ctx.chat!.id,
      messageId: 0,
      sent: input.sent,
      groupId: g._id,
      description: input.description,
      cents: input.cents,
      people: people.map((p) => ({ id: p._id, name: p.name })),
      outings: outings.map((o) => ({ id: o._id, name: o.name })),
      on: new Set(people.map((_, i) => i)),
      payer: mine >= 0 ? mine : named >= 0 ? named : null,
      outing: null,
      date: input.sent,
      saving: false,
      expires: now + TTL,
    };
    const msg = await ctx.reply(cardText(d, deps.esc), {
      ...HTML,
      reply_markup: keyboard(d, "main"),
    });
    d.messageId = msg.message_id;
    drafts.set(d.id, d);
  }

  async function confirm(ctx: Context, d: Draft) {
    if (d.saving) return ctx.answerCallbackQuery(); // toque duplo: ignora
    if (d.payer === null)
      return ctx.answerCallbackQuery({
        text: "Escolha quem pagou.",
        show_alert: true,
      });
    if (!d.on.size)
      return ctx.answerCallbackQuery({
        text: "Marque pelo menos uma pessoa.",
        show_alert: true,
      });

    d.saving = true;
    try {
      const shares = await deps.save({
        groupId: d.groupId,
        description: d.description,
        cents: d.cents,
        paidBy: d.people[d.payer].id,
        outingId: d.outing === null ? undefined : d.outings[d.outing].id,
        date: d.date,
        parts: [...d.on]
          .sort((a, b) => a - b)
          .map((i) => ({ personId: d.people[i].id })),
      });
      drafts.delete(d.id);
      if (awaitingDate === d.id) awaitingDate = null;
      await ctx.answerCallbackQuery({ text: "Registrado" });
      const nameOf = (id: ObjectId) =>
        deps.esc(d.people.find((p) => p.id.equals(id))?.name ?? "?");
      const text = [
        `✅ <b>${deps.esc(d.description || "Gasto")}</b> registrado`,
        `💰 ${brl(d.cents)}, pago por <b>${deps.esc(d.people[d.payer].name)}</b>`,
        ...(d.outing !== null
          ? [`🚩 ${deps.esc(d.outings[d.outing].name)}`]
          : []),
        `📅 ${d.date.toLocaleDateString("pt-BR")}`,
        "",
        "<b>Divisão</b>",
        ...shares.map((s) => `• ${nameOf(s.personId)}: ${brl(s.cents)}`),
      ].join("\n");
      await ctx.api
        .editMessageText(d.chatId, d.messageId, text, HTML)
        .catch(() => {}); // já gravou: não é erro
    } catch (e) {
      d.saving = false;
      throw e;
    }
  }

  function register(bot: Bot) {
    bot.callbackQuery(/^d:([0-9a-f]+):([a-z]+)(?::(.+))?$/, async (ctx) => {
      const [, id, act, arg] = ctx.match as RegExpMatchArray;
      const d = drafts.get(id);
      try {
        if (!d || d.expires < Date.now()) {
          drafts.delete(id);
          await ctx.answerCallbackQuery({
            text: "Esse rascunho expirou. Envie /gasto de novo.",
            show_alert: true,
          });
          await ctx.editMessageReplyMarkup().catch(() => {});
          return;
        }
        d.expires = Date.now() + TTL;
        if (act === "no") {
          drafts.delete(id);
          await ctx.answerCallbackQuery();
          await ctx.editMessageText("✖ Gasto cancelado.");
          return;
        }
        if (act === "ok") return void (await confirm(ctx, d));

        const { screen, waitDate } =
          act === "back"
            ? { screen: "main" as Screen, waitDate: false }
            : applyAction(d, act, arg);
        awaitingDate = waitDate ? d.id : null;
        await render(
          ctx.api,
          d,
          screen,
          waitDate
            ? "📅 Envie a data em uma mensagem: 02/11, 02/11/2026, hoje ou ontem"
            : undefined,
        );
        await ctx.answerCallbackQuery();
      } catch (e) {
        await ctx
          .answerCallbackQuery({
            text: `Erro: ${(e as Error).message}`.slice(0, 190),
            show_alert: true,
          })
          .catch(() => {});
      }
    });

    // "Outra data…": a próxima mensagem de texto (que não seja comando) vira a data do gasto
    bot.on("message:text", async (ctx, next) => {
      const d = awaitingDate ? drafts.get(awaitingDate) : undefined;
      if (!d) return next();
      try {
        d.date = deps.parseDate(ctx.message.text.trim(), d.sent);
        awaitingDate = null;
        await render(ctx.api, d, "main");
      } catch (e) {
        await ctx.reply(`⚠️ ${deps.esc((e as Error).message)}`, HTML);
      }
    });
  }

  return { start, register };
}
