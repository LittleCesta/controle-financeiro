import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bot, Context } from "grammy";
import { ObjectId } from "mongodb";
import { createWizard } from "./gastoWizard";

// Roda o assistente de verdade, mas com a API do Telegram e o banco substituídos por fakes
const botInfo = { id: 1, is_bot: true, first_name: "t", username: "t_bot", can_join_groups: true,
  can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any;
const user = { id: 1, is_bot: false, first_name: "Cesar" };
const chat = { id: 1, type: "private" };

function setup() {
  const calls: { method: string; payload: any }[] = [];
  const saved: any[] = [];
  const me = new ObjectId();
  const people = [
    { _id: new ObjectId(), name: "Ana" }, { _id: new ObjectId(), name: "Bia" },
    { _id: new ObjectId(), name: "Cesar", userId: me },
  ];
  const bot = new Bot("1:fake", { botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 7 } : true } as any;
  });
  const wizard = createWizard({
    activeGroup: async () => ({ g: { _id: new ObjectId() }, st: null }),
    getMe: async () => ({ _id: me }),
    load: async () => ({ people, outings: [{ _id: new ObjectId(), name: "Sábado" }] }),
    save: async (e) => { saved.push(e); return e.parts.map((p) => ({ personId: p.personId, cents: Math.floor(e.cents / e.parts.length) })); },
    parseDate: (input) => { if (input === "xx") throw new Error("Data inválida"); return new Date(2026, 10, 2, 12); },
    esc: (s) => s, norm: (s) => s.toLowerCase(),
  });
  wizard.register(bot);

  let n = 1;
  let id = "";
  const last = (method: string) => [...calls].reverse().find((c) => c.method === method)!;
  return {
    calls, saved, people, last,
    async start() {
      const ctx = new Context({ update_id: 0, message: { message_id: 1, date: 0, chat, from: user, text: "/gasto Uber 60" } } as any, bot.api, botInfo);
      await wizard.start(ctx, { description: "Uber", cents: 6000, sent: new Date(2026, 10, 8, 10) });
      id = last("sendMessage").payload.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
    },
    tap: (data: string) => bot.handleUpdate({ update_id: n++, callback_query: { id: "q", from: user, chat_instance: "c",
      data: data.replace("ID", id), message: { message_id: 7, date: 0, chat } } } as any),
    say: (text: string) => bot.handleUpdate({ update_id: n++, message: { message_id: 9, date: 0, chat, from: user, text } } as any),
    card: () => last("editMessageText").payload.text as string,
  };
}

describe("assistente de /gasto", () => {
  it("abre o cartão com todos marcados e você como quem pagou", async () => {
    const t = setup();
    await t.start();
    const sent = t.last("sendMessage").payload;
    assert.match(sent.text, /Pagou: <b>Cesar<\/b>/);
    assert.match(sent.text, /Participam: Ana, Bia, Cesar/);
    assert.equal(sent.parse_mode, "HTML");
    assert.ok(sent.reply_markup.inline_keyboard.flat().every((b: any) => b.callback_data.length <= 64));
  });

  it("desmarcar alguém e confirmar grava só os participantes restantes", async () => {
    const t = setup();
    await t.start();
    await t.tap("d:ID:t:1"); // tira a Bia
    assert.match(t.card(), /Participam: Ana, Cesar/);
    await t.tap("d:ID:ok");
    assert.equal(t.saved.length, 1);
    assert.deepEqual(t.saved[0].parts.map((p: any) => String(p.personId)), [String(t.people[0]._id), String(t.people[2]._id)]);
    assert.equal(String(t.saved[0].paidBy), String(t.people[2]._id));
    assert.match(t.card(), /✅ <b>Uber<\/b> registrado/);
  });

  it("troca quem pagou pela tela própria", async () => {
    const t = setup();
    await t.start();
    await t.tap("d:ID:pay");
    await t.tap("d:ID:p:0");
    assert.match(t.card(), /Pagou: <b>Ana<\/b>/);
    await t.tap("d:ID:ok");
    assert.equal(String(t.saved[0].paidBy), String(t.people[0]._id));
  });

  it("toque duplo em Confirmar grava uma vez só", async () => {
    const t = setup();
    await t.start();
    await Promise.all([t.tap("d:ID:ok"), t.tap("d:ID:ok")]);
    assert.equal(t.saved.length, 1);
  });

  it("sem participantes, não grava e avisa", async () => {
    const t = setup();
    await t.start();
    for (const i of [0, 1, 2]) await t.tap(`d:ID:t:${i}`);
    await t.tap("d:ID:ok");
    assert.equal(t.saved.length, 0);
    assert.match(t.last("answerCallbackQuery").payload.text, /pelo menos uma pessoa/);
  });

  it("cancelar descarta o rascunho", async () => {
    const t = setup();
    await t.start();
    await t.tap("d:ID:no");
    assert.match(t.card(), /cancelado/);
    await t.tap("d:ID:ok");
    assert.equal(t.saved.length, 0);
    assert.match(t.last("answerCallbackQuery").payload.text, /expirou/);
  });

  it("botão de um rascunho que não existe mais avisa que expirou", async () => {
    const t = setup();
    await t.start();
    await t.tap("d:deadbeef:ok");
    assert.match(t.last("answerCallbackQuery").payload.text, /expirou/);
    assert.equal(t.saved.length, 0);
  });

  it("'Outra data…' aceita a próxima mensagem; data inválida pede de novo", async () => {
    const t = setup();
    await t.start();
    await t.tap("d:ID:dx");
    assert.match(t.card(), /Envie a data/);
    await t.say("xx");
    assert.match(t.last("sendMessage").payload.text, /Data inválida/);
    await t.say("02/11");
    assert.match(t.card(), /Data: 02\/11\/2026/);
    await t.tap("d:ID:ok");
    assert.equal(t.saved[0].date.toLocaleDateString("pt-BR"), "02/11/2026");
  });
});
