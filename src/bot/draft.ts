import type { ObjectId } from "mongodb";
import { brl } from "../domain/finance";

// O rascunho de um gasto enquanto o assistente do Telegram o monta. Nada aqui fala com o
// Telegram nem com o banco: são regras puras, fáceis de testar.
export interface Draft {
  id: string;
  chatId: number;
  messageId: number;
  sent: Date; // quando a mensagem /gasto foi enviada: é a data padrão
  groupId: ObjectId;
  description: string;
  cents: number;
  people: { id: ObjectId; name: string }[];
  outings: { id: ObjectId; name: string }[];
  on: Set<number>; // índices de quem participa
  payer: number | null;
  outing: number | null;
  date: Date;
  saving: boolean; // trava contra toque duplo em "Confirmar"
  expires: number;
}

export type Screen = "main" | "pay" | "out" | "date";

export function daysAgo(from: Date, n: number) {
  if (n === 0) return from;
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

// Aplica um toque nos botões ao rascunho e diz qual tela mostrar em seguida
export function applyAction(
  d: Draft,
  act: string,
  arg?: string,
): { screen: Screen; waitDate: boolean } {
  const i = Number(arg);
  const person = Number.isInteger(i) && i >= 0 && i < d.people.length;
  const main = { screen: "main" as Screen, waitDate: false };
  switch (act) {
    case "t":
      if (person) d.on.has(i) ? d.on.delete(i) : d.on.add(i);
      return main;
    case "all":
      d.on = new Set(d.people.map((_, k) => k));
      return main;
    case "pay":
      return { ...main, screen: "pay" };
    case "p":
      if (person) d.payer = i;
      return main;
    case "out":
      return { ...main, screen: "out" };
    case "o":
      if (arg === "x") d.outing = null;
      else if (Number.isInteger(i) && i >= 0 && i < d.outings.length)
        d.outing = i;
      return main;
    case "dt":
      return { ...main, screen: "date" };
    case "dd":
      if (Number.isInteger(i) && i >= 0 && i <= 30) d.date = daysAgo(d.sent, i);
      return main;
    case "dx":
      return { ...main, waitDate: true };
    default:
      return main;
  }
}

export function cardText(d: Draft, esc: (s: string) => string, note?: string) {
  const who =
    [...d.on]
      .sort((a, b) => a - b)
      .map((i) => esc(d.people[i].name))
      .join(", ") || "ninguém";
  const each = d.on.size ? brl(Math.round(d.cents / d.on.size)) : "-";
  const approx = d.on.size > 0 && d.cents % d.on.size !== 0;
  return [
    `🧾 <b>${esc(d.description)}</b>, ${brl(d.cents)}`,
    "",
    `👤 Pagou: ${d.payer === null ? "<i>escolha em Quem pagou</i>" : `<b>${esc(d.people[d.payer].name)}</b>`}`,
    `👥 Participam: ${who}`,
    `🚩 Saída: ${d.outing === null ? "nenhuma" : esc(d.outings[d.outing].name)}`,
    `📅 Data: ${d.date.toLocaleDateString("pt-BR")}`,
    `💸 ${approx ? "cerca de " : ""}${each} por pessoa`,
    ...(note ? ["", note] : []),
  ].join("\n");
}
