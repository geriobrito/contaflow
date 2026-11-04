'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, Sparkles, XCircle } from 'lucide-react';
import type { ClientCompany, CompanyPorte, TaxRegime } from '@/types/firestore';
import type { ClientFormFields } from '@/lib/cnpj-review';
import { CnpjReviewPanel } from '@/components/clientes/CnpjReviewPanel';
import { saveClient } from '@/lib/services/data-service';
import { PORTE_HINT, PORTE_LABEL, porteOf } from '@/lib/accounting-standard';
import { cleanCNPJ, cleanDigits, formatCNPJ, isValidCNPJ, isValidCPF, maskCNPJ, maskCPF } from '@/lib/utils/formatters';
import { newClientId } from '@/lib/utils/id';
import { fieldsKeptOutsideForm } from '@/lib/client-record';
import { useCnpjLookup } from '@/hooks/clientes/useCnpjLookup';
import { BUTTON, Field, INPUT, SegmentedControl, Sheet } from '@/components/ui/primitives';
import { PORTES, REGIMES } from '@/components/clientes/options';

interface ClientSheetProps {
  /** Empresa em edição, ou null para cadastrar uma nova. */
  client: ClientCompany | null;
  onClose: () => void;
  onSaved: (client: ClientCompany) => void;
}

/** Painel de cadastro / edição de empresa, com preenchimento pelo CNPJ. */
export function ClientSheet({ client, onClose, onSaved }: ClientSheetProps) {
  const [cnpj, setCnpj] = useState(client ? maskCNPJ(client.cnpj) : '');
  const [name, setName] = useState(client?.name ?? '');
  const [tradeName, setTradeName] = useState(client?.tradeName ?? '');
  const [city, setCity] = useState(client?.city ?? '');
  const [regime, setRegime] = useState<TaxRegime>(client?.regime ?? 'SIMPLES_NACIONAL');
  const [porte, setPorte] = useState<CompanyPorte>(porteOf(client));
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [repName, setRepName] = useState(client?.legalRepresentativeName ?? '');
  const [repCpf, setRepCpf] = useState(client?.legalRepresentativeCpf ? maskCPF(client.legalRepresentativeCpf) : '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cnpjChars = cleanCNPJ(cnpj);
  const complete = cnpjChars.length === 14;
  const cnpjValid = complete && isValidCNPJ(cnpjChars);
  // Registros legados com CNPJ inválido podem ser salvos sem alterar o documento.
  const cnpjUnchanged = Boolean(client) && cnpjChars === cleanCNPJ(client?.cnpj ?? '');
  const cnpjError = complete && !cnpjValid ? 'CNPJ inválido: dígitos verificadores não conferem.' : null;
  const emailError = email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'E-mail inválido.' : null;
  const cpfDigits = cleanDigits(repCpf);
  const cpfError = cpfDigits && !(cpfDigits.length === 11 && isValidCPF(cpfDigits)) ? 'CPF inválido.' : null;
  const valid = Boolean(name.trim()) && (cnpjValid || cnpjUnchanged) && !emailError && !cpfError;

  /** Grava no formulário os campos vindos da Receita (já conferidos por `reviewLookup`). */
  const applyFields = (fields: Partial<ClientFormFields>) => {
    if (fields.name !== undefined) setName(fields.name);
    if (fields.tradeName !== undefined) setTradeName(fields.tradeName);
    if (fields.city !== undefined) setCity(fields.city);
    if (fields.email !== undefined) setEmail(fields.email);
    if (fields.phone !== undefined) setPhone(fields.phone);
    if (fields.legalRepresentativeName !== undefined) setRepName(fields.legalRepresentativeName);
    if (fields.regime) setRegime(fields.regime);
    if (fields.porte) setPorte(fields.porte);
  };

  const lookup = useCnpjLookup({
    cnpj: cnpjChars,
    valid: cnpjValid,
    savedCnpj: client ? cleanCNPJ(client.cnpj) : null,
    getForm: () => ({ name, tradeName, city, email, phone, legalRepresentativeName: repName, regime, porte }),
    apply: applyFields,
  });

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    const saved: ClientCompany = {
      id: client?.id ?? newClientId(),
      name: name.trim(),
      tradeName: tradeName.trim() || undefined,
      cnpj: formatCNPJ(cnpjChars),
      city: city.trim() || undefined,
      regime,
      porte,
      // Dados gravados fora deste formulário (Plano de Contas, Livro Diário) seguem com o cadastro.
      ...fieldsKeptOutsideForm(client),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      legalRepresentativeName: repName.trim() || undefined,
      legalRepresentativeCpf: cpfDigits ? maskCPF(cpfDigits) : undefined,
      createdAt: client?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await saveClient(saved);
      onSaved(saved);
    } catch (e: unknown) {
      setSaveError(`Não foi possível salvar o cliente (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
    } finally {
      setSaving(false);
    }
  };

  const notice = lookup.notice;

  return (
    <Sheet
      title={client ? 'Editar cliente' : 'Novo cliente'}
      subtitle={client ? client.name : 'Digite o CNPJ para preencher automaticamente ou informe os dados abaixo.'}
      onClose={onClose}
      footer={
        <>
          {saveError && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{saveError}</p>}
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void submit()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {saving ? 'Salvando…' : client ? 'Salvar alterações' : 'Cadastrar cliente'}
          </button>
        </>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <label htmlFor="client-cnpj" className="text-[12px] font-medium text-stone-500">
              CNPJ
            </label>
            {cnpjValid && (
              <button
                type="button"
                disabled={lookup.loading}
                onClick={() => void lookup.lookup(cnpjChars, true)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline disabled:opacity-50"
              >
                {lookup.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {client ? 'Atualizar pela Receita' : 'Consultar Receita'}
              </button>
            )}
          </div>
          <div className="relative">
            <input
              id="client-cnpj"
              autoFocus={!client}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={cnpj}
              onChange={(e) => {
                setCnpj(maskCNPJ(e.target.value));
                if (notice || lookup.pending) lookup.clearNotice();
              }}
              placeholder="00.000.000/0000-00"
              aria-invalid={Boolean(cnpjError)}
              className={`${INPUT} pr-10 font-mono tabular-nums ${
                cnpjError ? 'border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(225,29,72,0.10)]' : ''
              } ${cnpjValid ? 'border-emerald-300' : ''}`}
            />
            {lookup.loading ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 animate-spin text-accent-ink" />
              </span>
            ) : (
              complete && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 animate-pop-in">
                  {cnpjValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-rose-500" />}
                </span>
              )
            )}
          </div>
          {cnpjError && <p className="text-[12px] text-rose-600 px-0.5">{cnpjError}</p>}
          {!cnpjError && lookup.loading && <p className="text-[12px] text-stone-500 px-0.5">Consultando dados cadastrais do CNPJ…</p>}
          {!cnpjError && !lookup.loading && notice && (
            <p
              className={`flex items-center gap-1.5 text-[12px] px-0.5 ${
                notice.kind === 'ok'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : notice.kind === 'warn'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-stone-500'
              }`}
            >
              {notice.kind === 'ok' && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
              {notice.kind === 'warn' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
              <span>{notice.text}</span>
            </p>
          )}
          {!cnpjError && !lookup.loading && lookup.pending && (
            <CnpjReviewPanel pending={lookup.pending} onAccept={lookup.acceptPending} onDismiss={lookup.dismissPending} />
          )}
        </div>

        <Field label="Razão social">
          <input autoFocus={Boolean(client)} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome fantasia" hint="Opcional">
            <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Município/UF" hint="Opcional">
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="ex.: Recife/PE" className={INPUT} />
          </Field>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-stone-500 px-0.5">Regime tributário</span>
          <div className="overflow-x-auto">
            <SegmentedControl
              ariaLabel="Regime tributário"
              value={regime}
              onChange={setRegime}
              options={REGIMES.map((r) => ({ value: r.value, label: r.short }))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-stone-500 px-0.5">Porte contábil</span>
          <div className="overflow-x-auto">
            <SegmentedControl
              ariaLabel="Porte contábil"
              value={porte}
              onChange={setPorte}
              options={PORTES.map((p) => ({ value: p, label: PORTE_LABEL[p] }))}
            />
          </div>
          <p className="text-[11px] text-stone-400 px-0.5">{PORTE_HINT[porte]} Define a norma citada nas demonstrações.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="E-mail" error={emailError}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Telefone">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
          </Field>
        </div>

        <div className="pt-2 space-y-1">
          <span className="block text-[13px] font-semibold text-stone-800 dark:text-stone-200 px-0.5">Representante legal</span>
          <p className="text-[12px] text-stone-400 px-0.5">Assina a DRE exportada (PDF e Excel) ao lado do contador.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome do representante" hint="Opcional">
            <input value={repName} onChange={(e) => setRepName(e.target.value)} className={INPUT} />
          </Field>
          <Field label="CPF do representante" hint="Opcional" error={cpfError}>
            <input
              value={repCpf}
              onChange={(e) => setRepCpf(maskCPF(e.target.value))}
              placeholder="000.000.000-00"
              aria-invalid={Boolean(cpfError)}
              className={`${INPUT} font-mono tabular-nums`}
            />
          </Field>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
