import { ObjectId } from 'mongodb';
import { expenses } from './db';
import { buildShares } from './finance';

export interface NewExpense {
  groupId: ObjectId;
  description: string;
  cents: number;
  paidBy: ObjectId;
  outingId?: ObjectId;
  date?: Date;
  parts: { personId: ObjectId; cents?: number }[];
}

// Único caminho para criar gasto: o site e o bot usam esta função,
// então a validação (soma das partes, centavos) nunca diverge entre os dois.
export async function createExpense(e: NewExpense) {
  if (e.cents <= 0) throw new Error('Informe um valor maior que zero');
  const shares = buildShares(e.cents, e.parts);
  await expenses.insertOne({
    groupId: e.groupId,
    description: e.description.trim() || 'Gasto',
    cents: e.cents,
    paidBy: e.paidBy,
    ...(e.outingId ? { outingId: e.outingId } : {}),
    date: e.date ?? new Date(),
    shares,
  });
  return shares;
}
