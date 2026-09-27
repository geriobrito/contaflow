export interface OFXRawTransaction {
  fitid: string;
  type: 'DEBIT' | 'CREDIT' | 'OTHER';
  date: string; // ISO format: YYYY-MM-DD
  rawDate: string; // Original OFX date string (e.g., 20231015120000[-3:BRT])
  amount: number;
  memo: string;
  checkNum?: string;
  refNum?: string;
}

export interface OFXAccountInfo {
  bankId?: string;
  branchId?: string;
  accountId?: string;
  accountType?: string;
  org?: string;
  fid?: string;
}

export interface OFXParseResult {
  account: OFXAccountInfo;
  startDate?: string;
  endDate?: string;
  ledgerBalance?: {
    amount: number;
    date?: string;
  };
  transactions: OFXRawTransaction[];
  rawHeader: Record<string, string>;
  encoding: string;
  hasErrors: boolean;
  warnings: string[];
}
