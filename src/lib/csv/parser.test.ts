import { describe, expect, it } from 'vitest';
import {
  detectCSVDelimiter,
  generateCSVFitid,
  guessCSVColumns,
  parseBrazilianOrISODate,
  parseCSVRows,
  parseCSVToOFXResult,
  parseMoney,
  previewCSV,
} from '@/lib/csv/parser';

describe('CSV Parser', () => {
  describe('detectCSVDelimiter', () => {
    it('detecta delimitador ponto e vírgula (;)', () => {
      const csv = 'Data;Histórico;Valor\n15/03/2025;TED Recebida;1500,00\n16/03/2025;PIX Enviado;-300,00';
      expect(detectCSVDelimiter(csv)).toBe(';');
    });

    it('detecta delimitador vírgula (,)', () => {
      const csv = 'Date,Description,Amount\n2025-03-15,Payment,150.00\n2025-03-16,Deposit,500.00';
      expect(detectCSVDelimiter(csv)).toBe(',');
    });

    it('detecta delimitador tabulação (\\t)', () => {
      const csv = 'Data\tHistórico\tValor\n15/03/2025\tDoc 123\t100,00';
      expect(detectCSVDelimiter(csv)).toBe('\t');
    });
  });

  describe('parseCSVRows', () => {
    it('respeita aspas com delimitadores internos e aspas escapadas', () => {
      const csv = 'Data;Favorecido;Valor\n10/05/2025;"Supermercado ""Bom Preço"", Ltda";250,50';
      const rows = parseCSVRows(csv, ';');
      expect(rows).toHaveLength(2);
      expect(rows[1][1]).toBe('Supermercado "Bom Preço", Ltda');
      expect(rows[1][2]).toBe('250,50');
    });
  });

  describe('parseBrazilianOrISODate', () => {
    it('converte datas brasileiras DD/MM/YYYY para YYYY-MM-DD', () => {
      expect(parseBrazilianOrISODate('15/03/2025')).toBe('2025-03-15');
      expect(parseBrazilianOrISODate('01/01/2025')).toBe('2025-01-01');
      expect(parseBrazilianOrISODate('31-12-2024')).toBe('2024-12-31');
    });

    it('aceita datas ISO YYYY-MM-DD e compactas', () => {
      expect(parseBrazilianOrISODate('2025-03-15')).toBe('2025-03-15');
      expect(parseBrazilianOrISODate('20250315')).toBe('2025-03-15');
    });

    it('retorna null para formatos inválidos', () => {
      expect(parseBrazilianOrISODate('')).toBeNull();
      expect(parseBrazilianOrISODate('texto_qualquer')).toBeNull();
    });
  });

  describe('parseMoney', () => {
    it('converte padrão brasileiro com vírgula e ponto de milhar', () => {
      expect(parseMoney('1.500,50')).toBe(1500.5);
      expect(parseMoney('-2.350,90')).toBe(-2350.9);
      expect(parseMoney('R$ 10.000,00')).toBe(10000);
    });

    it('converte padrão americano', () => {
      expect(parseMoney('1,500.50')).toBe(1500.5);
      expect(parseMoney('-250.75')).toBe(-250.75);
    });

    it('interpreta parênteses como número negativo', () => {
      expect(parseMoney('(150,00)')).toBe(-150);
      expect(parseMoney('(1,500.00)')).toBe(-1500);
    });

    it('interpreta indicador D e C de extrato bancário', () => {
      expect(parseMoney('120,50 D')).toBe(-120.5);
      expect(parseMoney('500,00 C')).toBe(500);
    });
  });

  describe('generateCSVFitid', () => {
    it('é determinístico: mesmas entradas geram exatamente o mesmo FITID', () => {
      const id1 = generateCSVFitid('c1', 'itau-1', '2025-03-15', -100.5, 'Pgto Fornecedor', 0);
      const id2 = generateCSVFitid('c1', 'itau-1', '2025-03-15', -100.5, 'Pgto Fornecedor', 0);
      expect(id1).toBe(id2);
      expect(id1.startsWith('CSV_')).toBe(true);
    });

    it('diferencia linhas diferentes com mesmo valor e descrição', () => {
      const id1 = generateCSVFitid('c1', 'itau-1', '2025-03-15', -100.5, 'Pgto Fornecedor', 0);
      const id2 = generateCSVFitid('c1', 'itau-1', '2025-03-15', -100.5, 'Pgto Fornecedor', 1);
      expect(id1).not.toBe(id2);
    });
  });

  describe('guessCSVColumns', () => {
    it('adivinha corretamente colunas típicas brasileiras', () => {
      const headers = ['Data Lançamento', 'Histórico', 'Valor (R$)', 'Documento'];
      const guessed = guessCSVColumns(headers);
      expect(guessed.dateCol).toBe(0);
      expect(guessed.memoCol).toBe(1);
      expect(guessed.amountCol).toBe(2);
      expect(guessed.docCol).toBe(3);
      expect(guessed.valueMode).toBe('single');
    });

    it('detecta modo dividido quando há colunas de débito e crédito', () => {
      const headers = ['Data', 'Descrição', 'Débito', 'Crédito'];
      const guessed = guessCSVColumns(headers);
      expect(guessed.valueMode).toBe('split');
      expect(guessed.debitCol).toBe(2);
      expect(guessed.creditCol).toBe(3);
    });
  });

  describe('parseCSVToOFXResult', () => {
    it('converte extrato CSV com coluna única para OFXParseResult', () => {
      const csv = `Data;Descrição;Valor;Doc
10/05/2025;Recebimento de Cliente;5000,00;DOC1
12/05/2025;Pagamento de Aluguel;-1200,00;DOC2
15/05/2025;Tarifa Bancária;-45,50;DOC3`;

      const preview = previewCSV(csv);
      const result = parseCSVToOFXResult({
        content: csv,
        mapping: preview.guessedMapping,
        clientId: 'c1',
        accountKey: 'banco-1',
        delimiter: preview.delimiter,
      });

      expect(result.transactions).toHaveLength(3);
      expect(result.startDate).toBe('2025-05-10');
      expect(result.endDate).toBe('2025-05-15');

      expect(result.transactions[0].amount).toBe(5000);
      expect(result.transactions[0].type).toBe('CREDIT');
      expect(result.transactions[0].memo).toBe('Recebimento de Cliente');
      expect(result.transactions[0].fitid).toBe('DOC1');

      expect(result.transactions[1].amount).toBe(-1200);
      expect(result.transactions[1].type).toBe('DEBIT');
      expect(result.transactions[1].fitid).toBe('DOC2');
    });

    it('inverte sinais quando mapping.invertSigns === true (Fatura de Cartão de Crédito)', () => {
      const csvCard = `Data,Estabelecimento,Valor
10/05/2025,Amazon Marketplace,150.00
11/05/2025,Restaurante,85.50
12/05/2025,Estorno Compra,-30.00`;

      const preview = previewCSV(csvCard);
      const result = parseCSVToOFXResult({
        content: csvCard,
        mapping: {
          ...preview.guessedMapping,
          invertSigns: true,
        },
        clientId: 'c1',
        accountKey: 'cartao-1',
        delimiter: preview.delimiter,
      });

      expect(result.transactions).toHaveLength(3);
      // Na fatura do cartão a compra vem como +150, com invertSigns deve virar saída/débito (-150)
      expect(result.transactions[0].amount).toBe(-150);
      expect(result.transactions[0].type).toBe('DEBIT');

      expect(result.transactions[1].amount).toBe(-85.5);
      expect(result.transactions[1].type).toBe('DEBIT');

      // O estorno vem como -30, com invertSigns vira entrada/crédito (+30)
      expect(result.transactions[2].amount).toBe(30);
      expect(result.transactions[2].type).toBe('CREDIT');
    });
  });
});
