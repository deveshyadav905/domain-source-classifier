export interface DomainRow {
  index: number; // Row index starting from 0 (index 0 is usually header, index 1 target row etc)
  domain: string;
  d_url?: string;
  originalValues: string[];
  category?: "e-commerce" | "technology" | "blogs" | "other";
  isNewsPublisher?: string;
  reasoning?: string;
  siteName?: string;
  displayName?: string;
  description?: string;
  trancoRank?: number | null;
  trancoDate?: string;
  trancoStatus?: "pending" | "processing" | "success" | "error";
  status: "pending" | "processing" | "success" | "error";
  errorMsg?: string;
  // News source validation fields
  country?: string;
  language?: string;
  rssUrl?: string;
  sitemapUrl?: string;
  newsCategory?: string;
  newsStatus?: "pending" | "processing" | "success" | "error";
  newsErrorMsg?: string;
  newsPublisherStatus?: "pending" | "processing" | "success" | "error";
  sourcetype?: string;
}

export interface ClassificationResult {
  domain: string;
  category: "e-commerce" | "technology" | "blogs" | "other";
  isNewsPublisher: string;
  reasoning: string;
  siteName?: string;
  displayName?: string;
  description?: string;
}

export interface SpreadsheetConfig {
  url: string;
  spreadsheetId: string;
  gid: string;
  sheetName: string;
}

export type AppMode = "domains" | "sources";

export interface AppState {
  config: SpreadsheetConfig;
  headers: string[];
  domainColumnIndex: number;
  rows: DomainRow[];
  domainsConfig?: SpreadsheetConfig;
  domainsHeaders?: string[];
  domainsDomainColumnIndex?: number;
  domainsRows?: DomainRow[];
  sourcesConfig?: SpreadsheetConfig;
  sourcesHeaders?: string[];
  sourcesDomainColumnIndex?: number;
  sourcesRows?: DomainRow[];
  isFetchingSheet: boolean;
  isClassifying: boolean;
  isCheckingNewsPublisher: boolean;
  activeTab: "database" | "analytics" | "instructions" | "history";
  appMode: AppMode;
  filterCategory: string;
  filterNews: string;
  searchTerm: string;
  googleClientId: string;
  googleAccessToken: string | null;
  googleUserEmail: string | null;
}
