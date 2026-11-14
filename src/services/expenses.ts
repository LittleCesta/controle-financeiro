import { ObjectId } from 'mongodb';
import { expenses } from '../config/db';
import { buildShares } from '../domain/finance';

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

// Edição: revalida a divisão com as mesmas regras da criação
export async function updateExpense(id: ObjectId, e: NewExpense) {
  if (e.cents <= 0) throw new Error('Informe um valor maior que zero');
  const set = {
    description: e.description.trim() || 'Gasto',
    cents: e.cents,
    paidBy: e.paidBy,
    date: e.date ?? new Date(),
    shares: buildShares(e.cents, e.parts),
    ...(e.outingId ? { outingId: e.outingId } : {}),
  };
  const r = await expenses.updateOne(
    { _id: id, groupId: e.groupId, deletedAt: { $exists: false } },
    e.outingId ? { $set: set } : { $set: set, $unset: { outingId: '' as const } },
  );
  if (!r.matchedCount) throw new Error('Gasto não encontrado');
}
