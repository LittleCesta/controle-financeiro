import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { applyAction, cardText, daysAgo, type Draft } from "./draft";

const esc = (s: string) => s;
const make = (over: Partial<Draft> = {}): Draft => ({
  id: "abc", chatId: 1, messageId: 1, sent: new Date(2026, 10, 8, 10, 30), groupId: new ObjectId(),
  description: "Uber", cents: 6000,
  people: ["Ana", "Bia", "Cesar"].map((name) => ({ id: new ObjectId(), name })),
  outings: [{ id: new ObjectId(), name: "Sábado" }],
  on: new Set([0, 1, 2]), payer: 2, outing: null, date: new Date(2026, 10, 8, 10, 30),
  saving: false, expires: Infinity, ...over,
});

describe("applyAction", () => {
  it("marca e desmarca participantes", () => {
    const d = make();
    applyAction(d, "t", "1");
    assert.deepEqual([...d.on], [0, 2]);
    applyAction(d, "t", "1");
    assert.deepEqual([...d.on].sort(), [0, 1, 2]);
  });

  it("ignora índices inválidos, como botões antigos ou adulterados", () => {
    const d = make();
    for (const bad of ["9", "-1", "x", undefined]) {
      applyAction(d, "t", bad);
      applyAction(d, "p", bad);
      applyAction(d, "o", bad);
    }
    assert.deepEqual([...d.on].sort(), [0, 1, 2]);
    assert.equal(d.payer, 2);
    assert.equal(d.outing, null);
  });

  it("'Todos' remarca todo mundo", () => {
    const d = make({ on: new Set([1]) });
    applyAction(d, "all");
    assert.equal(d.on.size, 3);
  });

  it("escolhe quem pagou e a saída (ou nenhuma)", () => {
    const d = make({ payer: null });
    assert.equal(applyAction(d, "pay").screen, "pay");
    assert.equal(applyAction(d, "p", "0").screen, "main");
    assert.equal(d.payer, 0);
    applyAction(d, "o", "0");
    assert.equal(d.outing, 0);
    applyAction(d, "o", "x");
    assert.equal(d.outing, null);
  });

  it("datas rápidas: hoje mantém o horário do envio, os outros dias ficam ao meio-dia", () => {
    const d = make();
    applyAction(d, "dd", "1");
    assert.equal(d.date.toLocaleDateString("pt-BR"), "07/11/2026");
    assert.equal(d.date.getHours(), 12);
    applyAction(d, "dd", "0");
    assert.equal(d.date.getTime(), d.sent.getTime());
    assert.equal(daysAgo(d.sent, 0), d.sent);
  });

  it("'Outra data' pede a digitação", () => {
    assert.equal(applyAction(make(), "dx").waitDate, true);
    assert.equal(applyAction(make(), "t", "0").waitDate, false);
  });
});

describe("cardText", () => {
  it("mostra quem pagou, quem participa e a divisão", () => {
    const t = cardText(make(), esc);
    assert.match(t, /Uber<\/b>, R\$\s60,00/);
    assert.match(t, /Pagou: <b>Cesar<\/b>/);
    assert.match(t, /Participam: Ana, Bia, Cesar/);
    assert.match(t, /R\$\s20,00 por pessoa/);
    assert.match(t, /Data: 08\/11\/2026/);
  });

  it("sem pagador, pede para escolher; divisão que não fecha vira 'cerca de'", () => {
    const t = cardText(make({ payer: null, cents: 10000 }), esc);
    assert.match(t, /escolha em Quem pagou/);
    assert.match(t, /cerca de R\$\s33,33 por pessoa/);
  });

  it("sem participantes, não quebra", () => {
    const t = cardText(make({ on: new Set() }), esc, "dica");
    assert.match(t, /Participam: ninguém/);
    assert.ok(t.endsWith("dica"));
  });
});
