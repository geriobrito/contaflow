import React from 'react';
import type { ClientCompany, OrgSettings } from '@/types/firestore';

/** Assinaturas do representante legal e do contador, só na impressão da ficha. */
export function LedgerPrintSignatures({ client, org }: { client: ClientCompany | null; org: OrgSettings | null | undefined }) {
  return (
    <section aria-label="Assinaturas contábeis" className="hidden print:block pt-8 print-avoid-break">
      <div className="text-[9px] text-stone-500 mb-6 text-center">
        NBC TG 1002 / ITG 1000 — Livro Razão emitido em {new Date().toLocaleDateString('pt-BR')} via ContaFlow
      </div>
      <div className="grid grid-cols-2 gap-8 pt-4">
        <div className="text-center">
          <div className="border-t border-stone-800 pt-1.5 w-64 mx-auto">
            <p className="text-[10px] font-semibold text-stone-900 uppercase">
              {client?.legalRepresentativeName || client?.name || 'Representante Legal'}
            </p>
            <p className="text-[9px] text-stone-600">
              {client?.legalRepresentativeCpf ? `CPF: ${client.legalRepresentativeCpf}` : 'Representante Legal'}
            </p>
          </div>
        </div>
        <div className="text-center">
          <div className="border-t border-stone-800 pt-1.5 w-64 mx-auto">
            <p className="text-[10px] font-semibold text-stone-900 uppercase">
              {org?.accountantName || 'Contador Responsável'}
            </p>
            <p className="text-[9px] text-stone-600">
              {org?.accountantCrc ? `CRC: ${org.accountantCrc}` : 'Contador'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
