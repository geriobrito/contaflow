/** Notas fiscais (NF-e, NFC-e e NFS-e): só o resumo do XML, lido no navegador. */

/** Lado da nota para a empresa: compra (ela é a destinatária) ou venda (ela é a emitente). */
export type InvoiceDirection = 'PURCHASE' | 'SALE';

export type InvoiceStatus = 'AUTHORIZED' | 'CANCELLED';

/** Parcela da cobrança (`<dup>`): vencimento e valor. */
export interface InvoiceInstallment {
  number?: string;
  dueDate: string;
  amount: number;
}

/** Valor dos produtos por NCM (8 dígitos). */
export interface InvoiceNcm {
  ncm: string;
  amount: number;
}

/** Valor dos produtos por CFOP. */
export interface InvoiceCfop {
  cfop: string;
  amount: number;
}

/**
 * IBS/CBS por classificação tributária (cClassTrib) dos itens da nota: soma dos itens de mesma
 * classificação e CST. Decide o crédito do adquirente pela tabela oficial.
 */
export interface InvoiceTaxItem {
  /** Classificação tributária do IBS/CBS (6 dígitos). */
  cClassTrib: string;
  /** CST do IBS/CBS (3 dígitos), como veio na nota. */
  cst?: string;
  /** Base de cálculo do IBS/CBS (vBC do grupo gIBSCBS), quando a nota traz. */
  base?: number;
  ibs: number;
  cbs: number;
}

/**
 * IBS e CBS calculados no Simples Nacional (NT 2026.005): receita bruta dos itens (vRBSNitem) e o
 * IBS e a CBS devidos no DAS sobre ela (vIBSSN, vCBSSN). Vem nas notas de venda de empresa do
 * Simples; é o crédito que o comprador do regime regular aproveita.
 */
export interface InvoiceSimplesTax {
  base: number;
  ibs: number;
  cbs: number;
}

/** Pagamento ou recebimento do extrato confirmado como quitação (de parte) da nota. */
export interface InvoiceLink {
  transactionId: string;
  amount: number;
  /** Conta usada na classificação: vira a sugestão para as próximas notas do mesmo parceiro. */
  accountId: string;
  linkedAt: string;
}

/**
 * Retenções da NFS-e, em reais; só as diferentes de zero. PIS, COFINS e CSLL juntos são a CSRF
 * (Lei 10.833/2003, art. 30). `other`: parte da diferença entre serviço e líquido que a nota não
 * discrimina.
 */
export interface InvoiceRetentions {
  irrf?: number;
  pis?: number;
  cofins?: number;
  csll?: number;
  /** INSS retido (contribuição previdenciária, 11% na cessão de mão de obra). */
  inss?: number;
  /** ISS retido pelo tomador ou pelo intermediário. */
  iss?: number;
  other?: number;
}

/**
 * Resumo de uma NF-e (modelo 55), NFC-e (65) ou NFS-e do padrão nacional (`model` 'NFSE')
 * importada pelo XML. O arquivo não é guardado: o navegador lê o XML e grava só estes campos
 * (id `${clientId}_${key}`).
 */
export interface InvoiceSummary {
  orgId?: string;
  id: string;
  clientId: string;
  /** Chave de acesso: 44 caracteres (NF-e/NFC-e) ou 50 dígitos (NFS-e). */
  key: string;
  number: string;
  series: string;
  /** '55' NF-e, '65' NFC-e, 'NFSE' NFS-e do padrão nacional. */
  model: string;
  /** Data de emissão (YYYY-MM-DD). */
  issueDate: string;
  direction: InvoiceDirection;
  /** CNPJ/CPF do fornecedor (compra) ou do cliente (venda), sem pontuação; vazio se a nota não traz. */
  counterpartyDoc: string;
  counterpartyName: string;
  /** Valor a pagar: o total da NF-e (vNF) ou o líquido da NFS-e (vLiq, já sem as retenções). */
  total: number;
  /**
   * Outro valor que o pagamento pode ter, quando difere do total: o valor do serviço sem as
   * retenções (NFS-e, vServ) ou o total com IBS/CBS (NF-e, vNFTot).
   */
  altTotal?: number;
  /** IBS e CBS destacados na nota (reforma tributária, LC 214/2025); ausentes quando zero. */
  ibs?: number;
  cbs?: number;
  /** IBS/CBS por classificação tributária (ausente nas notas sem o grupo IBSCBS nos itens). */
  ibsCbsItems?: InvoiceTaxItem[];
  /** IBS/CBS do Simples Nacional destacados na nota (empresa do Simples que emite). */
  simplesTax?: InvoiceSimplesTax;
  /** NFS-e: código de tributação nacional do serviço (cTribNac, 6 dígitos). */
  serviceCode?: string;
  /** NFS-e: tributos retidos pelo tomador (a diferença entre o serviço e o líquido). */
  retentions?: InvoiceRetentions;
  cfops: InvoiceCfop[];
  /** NF-e: valor dos produtos por NCM, do maior para o menor (até 40). */
  ncms?: InvoiceNcm[];
  /** NFS-e: código NBS do serviço (cNBS, 9 dígitos). */
  nbs?: string;
  installments: InvoiceInstallment[];
  status: InvoiceStatus;
  links?: InvoiceLink[];
  importedAt: string;
}
