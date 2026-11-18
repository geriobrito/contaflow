/**
 * DANFSe (documento auxiliar da NFS-e) gerada no navegador pelo gerador oficial da Receita
 * Federal (calculadora-rtc-gerador-danfse, layout da NT 008), compilado para WebAssembly em
 * public/danfse/ por scripts/build-danfse-wasm.py. O XML não sai do navegador nem é guardado.
 *
 * O WASM (cerca de 3 MB comprimido) só é baixado na primeira DANFSe gerada; depois fica na
 * memória da página.
 */

/** Situação impressa na DANFSe (stc do gerador). */
export type DanfseSituation = 'NORMAL' | 'SUBSTITUTED' | 'CANCELLED';

export const DANFSE_SITUATION_LABEL: Record<DanfseSituation, string> = {
  NORMAL: 'Normal',
  SUBSTITUTED: 'Substituída',
  CANCELLED: 'Cancelada',
};

const STC: Record<DanfseSituation, number> = { NORMAL: 0, SUBSTITUTED: 1, CANCELLED: 2 };

/** Limite do gerador para o XML (5 MiB). */
export const DANFSE_MAX_XML_BYTES = 5 * 1024 * 1024;

interface DanfseApi {
  ready: boolean;
  error: string;
  gerarPdf: (requestJson: string) => { pdf?: string; size?: number; error?: string };
}

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run: (instance: WebAssembly.Instance) => Promise<void>;
}

type DanfseGlobal = typeof globalThis & { Go?: new () => GoRuntime; danfseWasm?: DanfseApi };

const BASE = '/danfse';
let loading: Promise<DanfseApi> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('não foi possível carregar o gerador de DANFSe'));
    document.head.appendChild(script);
  });
}

async function instantiate(go: GoRuntime): Promise<WebAssembly.Instance> {
  const response = await fetch(`${BASE}/danfse.wasm`);
  if (!response.ok) throw new Error(`gerador de DANFSe indisponível (erro ${response.status})`);
  if (typeof WebAssembly.instantiateStreaming === 'function' && response.headers.get('content-type')?.includes('application/wasm')) {
    return (await WebAssembly.instantiateStreaming(response, go.importObject)).instance;
  }
  return (await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject)).instance;
}

async function load(): Promise<DanfseApi> {
  const g = globalThis as DanfseGlobal;
  if (!g.Go) await loadScript(`${BASE}/wasm_exec.js`);
  if (!g.Go) throw new Error('carregador do gerador de DANFSe ausente');
  const go = new g.Go();
  const instance = await instantiate(go);
  // O programa Go fica vivo (select {}) e publica a API em `danfseWasm`.
  void go.run(instance);
  for (let i = 0; i < 200 && !g.danfseWasm; i++) await new Promise((r) => setTimeout(r, 25));
  const api = g.danfseWasm;
  if (!api) throw new Error('o gerador de DANFSe não respondeu');
  if (!api.ready) throw new Error(`o gerador de DANFSe não iniciou (${api.error || 'erro desconhecido'})`);
  return api;
}

/** Carrega o gerador uma vez por página (uma falha libera nova tentativa). */
function generator(): Promise<DanfseApi> {
  if (!loading) loading = load().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gera o PDF da DANFSe a partir do XML da NFS-e do padrão nacional. */
export async function generateDanfse(xml: string, options: { situation: DanfseSituation; stub: boolean }): Promise<Blob> {
  if (new TextEncoder().encode(xml).length > DANFSE_MAX_XML_BYTES) throw new Error('o XML passa de 5 MB, o limite do gerador');
  const api = await generator();
  const result = api.gerarPdf(JSON.stringify({ xml, stc: STC[options.situation], canhoto: options.stub }));
  if (result.error || !result.pdf) throw new Error(result.error || 'o gerador não devolveu o PDF');
  return new Blob([base64ToBytes(result.pdf)], { type: 'application/pdf' });
}
