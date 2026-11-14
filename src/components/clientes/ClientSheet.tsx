'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, Sparkles, XCircle } from 'lucide-react';
import type { ClientCompany, CompanyAddress, CompanyPartner, CompanyPorte, CompanyRegistration, TaxRegime } from '@/types/firestore';
import type { ClientFormFields } from '@/lib/cnpj-review';
import type { CNPJLookupResult } from '@/lib/cnpj';
import { CnpjReviewPanel } from '@/components/clientes/CnpjReviewPanel';
import { saveClient } from '@/lib/services/data-service';
import { PORTE_HINT, PORTE_LABEL, porteOf } from '@/lib/accounting-standard';
import { cleanCNPJ, cleanDigits, formatCNPJ, isValidCNPJ, isValidCPF, maskCNPJ, maskCPF } from '@/lib/utils/formatters';
import { newClientId } from '@/lib/utils/id';
import { fieldsKeptOutsideForm } from '@/lib/client-record';
import { useCnpjLookup } from '@/hooks/clientes/useCnpjLookup';
import { useCepLookup } from '@/hooks/clientes/useCepLookup';
import { ACTIVITY_MAX, formatCityUF } from '@/lib/cnpj';
import { formatAddress } from '@/lib/cnpj-card';
import { maskCEP } from '@/lib/cep';
import { BUTTON, Field, INPUT, SegmentedControl, Sheet, INPUT_MONEY } from '@/components/ui/primitives';
import { PORTES, REGIMES } from '@/components/clientes/options';
import { ClientAddressFields } from '@/components/clientes/ClientAddressFields';
import { ClientPartnersFields } from '@/components/clientes/ClientPartnersFields';
import { ClientRegistrationFields, DateBRInput } from '@/components/clientes/ClientRegistrationFields';

interface ClientSheetProps {
  /** Empresa em edição, ou null para cadastrar uma nova. */
  client: ClientCompany | null;
  onClose: () => void;
  onSaved: (client: ClientCompany) => void;
}

type Tab = 'cadastro' | 'endereco' | 'cartao' | 'socios';

/** Tira campos vazios de um objeto (o cadastro não guarda chaves sem valor). */
function compact<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return Object.keys(out).length ? (out as T) : undefined;
}

/**
 * Cadastro / edição de empresa em abas: dados gerais, endereço (com busca pelo CEP), cartão CNPJ
 * e quadro de sócios (QSA). O CNPJ preenche tudo pela consulta pública da Receita, e cada campo
 * continua editável.
 */
export function ClientSheet({ client, onClose, onSaved }: ClientSheetProps) {
  const [tab, setTab] = useState<Tab>('cadastro');
  const [cnpj, setCnpj] = useState(client ? maskCNPJ(client.cnpj) : '');
  const [name, setName] = useState(client?.name ?? '');
  const [tradeName, setTradeName] = useState(client?.tradeName ?? '');
  const [city, setCity] = useState(client?.city ?? '');
  const [regime, setRegime] = useState<TaxRegime>(client?.regime ?? 'SIMPLES_NACIONAL');
  const [porte, setPorte] = useState<CompanyPorte>(porteOf(client));
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [activity, setActivity] = useState(client?.activity ?? '');
  const [repName, setRepName] = useState(client?.legalRepresentativeName ?? '');
  const [repCpf, setRepCpf] = useState(client?.legalRepresentativeCpf ? maskCPF(client.legalRepresentativeCpf) : '');
  const [clientSince, setClientSince] = useState<string | undefined>(client?.clientSince);
  const [clientSinceBad, setClientSinceBad] = useState(false);
  const [address, setAddress] = useState<CompanyAddress>(client?.address ?? {});
  const [cep, setCep] = useState(client?.address?.cep ? maskCEP(client.address.cep) : '');
  const [registration, setRegistration] = useState<CompanyRegistration>(client?.registration ?? {});
  const [partners, setPartners] = useState<CompanyPartner[]>(client?.partners ?? []);
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
  const sinceError = clientSinceBad ? 'Data inválida: use DD/MM/AAAA.' : clientSince && clientSince > new Date().toISOString().slice(0, 10) ? 'A data não pode ser futura.' : null;
  const valid = Boolean(name.trim()) && (cnpjValid || cnpjUnchanged) && !emailError && !cpfError && !sinceError;

  /** Endereço vindo de fora (CNPJ ou CEP): leva junto o Município/UF dos termos, se ainda vazio. */
  const takeAddress = (next: CompanyAddress, fromCnpj = false) => {
    setAddress(next);
    // O endereço do cartão CNPJ já é o da Receita: o CEP dele não é consultado por cima.
    if (next.cep && fromCnpj) cepLookup.markKnown(next.cep);
    if (next.cep) setCep(maskCEP(next.cep));
    const cityUf = formatCityUF(next.municipality, next.uf);
    if (cityUf && !city.trim()) setCity(cityUf);
  };

  /** Grava no formulário os campos vindos da Receita (já conferidos por `reviewLookup`), com o cartão e o QSA. */
  const applyFields = (fields: Partial<ClientFormFields>, data: CNPJLookupResult) => {
    if (fields.name !== undefined) setName(fields.name);
    if (fields.tradeName !== undefined) setTradeName(fields.tradeName);
    if (fields.city !== undefined) setCity(fields.city);
    if (fields.email !== undefined) setEmail(fields.email);
    if (fields.phone !== undefined) setPhone(fields.phone);
    if (fields.legalRepresentativeName !== undefined) setRepName(fields.legalRepresentativeName);
    if (fields.activity !== undefined) setActivity(fields.activity);
    if (fields.regime) setRegime(fields.regime);
    if (fields.porte) setPorte(fields.porte);
    if (fields.address !== undefined && data.address) takeAddress({ ...data.address }, true);
    // O cartão e o QSA espelham a Receita: chegam inteiros a cada consulta aceita.
    if (data.registration) setRegistration({ ...data.registration, fetchedAt: new Date().toISOString() });
    if (data.partners) setPartners(data.partners);
  };

  const lookup = useCnpjLookup({
    cnpj: cnpjChars,
    valid: cnpjValid,
    savedCnpj: client ? cleanCNPJ(client.cnpj) : null,
    getForm: () => ({ name, tradeName, city, email, phone, legalRepresentativeName: repName, activity, regime, porte, address: formatAddress(address) }),
    apply: applyFields,
  });

  const cepLookup = useCepLookup({
    cep,
    savedCep: client?.address?.cep ?? null,
    // O número e o complemento digitados ficam; o resto vem dos Correios.
    onFound: (found) =>
      takeAddress({
        ...address,
        cep: found.cep,
        street: found.street ?? address.street,
        district: found.district ?? address.district,
        municipality: found.municipality,
        uf: found.uf,
        complement: address.complement || found.complement,
      }),
  });

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    const cleanPartners = partners.map((p) => compact({ ...p, name: p.name.trim() })).filter((p): p is CompanyPartner => Boolean(p?.name));
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
      activity: activity.trim().slice(0, ACTIVITY_MAX) || undefined,
      legalRepresentativeName: repName.trim() || undefined,
      legalRepresentativeCpf: cpfDigits ? maskCPF(cpfDigits) : undefined,
      clientSince: clientSince || undefined,
      address: compact({ ...address, cep: cleanDigits(cep) || undefined }),
      registration: compact({
        ...registration,
        secondaryActivities: registration.secondaryActivities?.filter((a) => a.code.trim() || a.description.trim()),
      }),
      partners: cleanPartners.length ? cleanPartners : undefined,
      createdAt: client?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      // JSON tira os `undefined` aninhados (o Firestore os recusa).
      await saveClient(JSON.parse(JSON.stringify(saved)) as ClientCompany);
      onSaved(saved);
    } catch (e: unknown) {
      setSaveError(`Não foi possível salvar o cliente (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
    } finally {
      setSaving(false);
    }
  };

  const notice = lookup.notice;
  const situation = registration.status;

  return (
    <Sheet
      title={client ? 'Editar cliente' : 'Novo cliente'}
      subtitle={client ? client.name : 'Digite o CNPJ para preencher automaticamente (cartão CNPJ e sócios) ou informe os dados.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {saveError && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">{saveError}</p>}
          <button type="button" disabled={!valid || saving} onClick={() => void submit()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
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
                cnpjError ? 'border-rose-300 dark:border-rose-500/25 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(225,29,72,0.10)]' : ''
              } ${cnpjValid ? 'border-emerald-300 dark:border-emerald-500/25' : ''}`}
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
          {cnpjError && <p className="text-[12px] text-rose-600 dark:text-rose-300 px-0.5">{cnpjError}</p>}
          {!cnpjError && lookup.loading && <p className="text-[12px] text-stone-500 px-0.5">Consultando o cartão CNPJ e o quadro de sócios…</p>}
          {!cnpjError && !lookup.loading && notice && (
            <p
              className={`flex items-center gap-1.5 text-[12px] px-0.5 ${
                notice.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : notice.kind === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500'
              }`}
            >
              {notice.kind === 'ok' && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
              {notice.kind === 'warn' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
              <span>{notice.text}</span>
            </p>
          )}
          {!cnpjError && !lookup.loading && lookup.pending && <CnpjReviewPanel pending={lookup.pending} onAccept={lookup.acceptPending} onDismiss={lookup.dismissPending} />}
        </div>

        <div className="overflow-x-auto">
          <SegmentedControl
            ariaLabel="Seção do cadastro"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'cadastro', label: 'Cadastro' },
              { value: 'endereco', label: 'Endereço' },
              { value: 'cartao', label: `Cartão CNPJ${situation ? ` · ${situation}` : ''}` },
              { value: 'socios', label: `Sócios (QSA)${partners.length ? ` · ${partners.length}` : ''}` },
            ]}
          />
        </div>

        {tab === 'cadastro' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4">
              <Field label="Razão social">
                <input autoFocus={Boolean(client)} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Cliente desde" hint="DD/MM/AAAA" error={sinceError}>
                <DateBRInput value={clientSince} onChange={setClientSince} invalid={setClientSinceBad} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nome fantasia" hint="Opcional">
                <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Município/UF" hint="Sai nos termos do Livro Diário">
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="ex.: Recife/PE" className={INPUT} />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="block text-[12px] font-medium text-stone-500 px-0.5">Regime tributário</span>
                <div className="overflow-x-auto">
                  <SegmentedControl ariaLabel="Regime tributário" value={regime} onChange={setRegime} options={REGIMES.map((r) => ({ value: r.value, label: r.short }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="block text-[12px] font-medium text-stone-500 px-0.5">Porte contábil</span>
                <div className="overflow-x-auto">
                  <SegmentedControl ariaLabel="Porte contábil" value={porte} onChange={setPorte} options={PORTES.map((p) => ({ value: p, label: PORTE_LABEL[p] }))} />
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 px-0.5">{PORTE_HINT[porte]} Define a norma citada nas demonstrações.</p>
              </div>
            </div>

            <Field label="Atividade principal" hint="Descrição do CNAE ou do objeto social. Sai na declaração de conformidade, no fim das demonstrações; vem da consulta à Receita.">
              <textarea
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                maxLength={ACTIVITY_MAX}
                rows={2}
                placeholder="ex.: Fabricação de produtos de panificação"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-line-strong text-[14px] leading-snug tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none resize-none transition-all duration-150 hover:border-black/[0.14] focus:border-accent/60 focus:bg-white dark:focus:bg-stone-800 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)]"
              />
            </Field>

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
              <p className="text-[12px] text-stone-500 dark:text-stone-400 px-0.5">Assina a DRE exportada (PDF e Excel) ao lado do contador. Na aba Sócios dá para escolher um sócio.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nome do representante" hint="Opcional">
                <input value={repName} onChange={(e) => setRepName(e.target.value)} className={INPUT} />
              </Field>
              <Field label="CPF do representante" hint="Opcional" error={cpfError}>
                <input value={repCpf} onChange={(e) => setRepCpf(maskCPF(e.target.value))} placeholder="000.000.000-00" aria-invalid={Boolean(cpfError)} className={INPUT_MONEY} />
              </Field>
            </div>
          </div>
        )}

        {tab === 'endereco' && (
          <ClientAddressFields
            address={address}
            onChange={setAddress}
            cep={cep}
            onCepChange={(v) => {
              setCep(v);
              cepLookup.clear();
            }}
            cepLoading={cepLookup.loading}
            cepMessage={cepLookup.message}
            onCepLookup={cepLookup.lookup}
          />
        )}

        {tab === 'cartao' && <ClientRegistrationFields value={registration} onChange={(next) => setRegistration({ ...next, source: next.source ?? 'manual' })} />}

        {tab === 'socios' && (
          <ClientPartnersFields
            partners={partners}
            onChange={setPartners}
            legalRepresentativeName={repName}
            onUseAsRepresentative={(p) => {
              setRepName(p.name.trim());
              // O CPF do QSA vem mascarado pela Receita: só aproveita se estiver completo.
              const digits = cleanDigits(p.document ?? '');
              if (digits.length === 11 && isValidCPF(digits)) setRepCpf(maskCPF(digits));
            }}
          />
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
