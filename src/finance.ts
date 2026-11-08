import { ObjectId } from "mongodb";

export interface Group {
  name: string;
  createdAt: Date;
}
export interface Person {
  groupId: ObjectId;
  name: string;
}
export interface Outing {
  groupId: ObjectId;
  name: string;
}
export interface Share {
  personId: ObjectId;
  cents: number;
}
export interface Expense {
  groupId: ObjectId;
  outingId?: ObjectId;
  description: string;
  cents: number;
  paidBy: ObjectId;
  date: Date;
  shares: Share[];
  deletedAt?: Date;
}
export interface Payment {
  groupId: ObjectId;
  from: ObjectId;
  to: ObjectId;
  cents: number;
  date: Date;
  deletedAt?: Date;
}

// "60,50" ou "60.50" -> 6050 (sempre inteiro em centavos)
export function parseMoney(input: string): number {
  // sem dígito ("", "abc") ou com sinal de menos: recusa, em vez de virar R$ 0,00 ou valor positivo
  if (input.includes("-") || !/\d/.test(input))
    throw new Error(`Valor inválido: "${input}"`);
  const t = input.trim().replace(/[^\d.,]/g, "");
  const n = t.includes(",")
    ? Number(t.replace(/\./g, "").replace(",", "."))
    : Number(t);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`Valor inválido: "${input}"`);
  return Math.round(n * 100);
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Quem tem valor informado paga exatamente aquilo; o restante é dividido
// igualmente entre os demais. A soma das partes SEMPRE fecha no total.
export function buildShares(
  total: number,
  parts: { personId: ObjectId; cents?: number }[],
): Share[] {
  if (!parts.length) throw new Error("Selecione ao menos um participante");
  const fixed = parts.reduce((s, p) => s + (p.cents ?? 0), 0);
  const freeCount = parts.filter((p) => p.cents === undefined).length;
  const rest = total - fixed;
  if (rest < 0)
    throw new Error("Os valores individuais passam do total do gasto");
  if (!freeCount && rest !== 0)
    throw new Error("A soma dos valores individuais difere do total");

  const base = freeCount ? Math.floor(rest / freeCount) : 0;
  let extra = freeCount ? rest % freeCount : 0; // centavos que sobraram
  return parts.map((p) => ({
    personId: p.personId,
    cents: p.cents ?? base + (extra-- > 0 ? 1 : 0),
  }));
}

// Saldo = o que pagou - a parte dele + pagamentos feitos - pagamentos recebidos
export function balances(
  expenses: Pick<Expense, "paidBy" | "cents" | "shares">[],
  payments: Pick<Payment, "from" | "to" | "cents">[],
) {
  const b = new Map<string, number>();
  const add = (id: ObjectId, c: number) =>
    b.set(String(id), (b.get(String(id)) ?? 0) + c);
  for (const e of expenses) {
    add(e.paidBy, e.cents);
    for (const s of e.shares) add(s.personId, -s.cents);
  }
  for (const p of payments) {
    add(p.from, p.cents);
    add(p.to, -p.cents);
  }
  return b;
}

// Reduz as transferências: quem deve mais paga a quem tem mais a receber
export function settle(b: Map<string, number>) {
  const debtors = [...b]
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }))
    .sort((x, y) => y.v - x.v);
  const creditors = [...b]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
    .sort((x, y) => y.v - x.v);
  const out: { from: string; to: string; cents: number }[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const c = Math.min(debtors[i].v, creditors[j].v);
    out.push({ from: debtors[i].id, to: creditors[j].id, cents: c });
    debtors[i].v -= c;
    creditors[j].v -= c;
    if (!debtors[i].v) i++;
    if (!creditors[j].v) j++;
  }
  return out;
}
