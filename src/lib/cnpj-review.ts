import type { CompanyPorte, TaxRegime } from '@/types/firestore';
import type { CNPJLookupResult } from '@/lib/cnpj';
import { sameCompany } from '@/lib/company-name';
import { textKey } from '@/lib/payee';

/**
 * O que fazer com a resposta da Receita no cadastro de cliente, antes de tocar no formulário:
 * preencher direto, perguntar se o CNPJ é de outra empresa ou confirmar a lista de mudanças.
 */

export interface ClientFormFields {
  name: string;
  tradeName: string;
  city: string;
  email: string;
  phone: string;
  legalRepresentativeName: string;
  regime: TaxRegime;
  porte: CompanyPorte;
}

export type ClientField = keyof ClientFormFields;

export const FIELD_LABEL: Record<ClientField, string> = {
  name: 'Razão social',
  tradeName: 'Nome fantasia',
  city: 'Município/UF',
  email: 'E-mail',
  phone: 'Telefone',
  legalRepresentativeName: 'Representante legal',
  regime: 'Regime',
  porte: 'Porte',
};

/** Campo que vai mudar: valor atual e o da Receita (regime e porte em código). */
export interface FieldChange {
  field: ClientField;
  from: string;
  to: string;
}

export type LookupReview =
  /** Sem conflito: preenche os campos (`fields`) direto. */
  | { kind: 'apply'; fields: Partial<ClientFormFields> }
  /** O nome digitado não é o da Receita: pergunta antes de preencher qualquer coisa. */
  | { kind: 'other-company'; typed: string; receitaName: string; receitaCity?: string; fields: Partial<ClientFormFields> }
  /** Atualização pedida pelo botão: confirma a lista do que vai mudar. */
  | { kind: 'changes'; changes: FieldChange[]; otherCompany: boolean; fields: Partial<ClientFormFields> }
  /** Atualização pedida pelo botão, e o cadastro já está igual ao da Receita. */
  | { kind: 'unchanged' };

const TEXT_FIELDS = ['name', 'tradeName', 'city', 'email', 'phone', 'legalRepresentativeName'] as const;

/** Valores que a Receita informou, por campo do formulário. */
function receitaFields(data: CNPJLookupResult): Partial<ClientFormFields> {
  const out: Partial<ClientFormFields> = {};
  for (const f of TEXT_FIELDS) {
    const v = data[f]?.trim();
    if (v) out[f] = v;
  }
  if (data.regime) out.regime = data.regime;
  if (data.porte) out.porte = data.porte;
  return out;
}

const sameValue = (a: string, b: string) => textKey(a) === textKey(b);

/**
 * `overwrite` falso: consulta automática ao digitar o CNPJ (só preenche o que está vazio).
 * `overwrite` verdadeiro: "Consultar/Atualizar pela Receita" (troca o que difere, com confirmação).
 */
export function reviewLookup(form: ClientFormFields, data: CNPJLookupResult, overwrite: boolean): LookupReview {
  const fromReceita = receitaFields(data);
  const typed = [form.name, form.tradeName].map((s) => s.trim()).filter(Boolean);
  const otherCompany = typed.length > 0 && !typed.some((n) => sameCompany(n, data.name) || sameCompany(n, data.tradeName));

  if (overwrite) {
    const changes: FieldChange[] = [];
    for (const [field, to] of Object.entries(fromReceita) as [ClientField, string][]) {
      const from = form[field].trim();
      if (!sameValue(from, to)) changes.push({ field, from, to });
    }
    if (changes.length === 0) return { kind: 'unchanged' };
    return { kind: 'changes', changes, otherCompany, fields: Object.fromEntries(changes.map((c) => [c.field, c.to])) };
  }

  if (otherCompany) {
    return { kind: 'other-company', typed: form.name.trim() || form.tradeName.trim(), receitaName: data.name, receitaCity: data.city, fields: fromReceita };
  }
  // Sem conflito: textos só onde está vazio; regime e porte vêm da Receita.
  const fields: Partial<ClientFormFields> = {};
  for (const f of TEXT_FIELDS) if (fromReceita[f] && !form[f].trim()) fields[f] = fromReceita[f];
  if (fromReceita.regime) fields.regime = fromReceita.regime;
  if (fromReceita.porte) fields.porte = fromReceita.porte;
  return { kind: 'apply', fields };
}
