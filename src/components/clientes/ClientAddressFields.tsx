'use client';

import { Loader2, Search } from 'lucide-react';
import type { CompanyAddress } from '@/types/firestore';
import { isValidCEP, maskCEP } from '@/lib/cep';
import { Field, INPUT } from '@/components/ui/primitives';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/** Endereço da sede: o CEP preenche logradouro, bairro, município e UF (src/hooks/clientes/useCepLookup.ts). */
export function ClientAddressFields({
  address,
  onChange,
  cep,
  onCepChange,
  cepLoading,
  cepMessage,
  onCepLookup,
}: {
  address: CompanyAddress;
  onChange: (next: CompanyAddress) => void;
  /** CEP digitado (com máscara). */
  cep: string;
  onCepChange: (value: string) => void;
  cepLoading: boolean;
  cepMessage: { kind: 'ok' | 'info'; text: string } | null;
  onCepLookup: () => void;
}) {
  const set = (field: keyof CompanyAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...address, [field]: e.target.value });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 items-start">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <label htmlFor="client-cep" className="text-[12px] font-medium text-stone-600 dark:text-stone-400">
              CEP
            </label>
            {isValidCEP(cep) && (
              <button type="button" onClick={onCepLookup} disabled={cepLoading} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline disabled:opacity-50">
                {cepLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                Buscar
              </button>
            )}
          </div>
          <input id="client-cep" value={cep} onChange={(e) => onCepChange(maskCEP(e.target.value))} placeholder="00000-000" inputMode="numeric" className={`${INPUT} font-mono tabular-nums`} />
          {cepMessage && (
            <p className={`text-[12px] px-0.5 ${cepMessage.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500'}`}>{cepMessage.text}</p>
          )}
        </div>
        <Field label="Logradouro">
          <input value={address.street ?? ''} onChange={set('street')} placeholder="ex.: Rua das Flores" className={INPUT} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_1fr] gap-4">
        <Field label="Número">
          <input value={address.number ?? ''} onChange={set('number')} placeholder="S/N" className={INPUT} />
        </Field>
        <Field label="Complemento" hint="Opcional">
          <input value={address.complement ?? ''} onChange={set('complement')} className={INPUT} />
        </Field>
        <Field label="Bairro">
          <input value={address.district ?? ''} onChange={set('district')} className={INPUT} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
        <Field label="Município">
          <input value={address.municipality ?? ''} onChange={set('municipality')} className={INPUT} />
        </Field>
        <Field label="UF">
          <select value={address.uf ?? ''} onChange={set('uf')} className={INPUT}>
            <option value="">—</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-[12px] text-stone-500 dark:text-stone-400 px-0.5">
        O endereço vem do cartão CNPJ ou do CEP (base dos Correios, pela BrasilAPI, com o ViaCEP de reserva). O Município/UF da aba Cadastro é o que sai nos termos do Livro Diário.
      </p>
    </div>
  );
}
