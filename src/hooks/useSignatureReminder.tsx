'use client';

import React from 'react';
import type { OrgSettings } from '@/types/firestore';
import { Toast, useToast } from '@/components/ui/Toast';

type Accountant = Pick<OrgSettings, 'accountantName' | 'accountantCrc'> | null | undefined;

/** Nome e CRC do contador cadastrados: a assinatura do profissional sai nos documentos. */
export const hasAccountantSignature = (org: Accountant): boolean => Boolean(org?.accountantName?.trim() && org?.accountantCrc?.trim());

export const MISSING_SIGNATURE_MESSAGE = 'Exportado sem a assinatura do contador: cadastre o nome e o CRC em Escritório.';

/**
 * Aviso na hora de exportar, no lugar do aviso fixo nas telas: sem nome e CRC do contador, o
 * documento sai com a assinatura do profissional em branco. O Painel também lembra do cadastro.
 */
export function useSignatureReminder(org: Accountant) {
  const [toast, setToast] = useToast(6000);
  const remind = () => {
    if (!hasAccountantSignature(org)) setToast(MISSING_SIGNATURE_MESSAGE);
  };
  return { remind, toast: <Toast toast={toast} onDismiss={() => setToast(null)} /> };
}
