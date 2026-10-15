import React from 'react';
import type { ClientCompany, OrgSettings } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';

const BLANK = '____________________________________';

function Signature({ name, role, idLabel, id }: { name?: string; role: string; idLabel: string; id?: string }) {
  return (
    <div className="text-center">
      <div className="border-t border-stone-800 pt-1.5 w-64 mx-auto">
        <p className="text-[10px] font-semibold text-stone-900">{name?.trim() || BLANK}</p>
        <p className="text-[9px] text-stone-600">{role}</p>
        {id?.trim() && <p className="text-[9px] text-stone-600">{`${idLabel}: ${id.trim()}`}</p>}
      </div>
    </div>
  );
}

/**
 * Assinaturas do representante legal e do contador, só na impressão. Mesmo bloco dos PDFs:
 * nome, cargo e CPF/CRC; o contador vem do cadastro do escritório.
 */
export function LedgerPrintSignatures({
  client,
  org,
  document = 'Livro Razão',
}: {
  client: ClientCompany | null;
  org: OrgSettings | null | undefined;
  document?: string;
}) {
  return (
    <section aria-label="Assinaturas contábeis" className="hidden print:block pt-8 print-avoid-break">
      <div className="text-[9px] text-stone-500 mb-6 text-center">
        {accountingStandard(client)} - {document} emitido em {new Date().toLocaleDateString('pt-BR')} via ContaFlow
      </div>
      <div className="grid grid-cols-2 gap-8 pt-4">
        <Signature name={client?.legalRepresentativeName} role="Representante Legal / Administrador" idLabel="CPF" id={client?.legalRepresentativeCpf} />
        <Signature name={org?.accountantName} role="Profissional da Contabilidade" idLabel="CRC" id={org?.accountantCrc} />
      </div>
    </section>
  );
}
