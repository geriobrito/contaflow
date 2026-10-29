import { NextResponse } from 'next/server';
import { fetchCNPJFromProviders } from '@/lib/cnpj';
import { cleanCNPJ, isValidCNPJ } from '@/lib/utils/formatters';

/**
 * Proxy server-side para consulta pública de CNPJ.
 * Mantém a Content-Security-Policy estrita (`connect-src 'self'`) no navegador
 * e adiciona cache HTTP de 24h para evitar rate-limiting em consultas repetidas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cnpj: string }> }
) {
  const { cnpj: rawCnpj } = await params;
  const cnpj = cleanCNPJ(rawCnpj);

  if (cnpj.length !== 14 || !isValidCNPJ(cnpj)) {
    return NextResponse.json(
      { error: 'CNPJ inválido.' },
      { status: 400 }
    );
  }

  const outcome = await fetchCNPJFromProviders(cnpj);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.status }
    );
  }

  return NextResponse.json(outcome.data, {
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}

