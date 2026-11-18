import { describe, expect, it } from 'vitest';
import { crc32, createZip, readZip } from '@/lib/archive/zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('zip', () => {
  it('CRC-32 conhecido', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('monta e lê de volta, com e sem compressão, nomes acentuados', async () => {
    const big = JSON.stringify({ linhas: Array.from({ length: 2000 }, (_, i) => ({ i, texto: 'lançamento repetido' })) });
    const entries = [
      { name: 'manifesto.json', data: enc.encode('{"ok":true}') },
      { name: 'Backup_Padaria_Ação_2026-11-17.json', data: enc.encode(big) },
    ];
    for (const compress of [true, false]) {
      const blob = await createZip(entries, { compress });
      const back = await readZip(await blob.arrayBuffer());
      expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
      expect(dec.decode(back[1].data)).toBe(big);
      if (compress) expect(blob.size).toBeLessThan(big.length / 5);
    }
  });

  it('recusa arquivo corrompido e conteúdo acima do limite', async () => {
    const blob = await createZip([{ name: 'a.json', data: enc.encode('x'.repeat(5000)) }], { compress: false });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const bad = buf.slice();
    bad[40] ^= 0xff; // um byte do conteúdo
    await expect(readZip(bad.buffer)).rejects.toThrow(/CRC não confere/);
    await expect(readZip(buf.buffer, { maxEntryBytes: 1000 })).rejects.toThrow(/grande demais/);
    await expect(readZip(new Uint8Array(10).buffer)).rejects.toThrow(/inválido/);
  });
});
