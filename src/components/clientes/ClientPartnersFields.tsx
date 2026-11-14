'use client';

import { PenLine, Plus, Trash2 } from 'lucide-react';
import type { CompanyPartner } from '@/types/firestore';
import { BUTTON, Field, INPUT, INPUT_COMPACT } from '@/components/ui/primitives';
import { DateBRInput } from '@/components/clientes/ClientRegistrationFields';

/**
 * Quadro de Sócios e Administradores (QSA), editável. A Receita mascara o CPF dos sócios
 * pessoa física (***.123.456-**); o CPF completo de quem assina fica no representante legal.
 */
export function ClientPartnersFields({
  partners,
  onChange,
  legalRepresentativeName,
  onUseAsRepresentative,
}: {
  partners: CompanyPartner[];
  onChange: (next: CompanyPartner[]) => void;
  legalRepresentativeName: string;
  /** Usa o sócio como representante legal (quem assina as demonstrações). */
  onUseAsRepresentative: (partner: CompanyPartner) => void;
}) {
  const update = (i: number, patch: Partial<CompanyPartner>) => onChange(partners.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-stone-500 dark:text-stone-400">
          {partners.length === 0 ? 'Nenhum sócio cadastrado. A consulta pelo CNPJ traz o QSA da Receita.' : `${partners.length} sócio(s) ou administrador(es).`}
        </p>
        <button type="button" className={BUTTON.secondary} onClick={() => onChange([...partners, { name: '' }])}>
          <Plus className="w-4 h-4" /> Adicionar sócio
        </button>
      </div>

      {partners.map((p, i) => {
        const signs = Boolean(p.name.trim()) && sameName(p.name, legalRepresentativeName);
        return (
          <fieldset key={i} className="rounded-2xl border border-line p-4 space-y-3">
            <legend className="sr-only">Sócio {i + 1}</legend>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-3">
              <Field label="Nome / razão social">
                <input value={p.name} onChange={(e) => update(i, { name: e.target.value })} className={INPUT} />
              </Field>
              <Field label="CPF / CNPJ">
                <input value={p.document ?? ''} onChange={(e) => update(i, { document: e.target.value || undefined })} placeholder="***.000.000-**" className={`${INPUT} font-mono tabular-nums`} />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_170px_1fr_140px] gap-3">
              <Field label="Qualificação">
                <input value={p.role ?? ''} onChange={(e) => update(i, { role: e.target.value || undefined })} placeholder="ex.: Sócio-Administrador" className={INPUT} />
              </Field>
              <Field label="Data de entrada">
                <DateBRInput value={p.since} onChange={(since) => update(i, { since })} />
              </Field>
              <Field label="Faixa etária" hint="Opcional">
                <input value={p.ageRange ?? ''} onChange={(e) => update(i, { ageRange: e.target.value || undefined })} className={INPUT} />
              </Field>
              <Field label="País" hint="Sócio estrangeiro">
                <input value={p.country ?? ''} onChange={(e) => update(i, { country: e.target.value || undefined })} className={INPUT} />
              </Field>
            </div>
            {(p.representativeName || p.representativeDocument || p.representativeRole) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Representante do sócio">
                  <input value={p.representativeName ?? ''} onChange={(e) => update(i, { representativeName: e.target.value || undefined })} className={INPUT_COMPACT} />
                </Field>
                <Field label="CPF do representante">
                  <input value={p.representativeDocument ?? ''} onChange={(e) => update(i, { representativeDocument: e.target.value || undefined })} className={`${INPUT_COMPACT} font-mono`} />
                </Field>
                <Field label="Qualificação do representante">
                  <input value={p.representativeRole ?? ''} onChange={(e) => update(i, { representativeRole: e.target.value || undefined })} className={INPUT_COMPACT} />
                </Field>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {signs ? (
                <span className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">Assina as demonstrações</span>
              ) : (
                <button type="button" className={BUTTON.ghost} disabled={!p.name.trim()} onClick={() => onUseAsRepresentative(p)}>
                  <PenLine className="w-4 h-4" /> Usar como representante legal
                </button>
              )}
              <button type="button" className={`${BUTTON.ghost} text-rose-600 dark:text-rose-400`} onClick={() => onChange(partners.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4" /> Remover
              </button>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
