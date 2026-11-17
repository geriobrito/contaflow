'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CodeDescription, CompanyRegistration } from '@/types/firestore';
import { isoToBR, maskDateBR, parseDateBR } from '@/lib/utils/date-br';
import { parseMoney } from '@/lib/csv/parser';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, INPUT_MONEY, IOSSwitch, OVERLINE } from '@/components/ui/primitives';

/** Campo de data DD/MM/AAAA que guarda YYYY-MM-DD (vazio ou incompleto não grava). */
export function DateBRInput({
  value,
  onChange,
  id,
  className = INPUT,
  invalid,
}: {
  value: string | undefined;
  onChange: (iso: string | undefined) => void;
  id?: string;
  className?: string;
  /** Avisado quando o texto digitado não é uma data completa e válida. */
  invalid?: (bad: boolean) => void;
}) {
  const [text, setText] = useState(isoToBR(value));
  // Valor trocado de fora (consulta à Receita, outra empresa): o texto acompanha.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (parseDateBR(text) !== (value ?? null)) setText(isoToBR(value));
  }
  return (
    <input
      id={id}
      // Texto mascarado (e não type="date"): o formato DD/MM/AAAA não depende do idioma do navegador.
      value={text}
      inputMode="numeric"
      placeholder="DD/MM/AAAA"
      aria-invalid={Boolean(text) && !parseDateBR(text)}
      onChange={(e) => {
        const masked = maskDateBR(e.target.value);
        setText(masked);
        const iso = masked ? parseDateBR(masked) : null;
        invalid?.(Boolean(masked) && !iso);
        // Incompleta ou inexistente (31/02) não grava data nenhuma: nunca fica a anterior escondida.
        onChange(iso ?? undefined);
      }}
      className={`${className} font-mono tabular-nums ${text && !parseDateBR(text) ? 'border-rose-300 dark:border-rose-500/30' : ''}`}
    />
  );
}

function CodeDescriptionRow({ value, onChange, codePlaceholder }: { value: CodeDescription | undefined; onChange: (v: CodeDescription | undefined) => void; codePlaceholder: string }) {
  const set = (patch: Partial<CodeDescription>) => {
    const next = { code: value?.code ?? '', description: value?.description ?? '', ...patch };
    onChange(next.code || next.description ? next : undefined);
  };
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <input value={value?.code ?? ''} onChange={(e) => set({ code: e.target.value })} placeholder={codePlaceholder} className={`${INPUT} font-mono tabular-nums`} aria-label="Código" />
      <input value={value?.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="Descrição" className={INPUT} aria-label="Descrição" />
    </div>
  );
}

/** Dados do cartão CNPJ (Comprovante de Inscrição e de Situação Cadastral), todos editáveis. */
export function ClientRegistrationFields({ value, onChange }: { value: CompanyRegistration; onChange: (next: CompanyRegistration) => void }) {
  const set = <K extends keyof CompanyRegistration>(key: K, v: CompanyRegistration[K]) => onChange({ ...value, [key]: v });
  const secondary = value.secondaryActivities ?? [];
  const setSecondary = (list: CodeDescription[]) => set('secondaryActivities', list);
  const option = (key: 'simples' | 'mei', label: string) => {
    const o = value[key] ?? { optant: false };
    return (
      <div className="min-w-0 space-y-3">
        <label className="flex items-center gap-3 h-8 text-[13px] font-medium text-stone-800 dark:text-stone-200">
          <IOSSwitch checked={o.optant} onChange={(optant) => set(key, { ...o, optant })} />
          <span className="truncate">Optante pelo {label}</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <DateBRInput value={o.since} onChange={(since) => set(key, { ...o, since })} />
          </Field>
          <Field label="Excluída em">
            <DateBRInput value={o.until} onChange={(until) => set(key, { ...o, until })} />
          </Field>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {value.fetchedAt && (
        <p className="text-[12px] text-stone-500 dark:text-stone-400">
          Consultado na Receita em {isoToBR(value.fetchedAt.slice(0, 10))}
          {value.source && value.source !== 'manual' ? ` (${value.source === 'brasilapi' ? 'BrasilAPI' : 'CNPJ.ws'})` : ''}. Edite o que precisar; &quot;Atualizar pela Receita&quot; refaz a
          consulta.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Matriz ou filial">
          <select value={value.branch ?? ''} onChange={(e) => set('branch', (e.target.value || undefined) as CompanyRegistration['branch'])} className={INPUT}>
            <option value="">—</option>
            <option value="MATRIZ">Matriz</option>
            <option value="FILIAL">Filial</option>
          </select>
        </Field>
        <Field label="Data de abertura">
          <DateBRInput value={value.openedAt} onChange={(v) => set('openedAt', v)} />
        </Field>
        <Field label="Porte (Receita)">
          <input value={value.sizeLabel ?? ''} onChange={(e) => set('sizeLabel', e.target.value || undefined)} placeholder="ex.: MICRO EMPRESA" className={INPUT} />
        </Field>
        <Field label="Capital social (R$)" hint={value.shareCapital !== undefined ? formatCurrency(value.shareCapital) : undefined}>
          <input
            defaultValue={value.shareCapital !== undefined ? String(value.shareCapital).replace('.', ',') : ''}
            key={value.shareCapital ?? 'vazio'}
            onBlur={(e) => {
              const n = parseMoney(e.target.value);
              set('shareCapital', n === null ? undefined : n);
            }}
            inputMode="decimal"
            className={INPUT_MONEY}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <span className="block text-[12px] font-medium text-stone-600 dark:text-stone-400 px-0.5">Natureza jurídica</span>
        <CodeDescriptionRow value={value.legalNature} onChange={(v) => set('legalNature', v)} codePlaceholder="206-2" />
      </div>

      <div className="space-y-1.5">
        <span className="block text-[12px] font-medium text-stone-600 dark:text-stone-400 px-0.5">Atividade econômica principal (CNAE)</span>
        <CodeDescriptionRow value={value.mainActivity} onChange={(v) => set('mainActivity', v)} codePlaceholder="00.00-0-00" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[12px] font-medium text-stone-600 dark:text-stone-400">Atividades econômicas secundárias ({secondary.length})</span>
          <button type="button" className={BUTTON.ghost} onClick={() => setSecondary([...secondary, { code: '', description: '' }])}>
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {secondary.length === 0 && <p className="text-[12px] text-stone-500 px-0.5">Nenhuma.</p>}
        {secondary.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <CodeDescriptionRow value={a} onChange={(v) => setSecondary(secondary.map((x, j) => (j === i ? (v ?? { code: '', description: '' }) : x)))} codePlaceholder="00.00-0-00" />
            </div>
            <button type="button" aria-label="Remover atividade" className="w-9 h-9 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-500/10" onClick={() => setSecondary(secondary.filter((_, j) => j !== i))}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className={OVERLINE}>Situação cadastral</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Situação">
            <input value={value.status ?? ''} onChange={(e) => set('status', e.target.value || undefined)} placeholder="ATIVA" className={INPUT} />
          </Field>
          <Field label="Data da situação">
            <DateBRInput value={value.statusDate} onChange={(v) => set('statusDate', v)} />
          </Field>
          <Field label="Motivo">
            <input value={value.statusReason ?? ''} onChange={(e) => set('statusReason', e.target.value || undefined)} className={INPUT} />
          </Field>
          <Field label="Situação especial">
            <input value={value.specialStatus ?? ''} onChange={(e) => set('specialStatus', e.target.value || undefined)} className={INPUT} />
          </Field>
          <Field label="Data da situação especial">
            <DateBRInput value={value.specialStatusDate} onChange={(v) => set('specialStatusDate', v)} />
          </Field>
          <Field label="Ente federativo responsável" hint="Só órgãos públicos">
            <input value={value.efr ?? ''} onChange={(e) => set('efr', e.target.value || undefined)} className={INPUT} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <p className={OVERLINE}>Simples Nacional e SIMEI</p>
        {/* Três colunas iguais às da situação cadastral; o telefone alinha pela base com as datas. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-5 md:items-end">
          {option('simples', 'Simples Nacional')}
          {option('mei', 'SIMEI (MEI)')}
          <Field label="Telefone 2">
            <input type="tel" value={value.phone2 ?? ''} onChange={(e) => set('phone2', e.target.value || undefined)} className={INPUT} />
          </Field>
        </div>
      </div>
    </div>
  );
}
