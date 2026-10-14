import { jsPDF } from 'jspdf';
import type { ClientCompany } from '@/types/firestore';
import type { NoteBlock } from '@/lib/notes';
import { accountingStandard } from '@/lib/accounting-standard';
import { cnpjLabel } from '@/lib/export/dre-rows';
import { INK, MARGIN_X, MUTED, addPageFooters, renderSignatures, sanitizeFileName, type LedgerPdfExportContext } from '@/lib/export/ledger-pdf';

export const NOTES_TITLE = 'NOTAS EXPLICATIVAS ÀS DEMONSTRAÇÕES CONTÁBEIS';

export interface NotesPdfContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte'>;
  year: string;
  /** Só os blocos marcados entram, numerados na ordem. */
  notes: readonly NoteBlock[];
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

/** Notas explicativas em PDF (A4 retrato): cabeçalho, notas numeradas e assinaturas. */
export function generateNotesPdf(ctx: NotesPdfContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageBottom = doc.internal.pageSize.getHeight() - 20;
  const center = pageWidth / 2;
  const width = pageWidth - MARGIN_X * 2;
  const standard = accountingStandard(ctx.client);
  doc.setProperties({ title: `Notas explicativas - ${ctx.client.name}`, subject: `Exercício de ${ctx.year} - ${standard}`, creator: 'ContaFlow' });

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
  y += 8;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(NOTES_TITLE, center, y, { align: 'center', maxWidth: width });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`Exercício findo em 31/12/${ctx.year} - ${standard} - Em Reais - R$`, center, y, { align: 'center', maxWidth: width });
  y += 3;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
  y += 8;

  const ensure = (needed: number) => {
    if (y + needed <= pageBottom) return;
    doc.addPage();
    y = 20;
  };
  const LINE = 4.6;
  ctx.notes
    .filter((n) => n.enabled && n.text.trim())
    .forEach((note, i) => {
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(`NOTA ${i + 1} - ${note.title.trim().toUpperCase()}`, MARGIN_X, y, { maxWidth: width });
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      for (const paragraph of note.text.trim().split(/\n+/)) {
        for (const line of doc.splitTextToSize(paragraph.trim(), width) as string[]) {
          ensure(LINE);
          doc.text(line, MARGIN_X, y);
          y += LINE;
        }
        y += 1.5;
      }
      y += 4;
    });

  renderSignatures(doc, y, ctx.issuedAt ?? new Date(), ctx.signatories);
  addPageFooters(doc, 'NOTAS EXPLICATIVAS', ctx.client.name);
  const slug = sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente';
  return { blob: doc.output('blob'), fileName: `Notas_Explicativas_${slug}_${ctx.year}.pdf` };
}
