/**
 * Preparação de comprovantes enviados pelo cliente (navegador).
 *
 * Os arquivos vão para o Firestore em base64, então precisam caber num documento:
 * fotos são reduzidas (lado maior até 1600 px, JPEG) e PDFs têm limite de tamanho.
 */

/** Tamanho máximo do arquivo final (antes do base64), alinhado com firestore.rules. */
export const MAX_UPLOAD_BYTES = 700_000;

export interface PreparedFile {
  name: string;
  type: string;
  bytes: number;
  /** Base64 sem o prefixo `data:`. */
  data: string;
}

const ACCEPTED = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Imagem ilegível. Envie JPG, PNG ou PDF.'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Não foi possível processar a imagem.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareUpload(file: File): Promise<PreparedFile> {
  if (!ACCEPTED.test(file.type)) throw new Error(`“${file.name}”: envie foto (JPG, PNG) ou PDF.`);
  let blob: Blob = file;
  let name = file.name;
  let type = file.type;
  if (file.type.startsWith('image/')) {
    blob = await shrinkImage(file);
    type = 'image/jpeg';
    name = name.replace(/\.[^.]+$/, '') + '.jpg';
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`“${file.name}” tem ${(blob.size / 1_000_000).toFixed(1)} MB; o limite é ${(MAX_UPLOAD_BYTES / 1_000_000).toFixed(1)} MB por arquivo.`);
  }
  const dataUrl = await readAsDataURL(blob);
  return { name, type, bytes: blob.size, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

/** Abre um comprovante (base64) numa nova aba. */
export function openBase64File(data: string, type: string): void {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
