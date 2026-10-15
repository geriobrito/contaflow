import { describe, expect, it } from 'vitest';
import { generateNotesPdf } from '@/lib/export/notes-pdf';
import { generateDLPAExcel, generateDLPAPdf } from '@/lib/export/dlpa-export';
import { defaultNotes } from '@/lib/notes';
import type { DLPA } from '@/lib/year-closing';

const client = { name: 'Empresa Teste Contabilidade Ltda', cnpj: '12.345.678/0001-90', tradeName: 'Empresa Teste', regime: 'LUCRO_PRESUMIDO' as const };
const signatories = { legalRepresentative: { name: 'Carlos Administrador', cpf: '123.456.789-00' }, accountant: { name: 'Ana Contadora', crc: 'SP-123456/O-5' } };

describe('notas explicativas em PDF', () => {
  it('gera o PDF só com as notas marcadas, com quebra de página em textos longos', () => {
    const notes = defaultNotes(client, '2026').map((n) => (n.id === 'policies' ? { ...n, text: `${n.text}\n${'Texto longo da prática contábil. '.repeat(400)}` } : n));
    const res = generateNotesPdf({ client, year: '2026', notes, signatories, issuedAt: new Date('2027-03-01T12:00:00Z') });
    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.blob.size).toBeGreaterThan(3000);
    expect(res.fileName).toBe('Notas_Explicativas_Empresa_Teste_2026.pdf');
  });
});

describe('DLPA em PDF e Excel', () => {
  const dlpa: DLPA = {
    year: '2025',
    start: '2025-01-01',
    end: '2025-12-31',
    opening: 500,
    openingBalance: 0,
    adjustments: 0,
    netResult: 700,
    distributions: -200,
    closing: 1000,
    rows: [
      { kind: 'balance', label: 'Saldo em 01/01/2025', value: 500 },
      { kind: 'movement', label: '(+/-) Ajustes e outras movimentações', value: 0 },
      { kind: 'movement', label: '(+/-) Lucro ou prejuízo líquido do exercício', value: 700 },
      { kind: 'movement', label: '(-) Lucros distribuídos', value: -200 },
      { kind: 'balance', label: 'Saldo em 31/12/2025', value: 1000 },
    ],
  };

  it('gera os dois arquivos', async () => {
    const pdf = generateDLPAPdf({ client, dlpa, signatories });
    expect(pdf.blob.size).toBeGreaterThan(2000);
    expect(pdf.fileName).toBe('DLPA_Empresa_Teste_2025-01-01_a_2025-12-31.pdf');
    const xlsx = await generateDLPAExcel({ client, dlpa, signatories });
    expect(xlsx.blob.size).toBeGreaterThan(2000);
    expect(xlsx.fileName).toBe('DLPA_Empresa_Teste_2025-01-01_a_2025-12-31.xlsx');
  });
});
