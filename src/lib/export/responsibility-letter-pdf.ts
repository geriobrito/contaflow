import { jsPDF } from 'jspdf';
import { cnpjLabel } from '@/lib/export/dre-rows';
import { INK, MARGIN_X, MUTED, addPageFooters, sanitizeFileName } from '@/lib/export/ledger-pdf';
import { buildResponsibilityLetter, type LetterInput } from '@/lib/responsibility-letter';

export const LETTER_TITLE = 'CARTA DE RESPONSABILIDADE DA ADMINISTRAÇÃO';

export interface LetterPdfContext extends Omit<LetterInput, 'issuedAt'> {
  client: LetterInput['client'] & { tradeName?: string };
  issuedAt?: Date;
}

/** Carta de responsabilidade em PDF (A4 retrato), com a assinatura do representante legal. */
export function generateResponsibilityLetterPdf(ctx: LetterPdfContext): { blob: Blob; fileName: string } {
  const letter = buildResponsibilityLetter({ ...ctx, issuedAt: ctx.issuedAt ?? new Date() });
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageBottom = doc.internal.pageSize.getHeight() - 20;
  const center = pageWidth / 2;
  const width = pageWidth - MARGIN_X * 2 - 8;
  const left = MARGIN_X + 4;
  doc.setProperties({ title: `Carta de responsabilidade - ${ctx.client.name}`, subject: `Exercício de ${ctx.year}`, creator: 'ContaFlow' });

  // Cabeçalho: a empresa que declara.
  let y = 18;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(ctx.client.name.toUpperCase(), center, y, { align: 'center', maxWidth: width });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), center, y, { align: 'center' });
  y += 3;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
  y += 12;

  const LINE = 5;
  const ensure = (needed: number) => {
    if (y + needed <= pageBottom) return;
    doc.addPage();
    y = 22;
  };
  const paragraph = (text: string, opts: { bold?: boolean; indent?: number; after?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const indent = opts.indent ?? 0;
    for (const line of doc.splitTextToSize(text, width - indent) as string[]) {
      ensure(LINE);
      doc.text(line, left + indent, y);
      y += LINE;
    }
    y += opts.after ?? 3;
  };

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(LETTER_TITLE, center, y, { align: 'center' });
  y += 12;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(letter.place, pageWidth - left, y, { align: 'right' });
  y += 12;

  letter.addressee.forEach((line, i) => paragraph(line, { bold: i === 1, after: 0 }));
  y += 6;
  paragraph(letter.reference, { bold: true, after: 6 });
  paragraph(letter.salutation, { after: 4 });
  paragraph(letter.intro, { after: 4 });
  for (const item of letter.items) paragraph(item, { indent: 6, after: 2.5 });
  y += 2;
  paragraph(letter.closing, { after: 6 });
  paragraph(letter.farewell, { after: 0 });

  // Assinatura do representante legal, centralizada.
  ensure(36);
  y += 24;
  const lineWidth = 90;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.35);
  doc.line(center - lineWidth / 2, y, center + lineWidth / 2, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(letter.signer.name || '____________________________________', center, y + 5, { align: 'center', maxWidth: lineWidth });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Representante Legal / Administrador', center, y + 10, { align: 'center' });
  doc.text(`CPF: ${letter.signer.cpf ?? ''}`, center, y + 14.5, { align: 'center' });

  addPageFooters(doc, 'CARTA DE RESPONSABILIDADE', ctx.client.name);
  const slug = sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente';
  return { blob: doc.output('blob'), fileName: `Carta_de_Responsabilidade_${slug}_${ctx.year}.pdf` };
}
