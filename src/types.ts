export interface DomainRow {
  index: number; // Row index starting from 0 (index 0 is usually header, index 1 target row etc)
  domain: string;
  originalValues: string[];
  category?: "e-commerce" | "technology" | "blogs" | "other";
  isNewsPublisher?: "Yes" | "No";
  reasoning?: string;
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
}

export interface ClassificationResult {
  domain: string;
  category: "e-commerce" | "technology" | "blogs" | "other";
  isNewsPublisher: "Yes" | "No";
  reasoning: string;
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
  isFetchingSheet: boolean;
  isClassifying: boolean;
  activeTab: "database" | "analytics" | "instructions" | "history";
  appMode: AppMode;
  filterCategory: string;
  filterNews: string;
  searchTerm: string;
  googleClientId: string;
  googleAccessToken: string | null;
  googleUserEmail: string | null;
}
