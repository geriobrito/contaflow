'use client';

import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, XCircle } from 'lucide-react';
import type { OrgSettings } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useAuth } from '@/contexts/AuthContext';
import { cleanDigits, formatCNPJ, isValidCNPJ, isValidCPF, maskCNPJ, maskCPF, normalizeCRC } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';

/** Ícone de validação ao lado do campo. */
function Valid({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return (
    <span className="absolute right-3 top-1/2 -translate-y-1/2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-rose-500" />}
    </span>
  );
}

/**
 * Dados do escritório e do responsável técnico (contador). Usados nas assinaturas
 * da DRE em PDF e Excel. Compartilhados por todos os usuários do escritório.
 */
export default function EscritorioPage() {
  const { orgId, user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [officeName, setOfficeName] = useState('');
  const [officeCnpj, setOfficeCnpj] = useState('');
  const [accountantName, setAccountantName] = useState('');
  const [accountantCrc, setAccountantCrc] = useState('');
  const [accountantCpf, setAccountantCpf] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    getRepository()
      .getOrgSettings()
      .then((s) => {
        if (!active) return;
        if (s) {
          setOfficeName(s.officeName ?? '');
          setOfficeCnpj(s.officeCnpj ? maskCNPJ(s.officeCnpj) : '');
          setAccountantName(s.accountantName ?? '');
          setAccountantCrc(s.accountantCrc ?? '');
          setAccountantCpf(s.accountantCpf ? maskCPF(s.accountantCpf) : '');
        }
        setLoaded(true);
      })
      .catch((e: unknown) => active && setLoadError(e instanceof Error ? e.message : 'Falha ao carregar.'));
    return () => {
      active = false;
    };
  }, [orgId]);

  const cnpjDigits = cleanDigits(officeCnpj);
  const cpfDigits = cleanDigits(accountantCpf);
  const crc = normalizeCRC(accountantCrc);
  const cnpjOk = cnpjDigits ? cnpjDigits.length === 14 && isValidCNPJ(cnpjDigits) : null;
  const cpfOk = cpfDigits ? cpfDigits.length === 11 && isValidCPF(cpfDigits) : null;
  const crcOk = accountantCrc.trim() ? Boolean(crc) : null;
  const valid = Boolean(officeName.trim() && accountantName.trim() && crc) && cnpjOk !== false && cpfOk !== false;

  const save = async () => {
    if (!orgId || !valid || !crc) return;
    setSaving(true);
    setMessage(null);
    const settings: OrgSettings = {
      orgId,
      officeName: officeName.trim(),
      accountantName: accountantName.trim(),
      accountantCrc: crc,
      updatedAt: new Date().toISOString(),
      ...(user?.uid ? { updatedByUid: user.uid } : {}),
      ...(cnpjDigits ? { officeCnpj: formatCNPJ(cnpjDigits) } : {}),
      ...(cpfDigits ? { accountantCpf: maskCPF(cpfDigits) } : {}),
    };
    try {
      await getRepository().saveOrgSettings(settings);
      setAccountantCrc(crc);
      setMessage({ ok: true, text: 'Dados salvos. As próximas DREs exportadas já saem assinadas com eles.' });
    } catch (e: unknown) {
      setMessage({ ok: false, text: `Não foi possível salvar (${e instanceof Error ? e.message : 'erro desconhecido'}).` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        title="Escritório"
        description="Dados do escritório e do profissional da contabilidade responsável. Preenchem automaticamente as assinaturas da DRE (PDF e Excel)."
      />

      {loadError && <p role="alert" className="text-[13px] text-rose-600">Não foi possível carregar: {loadError}</p>}

      <form
        className={`${SURFACE} rounded-[22px] p-5 sm:p-7 max-w-3xl space-y-6 ${loaded ? '' : 'opacity-60 pointer-events-none'}`}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="space-y-4">
          <legend className="text-[13px] font-semibold text-stone-800 dark:text-stone-200 mb-1">Escritório</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nome do escritório">
              <input value={officeName} onChange={(e) => setOfficeName(e.target.value)} className={INPUT} placeholder="ex.: Brito Contabilidade" />
            </Field>
            <Field label="CNPJ do escritório" hint="Opcional" error={cnpjOk === false ? 'CNPJ inválido.' : null}>
              <div className="relative">
                <input
                  inputMode="numeric"
                  value={officeCnpj}
                  onChange={(e) => setOfficeCnpj(maskCNPJ(e.target.value))}
                  placeholder="00.000.000/0000-00"
                  className={`${INPUT} pr-10 font-mono tabular-nums`}
                />
                <Valid ok={cnpjDigits.length === 14 ? cnpjOk : null} />
              </div>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-[13px] font-semibold text-stone-800 dark:text-stone-200 mb-1">Profissional da contabilidade</legend>
          <Field label="Nome completo">
            <input value={accountantName} onChange={(e) => setAccountantName(e.target.value)} className={INPUT} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field
              label="Registro no CRC"
              hint="UF e número; categoria opcional (ex.: SP-123456/O-5)"
              error={crcOk === false ? 'Informe UF e número do CRC (ex.: SP-123456/O-5).' : null}
            >
              <div className="relative">
                <input
                  value={accountantCrc}
                  onChange={(e) => setAccountantCrc(e.target.value.toUpperCase())}
                  onBlur={() => crc && setAccountantCrc(crc)}
                  placeholder="SP-123456/O-5"
                  className={`${INPUT} pr-10 font-mono`}
                />
                <Valid ok={crcOk} />
              </div>
            </Field>
            <Field label="CPF" hint="Opcional" error={cpfOk === false ? 'CPF inválido.' : null}>
              <div className="relative">
                <input
                  inputMode="numeric"
                  value={accountantCpf}
                  onChange={(e) => setAccountantCpf(maskCPF(e.target.value))}
                  placeholder="000.000.000-00"
                  className={`${INPUT} pr-10 font-mono tabular-nums`}
                />
                <Valid ok={cpfDigits.length === 11 ? cpfOk : null} />
              </div>
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!valid || saving} className={`${BUTTON.accent} h-11 px-6`}>
            <Check className="w-4 h-4" />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`text-[13px] ${message.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
              {message.text}
            </p>
          )}
        </div>
        <p className="text-[12px] text-stone-400">
          O representante legal (nome e CPF) é cadastrado em cada empresa, na tela de Clientes.
        </p>
      </form>
    </main>
  );
}
