'use client';

import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import type { ClientCompany, TaxRegime } from '@/types/firestore';
import { saveClient } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { cleanDigits, formatCNPJ, isValidCNPJ, maskCNPJ } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, Field, INPUT, PageHeader, SearchField, SegmentedControl, Sheet } from '@/components/ui/primitives';

const REGIMES: readonly { value: TaxRegime; label: string; short: string }[] = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional', short: 'Simples' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido', short: 'Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real', short: 'Real' },
  { value: 'MEI', label: 'MEI', short: 'MEI' },
];

const regimeLabel = (r: TaxRegime) => REGIMES.find((x) => x.value === r)?.label ?? r;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/* =========================================================================
   Cartão de cliente (Apple Card)
   ========================================================================= */

interface ClientCardProps {
  client: ClientCompany;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  deleting: boolean;
}

function ClientCard({ client, active, onActivate, onEdit, onDelete, deleting }: ClientCardProps) {
  const regime = client.regime ?? client.taxRegime;
  return (
    <article
      className={`relative flex flex-col rounded-[22px] p-5 backdrop-blur-xl border transition-all duration-200 ${
        active
          ? 'bg-white dark:bg-stone-900 border-[#0071E3]/30 shadow-[0_0_0_4px_rgba(0,113,227,0.08),0_8px_24px_rgba(0,0,0,0.06)]'
          : 'bg-white/70 dark:bg-stone-900/60 border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-[13px] font-semibold tracking-tight ${
            active ? 'bg-[#0071E3] text-white' : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
          }`}
        >
          {initials(client.tradeName || client.name) || '—'}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50 truncate">
            {client.tradeName || client.name}
          </h3>
          <p className="text-[12px] text-stone-500 truncate">{client.name}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${client.name}`}
          className="w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-[12px]">
        <div className="min-w-0">
          <dt className="text-stone-400">CNPJ</dt>
          <dd className="mt-0.5 font-mono tabular-nums text-stone-800 dark:text-stone-200 truncate">{formatCNPJ(client.cnpj)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-stone-400">Regime</dt>
          <dd className="mt-0.5 text-stone-800 dark:text-stone-200 truncate">{regimeLabel(regime)}</dd>
        </div>
      </dl>

      <div className="mt-5 pt-4 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between gap-3">
        {active ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-emerald-50 text-emerald-700 border-emerald-200/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Ativo
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-stone-50 dark:bg-stone-800 text-stone-500 border-stone-200/60 dark:border-stone-700">
            Disponível
          </span>
        )}
        <div className="flex items-center gap-1">
          {!active && (
            <button type="button" onClick={onActivate} className={`${BUTTON.ghost} h-8 px-3 text-[#0071E3] hover:bg-blue-50 dark:hover:bg-blue-950/30`}>
              Definir como ativo
            </button>
          )}
          {deleting ? (
            <span className="px-2 text-[12px] text-stone-400">Excluindo…</span>
          ) : (
            <ConfirmButton
              ariaLabel={`Excluir ${client.tradeName || client.name} e todos os seus dados`}
              label={<Trash2 className="w-3.5 h-3.5" />}
              confirmLabel="Excluir empresa"
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/* =========================================================================
   Sheet de cadastro / edição
   ========================================================================= */

interface ClientSheetProps {
  client: ClientCompany | null;
  onClose: () => void;
  onSaved: (client: ClientCompany) => void;
}

function ClientSheet({ client, onClose, onSaved }: ClientSheetProps) {
  const [name, setName] = useState(client?.name ?? '');
  const [tradeName, setTradeName] = useState(client?.tradeName ?? '');
  const [cnpj, setCnpj] = useState(client ? maskCNPJ(client.cnpj) : '');
  const [regime, setRegime] = useState<TaxRegime>(client?.regime ?? client?.taxRegime ?? 'SIMPLES_NACIONAL');
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const digits = cleanDigits(cnpj);
  const complete = digits.length === 14;
  const cnpjValid = complete && isValidCNPJ(digits);
  // Registros legados com CNPJ inválido podem ser salvos sem alterar o documento.
  const cnpjUnchanged = Boolean(client) && digits === cleanDigits(client?.cnpj ?? '');
  const cnpjError = complete && !cnpjValid ? 'CNPJ inválido: dígitos verificadores não conferem.' : null;
  const emailError = email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'E-mail inválido.' : null;
  const valid = Boolean(name.trim()) && (cnpjValid || cnpjUnchanged) && !emailError;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const now = new Date().toISOString();
    const saved: ClientCompany = {
      id: client?.id ?? `client-${Date.now()}`,
      name: name.trim(),
      tradeName: tradeName.trim() || undefined,
      cnpj: formatCNPJ(digits),
      regime,
      taxRegime: regime,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      createdAt: client?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await saveClient(saved);
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={client ? 'Editar cliente' : 'Novo cliente'}
      subtitle={client ? client.name : 'Cadastre a empresa para importar extratos e gerar a DRE.'}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => void submit()}
          className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
        >
          {saving ? 'Salvando…' : client ? 'Salvar alterações' : 'Cadastrar cliente'}
        </button>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Razão social">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Nome fantasia" hint="Opcional">
          <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className={INPUT} />
        </Field>

        <Field label="CNPJ" error={cnpjError}>
          <div className="relative">
            <input
              inputMode="numeric"
              value={cnpj}
              onChange={(e) => setCnpj(maskCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
              aria-invalid={Boolean(cnpjError)}
              className={`${INPUT} pr-10 font-mono tabular-nums ${
                cnpjError ? 'border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(225,29,72,0.10)]' : ''
              } ${cnpjValid ? 'border-emerald-300' : ''}`}
            />
            {complete && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 animate-pop-in">
                {cnpjValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-rose-500" />}
              </span>
            )}
          </div>
        </Field>

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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="E-mail" error={emailError}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Telefone">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
          </Field>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}

/* =========================================================================
   Página
   ========================================================================= */

export default function ClientesPage() {
  const { clients, currentClient, selectClient, refreshClients, removeClient, isLoading } = useClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ClientCompany | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = cleanDigits(term);
    return clients.filter(
      (c) =>
        !term ||
        c.name.toLowerCase().includes(term) ||
        (c.tradeName?.toLowerCase().includes(term) ?? false) ||
        (digits.length > 0 && cleanDigits(c.cnpj).includes(digits))
    );
  }, [clients, search]);

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2800);
  };

  const handleSaved = async (client: ClientCompany) => {
    const isNew = !editing;
    setSheetOpen(false);
    setEditing(null);
    await refreshClients();
    if (isNew) selectClient(client);
    flash(isNew ? 'Cliente cadastrado e definido como ativo' : 'Alterações salvas');
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
      <PageHeader
        title="Clientes"
        description={
          <>
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{clients.length}</span> empresa(s) na carteira. O
            cliente ativo define os dados exibidos em todo o sistema.
          </>
        }
        actions={
          <button type="button" onClick={openNew} className={BUTTON.primary}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Novo cliente
          </button>
        }
      />

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por razão social, nome fantasia ou CNPJ" />

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-52 rounded-[22px] bg-black/[0.04] animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-black/[0.10]">
          <EmptyState
            title={clients.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado'}
            description={clients.length === 0 ? 'Cadastre a primeira empresa para começar.' : `Nada corresponde a “${search}”.`}
            action={
              clients.length === 0 ? (
                <button type="button" onClick={openNew} className={BUTTON.accent}>
                  <Plus className="w-4 h-4" />
                  Novo cliente
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              active={c.id === currentClient?.id}
              onActivate={() => {
                selectClient(c);
                flash(`${c.tradeName || c.name} definido como ativo`);
              }}
              deleting={deletingId === c.id}
              onDelete={async () => {
                setDeletingId(c.id);
                try {
                  await removeClient(c.id);
                  flash(`${c.tradeName || c.name} excluído com seus lançamentos, regras e contas`);
                } catch (e) {
                  console.error('Erro ao excluir cliente:', e);
                  flash('Não foi possível excluir a empresa');
                } finally {
                  setDeletingId(null);
                }
              }}
              onEdit={() => {
                setEditing(c);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {sheetOpen && (
        <ClientSheet
          key={editing?.id ?? 'new'}
          client={editing}
          onClose={() => {
            setSheetOpen(false);
            setEditing(null);
          }}
          onSaved={(c) => void handleSaved(c)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-stone-900/90 dark:bg-stone-100/90 text-white dark:text-stone-900 text-[13px] tracking-tight shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
          {toast}
        </div>
      )}
    </main>
  );
}
