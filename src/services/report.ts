import { Writable } from "node:stream";
import type { ObjectId } from "mongodb";
import PDFDocument from "pdfkit";
import { expenses, groups, outings, payments, people } from "../config/db";
import { balances, brl, settle } from "../domain/finance";

export interface ReportData {
  groupName: string;
  balances: { name: string; cents: number }[];
  transfers: { fromName: string; toName: string; cents: number }[];
  expenses: {
    date: Date;
    description: string;
    outing?: string;
    paidByName: string;
    cents: number;
    shares: { name: string; cents: number }[];
  }[];
  payments: { date: Date; fromName: string; toName: string; cents: number }[];
}

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const POS = "#0f766e";
const NEG = "#b91c1c";

// Gera o PDF direto no stream de saída (a resposta HTTP), sem arquivo temporário
export function renderReport(out: Writable, d: ReportData) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(out);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const valueW = 130;

  // Uma linha com rótulo à esquerda, valor à direita e um filete embaixo
  function row(
    label: string,
    value: string,
    o: { bold?: boolean; color?: string } = {},
  ) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    doc
      .font(o.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(11)
      .fillColor(INK);
    doc.text(label, left, y, { width: width - valueW - 8 });
    const labelEnd = doc.y; // o rótulo pode quebrar em mais de uma linha
    doc
      .fillColor(o.color ?? INK)
      .text(value, left + width - valueW, y, { width: valueW, align: "right" });
    doc.y = Math.max(labelEnd, doc.y) + 5;
    rule();
    doc.y += 6;
  }

  function rule() {
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
  }

  // Um gasto: título e valor, quem pagou/saída e a divisão por pessoa. O bloco não quebra entre páginas.
  function expenseBlock(e: ReportData["expenses"][number]) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const y = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(INK)
      .text(
        `${e.date.toLocaleDateString("pt-BR")}   ${e.description}`,
        left,
        y,
        { width: width - valueW - 8 },
      );
    const titleEnd = doc.y;
    doc.text(brl(e.cents), left + width - valueW, y, {
      width: valueW,
      align: "right",
    });
    doc.y = Math.max(titleEnd, doc.y);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(
        `Pago por ${e.paidByName}${e.outing ? `, saída ${e.outing}` : ""}`,
        left,
        doc.y,
        { width },
      )
      .text(
        `Divisão: ${e.shares.map((s) => `${s.name} ${brl(s.cents)}`).join("; ")}`,
        left,
        doc.y,
        { width },
      );
    doc.y += 5;
    rule();
    doc.y += 6;
  }

  function section(title: string) {
    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.moveDown(1);
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(INK)
      .text(title, left, doc.y);
    doc.moveDown(0.5);
  }

  const note = (text: string) =>
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(text, left, doc.y);

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(INK)
    .text(d.groupName, left, doc.y);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(
      `Relatório gerado em ${new Date().toLocaleDateString("pt-BR")}`,
      left,
      doc.y,
    );

  section("Quanto cada um deve");
  if (!d.balances.length) note("Nenhuma pessoa cadastrada.");
  for (const b of d.balances) {
    if (b.cents < 0)
      row(b.name, `Deve ${brl(-b.cents)}`, { color: NEG, bold: true });
    else if (b.cents > 0)
      row(b.name, `A receber ${brl(b.cents)}`, { color: POS });
    else row(b.name, "Quite", { color: MUTED });
  }

  section("Para zerar as contas");
  if (!d.transfers.length) note("Todo mundo está quite.");
  for (const t of d.transfers)
    row(`${t.fromName} paga a ${t.toName}`, brl(t.cents));

  section("Gastos detalhados");
  if (!d.expenses.length) note("Nenhum gasto registrado.");
  d.expenses.forEach((e) => expenseBlock(e));
  if (d.expenses.length) {
    row("Total gasto", brl(d.expenses.reduce((s, e) => s + e.cents, 0)), {
      bold: true,
    });
  }

  section("Pagamentos registrados");
  if (!d.payments.length) note("Nenhum pagamento registrado.");
  for (const p of d.payments) {
    row(
      `${p.date.toLocaleDateString("pt-BR")}   ${p.fromName} pagou a ${p.toName}`,
      brl(p.cents),
    );
  }
  if (d.payments.length) {
    row("Total pago", brl(d.payments.reduce((s, p) => s + p.cents, 0)), {
      bold: true,
    });
  }

  doc.end();
}

// Busca e prepara os dados do relatório; é o único lugar que faz isso,
// então o PDF do site e o do Telegram nunca divergem.
export async function loadReportData(
  groupId: ObjectId,
): Promise<ReportData | null> {
  const group = await groups.findOne({ _id: groupId });
  if (!group) return null;

  const alive = { groupId, deletedAt: { $exists: false } };
  const [ppl, exp, pays, outs] = await Promise.all([
    people.find({ groupId }).sort({ name: 1 }).toArray(),
    expenses.find(alive).sort({ date: 1 }).toArray(),
    payments.find(alive).sort({ date: 1 }).toArray(),
    outings.find({ groupId }).toArray(),
  ]);
  const names = new Map(ppl.map((p) => [String(p._id), p.name]));
  const nameOf = (id: unknown) => names.get(String(id)) ?? "?";
  const outNames = new Map(outs.map((o) => [String(o._id), o.name]));
  const bal = balances(exp, pays);

  return {
    groupName: group.name,
    balances: ppl
      .map((p) => ({ name: p.name, cents: bal.get(String(p._id)) ?? 0 }))
      .sort((a, b) => a.cents - b.cents), // quem mais deve aparece primeiro
    transfers: settle(bal).map((t) => ({
      fromName: nameOf(t.from),
      toName: nameOf(t.to),
      cents: t.cents,
    })),
    expenses: exp.map((e) => ({
      date: e.date,
      description: e.description,
      outing: e.outingId ? outNames.get(String(e.outingId)) : undefined,
      paidByName: nameOf(e.paidBy),
      cents: e.cents,
      shares: e.shares.map((s) => ({
        name: nameOf(s.personId),
        cents: s.cents,
      })),
    })),
    payments: pays.map((p) => ({
      date: p.date,
      fromName: nameOf(p.from),
      toName: nameOf(p.to),
      cents: p.cents,
    })),
  };
}

export const reportFileName = (groupName: string) =>
  `relatorio-${
    groupName
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "grupo"
  }-${new Date()
    .toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-")}.pdf`;

// Versão em memória, para anexar o PDF numa mensagem do Telegram sem arquivo temporário
export function renderReportBuffer(d: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    sink.on("error", reject);
    renderReport(sink, d);
  });
}
