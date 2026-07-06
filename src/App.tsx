import { useEffect, useState, useRef } from "react";
import Header from "./components/Header";
import DomainTable from "./components/DomainTable";
import VisualCharts from "./components/VisualCharts";
import SetupInstructions from "./components/SetupInstructions";
import AuthScreen from "./components/AuthScreen";
import HistoryScreen from "./components/HistoryScreen";
import { AppState, DomainRow, SpreadsheetConfig } from "./types";
import { Sparkles, Download, Check, AlertTriangle, Key, Loader2, ArrowUpRight, CheckCircle2, ShieldAlert, FileSpreadsheet, X, Info } from "lucide-react";

// Firebase integration and global cloud caching helper libraries
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { 
  getCachedDomains, 
  setCachedDomains, 
  getCachedSources, 
  setCachedSources, 
  saveRunHistory,
  wipeGlobalDatabaseCache
} from "./lib/cache";

// Default sheet URL to match user request
const DEFAULT_SHEET_URL = "";

// Helper to convert 1-based column offset to A-Z/AA-ZZ labels
function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp > 0) {
    let modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => {
      if (word.toLowerCase() === "and") return "and";
      if (word.toLowerCase() === "or") return "or";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function toDomainTitleCase(domain: string): string {
  if (!domain) return "";
  let cleanHost = domain.toLowerCase().trim();
  if (cleanHost.includes("://")) {
    cleanHost = cleanHost.split("://")[1];
  }
  cleanHost = cleanHost.split("/")[0].split("?")[0];
  if (cleanHost.startsWith("www.")) {
    cleanHost = cleanHost.slice(4);
  }

  const parts = cleanHost.split(".");
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2).join(".");
    const doubleSuffixes = new Set([
      "co.uk", "org.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk",
      "co.jp", "or.jp", "ne.jp", "ac.jp",
      "com.au", "net.au", "org.au", "edu.au", "gov.au",
      "com.br", "net.br", "org.br",
      "com.cn", "net.cn", "org.cn", "gov.cn",
      "com.mx", "net.mx", "org.mx",
      "com.tw", "net.tw", "org.tw",
      "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
      "com.sg", "net.sg", "org.sg",
      "com.tr", "net.tr", "org.tr",
      "co.za", "net.za", "org.za",
      "com.hk", "net.hk", "org.hk",
      "co.nz", "net.nz", "org.nz",
      "com.ru", "net.ru", "org.ru",
      "com.ua", "net.ua", "org.ua",
      "co.id", "web.id", "or.id", "ac.id"
    ]);

    if (doubleSuffixes.has(lastTwo) && parts.length >= 3) {
      parts.splice(-2);
    } else {
      parts.splice(-1);
    }
  }

  const rawName = parts.join(".");
  return rawName.replace(/([a-zA-Z0-9]+)/g, (match) => {
    return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
  });
}

// Simple but robust CSV line parser
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentVal = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      row.push(currentVal.trim());
      lines.push(row);
      row = [];
      currentVal = "";
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
    } else {
      currentVal += char;
    }
  }
  if (currentVal || row.length > 0) {
    row.push(currentVal.trim());
    lines.push(row);
  }
  return lines.filter((r) => r.length > 0 && r.some((cell) => cell !== ""));
}

// Helper to normalize content categories (e.g. converting "Technology & Innovation" to comma separated list "Technology, Innovation")
export function normalizeCategory(cat?: string): string | undefined {
  if (!cat) return undefined;
  let normalized = cat.trim();
  // Standardize known combinations
  if (normalized.toLowerCase().includes("technology & innovation") || normalized.toLowerCase() === "technology & innovation") {
    return "Technology, Innovation";
  }
  if (normalized.includes(" & ")) {
    normalized = normalized.replace(/\s*&\s*/g, ", ");
  } else if (normalized.toLowerCase().includes(" and ")) {
    normalized = normalized.replace(/\s+and\s+/gi, ", ");
  }
  return normalized;
}

export default function App() {
  const [state, setState] = useState<AppState>({
    config: {
      url: DEFAULT_SHEET_URL,
      spreadsheetId: "",
      gid: "",
      sheetName: "",
    },
    headers: [],
    domainColumnIndex: 0,
    rows: [],
    domainsConfig: {
      url: DEFAULT_SHEET_URL,
      spreadsheetId: "",
      gid: "",
      sheetName: "",
    },
    domainsHeaders: [],
    domainsDomainColumnIndex: 0,
    domainsRows: [],
    sourcesConfig: {
      url: DEFAULT_SHEET_URL,
      spreadsheetId: "",
      gid: "",
      sheetName: "",
    },
    sourcesHeaders: [],
    sourcesDomainColumnIndex: 0,
    sourcesRows: [],
    isFetchingSheet: false,
    isClassifying: false,
    isCheckingNewsPublisher: false,
    activeTab: "database",
    appMode: "domains",
    filterCategory: "",
    filterNews: "",
    searchTerm: "",
    googleClientId: "",
    googleAccessToken: null,
    googleUserEmail: null,
  });

  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [customGeminiApiKey, setCustomGeminiApiKeyState] = useState(() => {
    return localStorage.getItem("custom_gemini_api_key") || "";
  });

  const setCustomGeminiApiKey = (key: string) => {
    setCustomGeminiApiKeyState(key);
    localStorage.setItem("custom_gemini_api_key", key);
  };

  const [showTokenInputModal, setShowTokenInputModal] = useState(false);
  const [isUpdatingSheet, setIsUpdatingSheet] = useState(false);
  const [sheetUpdateResult, setSheetUpdateResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [sheetDebugLogs, setSheetDebugLogs] = useState<string[]>([]);
  const [sheetFetchError, setSheetFetchError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: "success" | "info" | "error" }>>([]);
  const [activeErrorModal, setActiveErrorModal] = useState<{
    title: string;
    message: string;
    diagnostics?: string;
    type: "auth" | "firestore" | "unknown";
  } | null>(null);

  const addToast = (message: string, type: "success" | "info" | "error" = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  useEffect(() => {
    const handleSystemToast = (e: any) => {
      if (e.detail?.message) {
        addToast(e.detail.message, e.detail.type || "info");
      }
    };
    const handleSystemErrorModal = (e: any) => {
      if (e.detail) {
        setActiveErrorModal({
          title: e.detail.title || "System Error",
          message: e.detail.message || "An unexpected issue has been logged.",
          diagnostics: e.detail.diagnostics,
          type: e.detail.type || "unknown"
        });
      }
    };
    window.addEventListener("system-toast", handleSystemToast as any);
    window.addEventListener("system-error-modal", handleSystemErrorModal as any);
    return () => {
      window.removeEventListener("system-toast", handleSystemToast as any);
      window.removeEventListener("system-error-modal", handleSystemErrorModal as any);
    };
  }, []);

  const [isAnalyzingNews, setIsAnalyzingNews] = useState(false);
  const [isFetchingTranco, setIsFetchingTranco] = useState(false);
  const [apiLimitError, setApiLimitError] = useState<string | null>(null);

  const domainAbortControllerRef = useRef<AbortController | null>(null);
  const newsAbortControllerRef = useRef<AbortController | null>(null);
  const trancoAbortControllerRef = useRef<AbortController | null>(null);

  // Firebase auth state tracking
  const [firebaseUser, setFirebaseUser] = useState<any | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  const handleSignOutFirebase = async () => {
    try {
      await signOut(auth);
      setFirebaseUser(null);
    } catch (err) {
      console.error("Firebase Signout Error:", err);
    }
  };

  // Load Google Identity Services dynamically on mount
  useEffect(() => {
    if (!document.getElementById("google-gis-script")) {
      const script = document.createElement("script");
      script.id = "google-gis-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, []);

  // Restore and synchronize user session securely across restarts/refresh whenever firebaseUser changes
  useEffect(() => {
    if (!authInitialized) return;

    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    let hasRestored = false;
    try {
      const saved = localStorage.getItem(`publisher_autosave_session${userKeySuffix}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.rows && parsed.rows.length > 0) {
          const cleanRowsList = (rows: any[]) => {
            if (!rows) return [];
            return rows.map((row: any) => ({
              ...row,
              status: row.status === "processing" ? "pending" : row.status,
              newsStatus: row.newsStatus === "processing" ? "pending" : row.newsStatus,
            }));
          };

          const cleanedRows = cleanRowsList(parsed.rows);
          const cleanedDomainsRows = cleanRowsList(parsed.domainsRows || []);
          const cleanedSourcesRows = cleanRowsList(parsed.sourcesRows || []);

          setState((prev) => ({
            ...prev,
            config: parsed.config || {
              url: DEFAULT_SHEET_URL,
              spreadsheetId: "",
              gid: "",
              sheetName: "",
            },
            headers: parsed.headers || [],
            domainColumnIndex: parsed.domainColumnIndex !== undefined ? parsed.domainColumnIndex : 0,
            rows: cleanedRows,
            domainsConfig: parsed.domainsConfig || (parsed.appMode !== "sources" ? parsed.config : undefined) || {
              url: DEFAULT_SHEET_URL,
              spreadsheetId: "",
              gid: "",
              sheetName: "",
            },
            domainsHeaders: parsed.domainsHeaders || (parsed.appMode !== "sources" ? parsed.headers : undefined) || [],
            domainsDomainColumnIndex: parsed.domainsDomainColumnIndex !== undefined 
              ? parsed.domainsDomainColumnIndex 
              : (parsed.appMode !== "sources" ? parsed.domainColumnIndex : 0),
            domainsRows: cleanedDomainsRows.length > 0 
              ? cleanedDomainsRows 
              : (parsed.appMode !== "sources" ? cleanedRows : []),
            sourcesConfig: parsed.sourcesConfig || (parsed.appMode === "sources" ? parsed.config : undefined) || {
              url: DEFAULT_SHEET_URL,
              spreadsheetId: "",
              gid: "",
              sheetName: "",
            },
            sourcesHeaders: parsed.sourcesHeaders || (parsed.appMode === "sources" ? parsed.headers : undefined) || [],
            sourcesDomainColumnIndex: parsed.sourcesDomainColumnIndex !== undefined 
              ? parsed.sourcesDomainColumnIndex 
              : (parsed.appMode === "sources" ? parsed.domainColumnIndex : 0),
            sourcesRows: cleanedSourcesRows.length > 0 
              ? cleanedSourcesRows 
              : (parsed.appMode === "sources" ? cleanedRows : []),
            appMode: parsed.appMode || "domains",
            activeTab: parsed.activeTab || "database",
            googleClientId: localStorage.getItem(`google_client_id${userKeySuffix}`) || "",
            googleAccessToken: localStorage.getItem(`google_access_token${userKeySuffix}`) || null,
            googleUserEmail: localStorage.getItem(`google_user_email${userKeySuffix}`) || null,
          }));
          hasRestored = true;
          console.log(`Active session for ${userKeySuffix} automatically restored from cache cleanly.`);
        }
      }
    } catch (e) {
      console.warn("Failed to restore saved session state:", e);
    }

    if (!hasRestored) {
      // Revert to default clean sheet config when switching to a user with no previous saved progress
      setState((prev) => ({
        ...prev,
        config: {
          url: DEFAULT_SHEET_URL,
          spreadsheetId: "",
          gid: "",
          sheetName: "",
        },
        headers: [],
        domainColumnIndex: 0,
        rows: [],
        domainsConfig: {
          url: DEFAULT_SHEET_URL,
          spreadsheetId: "",
          gid: "",
          sheetName: "",
        },
        domainsHeaders: [],
        domainsDomainColumnIndex: 0,
        domainsRows: [],
        sourcesConfig: {
          url: DEFAULT_SHEET_URL,
          spreadsheetId: "",
          gid: "",
          sheetName: "",
        },
        sourcesHeaders: [],
        sourcesDomainColumnIndex: 0,
        sourcesRows: [],
        appMode: "domains",
        activeTab: "database",
        googleClientId: localStorage.getItem(`google_client_id${userKeySuffix}`) || "",
        googleAccessToken: localStorage.getItem(`google_access_token${userKeySuffix}`) || null,
        googleUserEmail: localStorage.getItem(`google_user_email${userKeySuffix}`) || null,
      }));
      // Auto-fetch has been disabled to keep a clean environment unless intentionally triggered
    }
  }, [firebaseUser, authInitialized]);

  // Auto-save session state to localStorage on any core changes (save at any point)
  useEffect(() => {
    if (!authInitialized) return;
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";

    if (state.rows && state.rows.length > 0) {
      const saveData = {
        config: state.config,
        headers: state.headers,
        domainColumnIndex: state.domainColumnIndex,
        rows: state.rows,
        domainsConfig: state.domainsConfig,
        domainsHeaders: state.domainsHeaders,
        domainsDomainColumnIndex: state.domainsDomainColumnIndex,
        domainsRows: state.domainsRows,
        sourcesConfig: state.sourcesConfig,
        sourcesHeaders: state.sourcesHeaders,
        sourcesDomainColumnIndex: state.sourcesDomainColumnIndex,
        sourcesRows: state.sourcesRows,
        appMode: state.appMode,
        activeTab: state.activeTab,
      };
      localStorage.setItem(`publisher_autosave_session${userKeySuffix}`, JSON.stringify(saveData));
    }
  }, [
    state.rows, state.headers, state.domainColumnIndex, state.config, state.appMode, state.activeTab, 
    state.domainsRows, state.domainsHeaders, state.domainsDomainColumnIndex, state.domainsConfig,
    state.sourcesRows, state.sourcesHeaders, state.sourcesDomainColumnIndex, state.sourcesConfig,
    firebaseUser, authInitialized
  ]);

  // Keep separate mode-specific states in sync with the active state
  useEffect(() => {
    if (!authInitialized) return;
    setState((prev) => {
      if (prev.appMode === "domains") {
        if (
          prev.domainsConfig?.url === prev.config.url &&
          prev.domainsConfig?.spreadsheetId === prev.config.spreadsheetId &&
          prev.domainsConfig?.gid === prev.config.gid &&
          prev.domainsConfig?.sheetName === prev.config.sheetName &&
          prev.domainsHeaders === prev.headers &&
          prev.domainsDomainColumnIndex === prev.domainColumnIndex &&
          prev.domainsRows === prev.rows
        ) {
          return prev;
        }
        return {
          ...prev,
          domainsConfig: prev.config,
          domainsHeaders: prev.headers,
          domainsDomainColumnIndex: prev.domainColumnIndex,
          domainsRows: prev.rows,
        };
      } else {
        if (
          prev.sourcesConfig?.url === prev.config.url &&
          prev.sourcesConfig?.spreadsheetId === prev.config.spreadsheetId &&
          prev.sourcesConfig?.gid === prev.config.gid &&
          prev.sourcesConfig?.sheetName === prev.config.sheetName &&
          prev.sourcesHeaders === prev.headers &&
          prev.sourcesDomainColumnIndex === prev.domainColumnIndex &&
          prev.sourcesRows === prev.rows
        ) {
          return prev;
        }
        return {
          ...prev,
          sourcesConfig: prev.config,
          sourcesHeaders: prev.headers,
          sourcesDomainColumnIndex: prev.domainColumnIndex,
          sourcesRows: prev.rows,
        };
      }
    });
  }, [state.config, state.headers, state.domainColumnIndex, state.rows, state.appMode, authInitialized]);

  // Parse Google Sheets Link for spreadsheetId & gid
  const parseSpreadsheetUrl = (url: string): { spreadsheetId: string; gid: string } => {
    let spreadsheetId = "";
    let gid = "0";

    const dMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (dMatch) spreadsheetId = dMatch[1];

    const gidMatch = url.match(/gid=([0-9]+)/);
    if (gidMatch) gid = gidMatch[1];

    return { spreadsheetId, gid };
  };

  // Set new URL input and automatically parse the targets
  const handleSetSheetUrl = (url: string) => {
    const { spreadsheetId, gid } = parseSpreadsheetUrl(url);
    setState((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        url,
        spreadsheetId: spreadsheetId || prev.config.spreadsheetId,
        gid: gid || "0",
      },
    }));
  };

  // Load the domains list from Google Sheets (via the backend proxy server CSV downloader)
  const fetchSpreadsheet = async (id: string, gidValue: string, tokenOverride?: string | null) => {
    if (!id) return;
    setState((prev) => ({ ...prev, isFetchingSheet: true }));
    setSheetUpdateResult(null);
    setSheetFetchError(null);

    try {
      const activeToken = tokenOverride !== undefined ? tokenOverride : state.googleAccessToken;
      const fetchHeaders: Record<string, string> = {};
      if (activeToken) {
        fetchHeaders["Authorization"] = `Bearer ${activeToken}`;
      }

      const res = await fetch(`/api/fetch-sheet?spreadsheetId=${id}&gid=${gidValue}`, { headers: fetchHeaders });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 401) {
          handleDisconnectGoogle();
          throw new Error("Your Google Sheets connection has expired. Please re-connect by clicking 'Connect Google Sheets' to refresh access.");
        }
        throw new Error(data.error || "Failed to load sheet data. Ensure the document is shared publicly or you are logged in.");
      }

      const grid = parseCSV(data.csv);
      if (grid.length === 0) {
        throw new Error("Spreadsheet is empty or could not be parsed.");
      }

      const headers = grid[0];
      const bodyRows = grid.slice(1);

      // Detect which column contains domains/URLs
      const keywords = ["domain", "url", "website", "link", "host", "site", "web"];
      let detectedCol = 0;
      for (let c = 0; c < headers.length; c++) {
        const hName = headers[c].toLowerCase();
        if (keywords.some((kw) => hName.includes(kw))) {
          detectedCol = c;
          break;
        }
      }

      // Fallback content-based analysis
      if (detectedCol === -1) {
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}/;
        const colScores = headers.map(() => 0);
        const scanCount = Math.min(bodyRows.length, 10);

        for (let r = 0; r < scanCount; r++) {
          for (let c = 0; c < bodyRows[r].length; c++) {
            if (domainRegex.test(String(bodyRows[r][c]).trim())) {
              colScores[c]++;
            }
          }
        }
        let bestCol = 0;
        let maxScore = 0;
        for (let c = 0; c < colScores.length; c++) {
          if (colScores[c] > maxScore) {
            maxScore = colScores[c];
            bestCol = c;
          }
        }
        detectedCol = bestCol;
      }

      // Check if Category, News Publisher, Reasoning, Site Name, Display Name, Description already exist in the sheet
      let siteNameColIdx = headers.findIndex((h) => h.toLowerCase() === "site name" || h.toLowerCase() === "sitename");
      let displayNameColIdx = headers.findIndex((h) => h.toLowerCase() === "display name" || h.toLowerCase() === "displayname");
      let catColIdx = headers.findIndex((h) => h.toLowerCase() === "category" || h.toLowerCase() === "domain category" || h.toLowerCase() === "sub-category");
      let newsColIdx = headers.findIndex((h) => h.toLowerCase() === "news publisher");
      let descColIdx = headers.findIndex((h) => h.toLowerCase() === "domain description" || h.toLowerCase() === "description");
      let trancoColIdx = headers.findIndex((h) => h.toLowerCase() === "tranco traffic rank" || h.toLowerCase() === "tranco rank" || h.toLowerCase() === "priority");
      let reasonColIdx = headers.findIndex((h) => h.toLowerCase() === "reasoning" || h.toLowerCase() === "ai reasoning" || h.toLowerCase() === "ai description / reasoning" || h.toLowerCase() === "ai domain description");
      
      // Separate lookup for News Category column in sources mode
      let newsCatColIdx = headers.findIndex((h) => h.toLowerCase() === "news category" || h.toLowerCase() === "news_category" || h.toLowerCase() === "source category");
      let countryColIdx = headers.findIndex((h) => h.toLowerCase() === "target country" || h.toLowerCase() === "country" || h.toLowerCase() === "geo");
      let langColIdx = headers.findIndex((h) => h.toLowerCase() === "language" || h.toLowerCase() === "lang");
      let sourcetypeColIdx = headers.findIndex((h) => h.toLowerCase() === "sourcetype" || h.toLowerCase() === "source type");

      const isSourcesMode = state.appMode === "sources";

      // Construct rows state
      const rows: DomainRow[] = bodyRows.map((rawRow, i) => {
        const rawDomain = String(rawRow[detectedCol] || "").trim();
        // Clean prefixes (e.g. http://, https://, www.) so we send clean domains to Gemini
        let cleanDomain = rawDomain;
        if (!isSourcesMode) {
          cleanDomain = rawDomain
            .toLowerCase()
            .replace(/^(https?:\/\/)?(www\.)?/, "")
            .split("/")[0]
            .split("?")[0];
        } else {
          cleanDomain = rawDomain;
        }

        // Read pre-existing values if any
        const existingSiteName = siteNameColIdx !== -1 ? rawRow[siteNameColIdx] : undefined;
        const existingDisplayName = displayNameColIdx !== -1 ? rawRow[displayNameColIdx] : undefined;
        const existingCat = catColIdx !== -1 ? (rawRow[catColIdx] as any) : undefined;
        const existingNews = newsColIdx !== -1 ? (rawRow[newsColIdx] as any) : undefined;
        const existingDesc = descColIdx !== -1 ? rawRow[descColIdx] : undefined;
        const existingTranco = trancoColIdx !== -1 ? rawRow[trancoColIdx] : undefined;
        const existingReason = reasonColIdx !== -1 ? rawRow[reasonColIdx] : undefined;
        const existingCountry = countryColIdx !== -1 ? rawRow[countryColIdx] : undefined;
        const existingLang = langColIdx !== -1 ? rawRow[langColIdx] : undefined;
        const existingSourceType = sourcetypeColIdx !== -1 ? rawRow[sourcetypeColIdx] : undefined;
        const existingNewsCat = newsCatColIdx !== -1 ? rawRow[newsCatColIdx] : undefined;

        const isSuccess = existingCat && existingNews;
        const hasNewsSuccess = isSourcesMode
          ? (existingCountry !== undefined && existingCountry !== null && existingCountry !== "" &&
             existingLang !== undefined && existingLang !== null && existingLang !== "" &&
             existingNewsCat !== undefined && existingNewsCat !== null && existingNewsCat !== "" &&
             existingSourceType !== undefined && existingSourceType !== null && existingSourceType !== "")
          : (existingCountry && existingLang);

        let parsedTrancoRank: number | null | undefined = undefined;
        let trancoStatus: "pending" | "processing" | "success" | "error" = "pending";
        let trancoDate: string | undefined = undefined;
        if (existingTranco !== undefined && existingTranco !== null && existingTranco !== "" && existingTranco !== "-") {
          const num = parseInt(String(existingTranco).replace(/[^\d]/g, ""), 10);
          if (!isNaN(num)) {
            parsedTrancoRank = num;
            trancoStatus = "success";
            trancoDate = "Loaded from Sheet";
          }
        }

        return {
          index: i,
          domain: cleanDomain || rawDomain,
          d_url: rawDomain,
          originalValues: rawRow,
          category: isSuccess ? existingCat : undefined,
          isNewsPublisher: isSuccess ? existingNews : undefined,
          reasoning: isSuccess ? existingReason : undefined,
          siteName: existingSiteName,
          displayName: existingDisplayName,
          description: existingDesc || (isSuccess ? existingReason : undefined),
          trancoRank: parsedTrancoRank,
          trancoStatus,
          trancoDate,
          country: existingCountry,
          language: existingLang,
          newsCategory: isSourcesMode 
            ? (existingNewsCat ? normalizeCategory(existingNewsCat) : undefined)
            : (isSuccess ? normalizeCategory(existingCat) : undefined),
          status: isSuccess ? "success" as const : "pending" as const,
          newsStatus: hasNewsSuccess ? "success" as const : "pending" as const,
          sourcetype: existingSourceType,
        };
      });

      setState((prev) => ({
        ...prev,
        headers,
        domainColumnIndex: detectedCol,
        rows,
        isFetchingSheet: false,
      }));

      // Asynchronously pre-populate fields from the database cache
      if (rows.length > 0) {
        const uniqueDomains = Array.from(new Set(rows.map(r => r.domain.toLowerCase().trim()))).filter(Boolean);
        getCachedDomains(uniqueDomains).then((cachedMap) => {
          setState((prev) => {
            const updatedRows = prev.rows.map((row) => {
              const clean = row.domain.toLowerCase().trim();
              const cached = cachedMap[clean];
              if (cached) {
                const isSuccess = cached.category && cached.isNewsPublisher;
                const hasNewsSuccess = cached.country && cached.language;
                return {
                  ...row,
                  category: cached.category !== undefined ? cached.category : row.category,
                  isNewsPublisher: cached.isNewsPublisher !== undefined ? cached.isNewsPublisher : row.isNewsPublisher,
                  reasoning: cached.reasoning !== undefined ? cached.reasoning : row.reasoning,
                  siteName: cached.siteName !== undefined ? cached.siteName : row.siteName,
                  displayName: cached.displayName !== undefined ? cached.displayName : row.displayName,
                  description: cached.description !== undefined ? cached.description : row.description,
                  trancoRank: cached.trancoRank !== undefined ? cached.trancoRank : row.trancoRank,
                  trancoDate: cached.trancoDate !== undefined ? cached.trancoDate : row.trancoDate,
                  trancoStatus: cached.trancoRank !== undefined ? ("success" as const) : row.trancoStatus,
                  country: cached.country !== undefined ? cached.country : row.country,
                  language: cached.language !== undefined ? cached.language : row.language,
                  rssUrl: cached.rssUrl !== undefined ? cached.rssUrl : row.rssUrl,
                  sitemapUrl: cached.sitemapUrl !== undefined ? cached.sitemapUrl : row.sitemapUrl,
                  newsCategory: cached.newsCategory !== undefined ? cached.newsCategory : row.newsCategory,
                  sourcetype: cached.sourcetype !== undefined ? cached.sourcetype : row.sourcetype,
                  status: isSuccess ? ("success" as const) : row.status,
                  newsStatus: hasNewsSuccess ? ("success" as const) : row.newsStatus,
                };
              }
              return row;
            });
            return {
              ...prev,
              rows: updatedRows,
              domainsRows: prev.appMode === "domains" ? updatedRows : prev.domainsRows,
              sourcesRows: prev.appMode === "sources" ? updatedRows : prev.sourcesRows,
            };
          });
        }).catch((err) => {
          console.warn("Failed to pre-fetch domain caches:", err);
        });
      }
    } catch (err: any) {
      console.error(err);
      setSheetFetchError(err.message || "Failed to fetch spreadsheet. Confirm that the resource is public/viewable.");
      setState((prev) => ({ ...prev, isFetchingSheet: false }));
    }
  };

  const handleFetchTrancoRanks = async (indicesToRun: number[]) => {
    if (indicesToRun.length === 0) {
      addToast("No domain records selected for priority rank retrieval.", "info");
      return;
    }

    if (trancoAbortControllerRef.current) {
      trancoAbortControllerRef.current.abort();
    }
    trancoAbortControllerRef.current = new AbortController();
    const signal = trancoAbortControllerRef.current.signal;

    setIsFetchingTranco(true);
    addToast(`Retrieving global priority rankings for ${indicesToRun.length} domains...`, "info");

    setState((prev) => {
      const updatedRows = prev.rows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, trancoStatus: "processing" as const } : r
      );
      return { ...prev, rows: updatedRows };
    });

    try {
      const BATCH_SIZE = 15;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        // Map indices to domain string values
        const chunkDomains = chunkIndices.map((idx) => {
          const match = state.rows.find((r) => r.index === idx);
          return match ? match.domain : "";
        }).filter(Boolean);

        if (chunkDomains.length === 0) continue;

        const res = await fetch("/api/tranco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domains: chunkDomains }),
          signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}: Priority ranking fetch failed.`);
        }

        const { results } = await res.json();
        
        // Cache Tranco rankings to DB and local cache
        await setCachedDomains(results.map((r: any) => ({
          domain: r.domain,
          trancoRank: r.rank,
          trancoDate: r.date,
        })));
        
        setState((prev) => {
          const updatedRows = prev.rows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = results.find(
              (r: any) => String(r.domain).toLowerCase().trim() === String(row.domain).toLowerCase().trim()
            );

            if (match) {
              return {
                ...row,
                trancoRank: match.rank,
                trancoDate: match.date,
                trancoStatus: match.status === "success" ? ("success" as const) : ("error" as const),
              };
            }
            return {
              ...row,
              trancoStatus: "error" as const,
            };
          });
          return { ...prev, rows: updatedRows };
        });
      }

      addToast("Tranco priority ranks obtained correctly!", "success");
    } catch (err: any) {
      if (err.name === "AbortError" || signal.aborted) {
        console.log("Tranco rank fetching process got aborted.");
      } else {
        console.error("Tranco query error:", err);
        addToast(err.message || "Failed to retrieve priority rankings.", "error");
        
        setState((prev) => {
          const updatedRows = prev.rows.map((r) =>
            indicesToRun.includes(r.index) && r.trancoStatus === "processing"
              ? { ...r, trancoStatus: "error" as const }
              : r
          );
          return { ...prev, rows: updatedRows };
        });
      }
    } finally {
      setIsFetchingTranco(false);
      trancoAbortControllerRef.current = null;
    }
  };

  // Run fast Yes/No News Publisher checking
  const checkNewsPublisherBatch = async (rawIndices: number[]) => {
    const domainsRowsList = state.domainsRows;
    const indicesToRun = rawIndices.filter(
      (idx) => domainsRowsList[idx] && domainsRowsList[idx].newsPublisherStatus !== "success"
    );

    if (indicesToRun.length === 0 || state.isCheckingNewsPublisher) {
      if (rawIndices.length > 0 && indicesToRun.length === 0) {
        addToast("All selected domains have already been checked for news publisher status!", "info");
      }
      return;
    }

    if (domainAbortControllerRef.current) {
      domainAbortControllerRef.current.abort();
    }
    domainAbortControllerRef.current = new AbortController();
    const signal = domainAbortControllerRef.current.signal;

    setState((prev) => {
      const updatedDomainsRows = prev.domainsRows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, newsPublisherStatus: "processing" as const } : r
      );
      return {
        ...prev,
        domainsRows: updatedDomainsRows,
        rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
        isCheckingNewsPublisher: true
      };
    });

    try {
      // Chunking for frontend dispatch: We can send up to 200 at a time to the backend,
      // and the backend parallelizes internally with chunks of 50!
      const BATCH_SIZE = 200;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        const rowsToAnalyze = chunkIndices.map((idx) => domainsRowsList[idx]);
        const domainsToCheck = rowsToAnalyze.map((r) => r.domain);

        const res = await fetch("/api/check-news-publisher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domains: domainsToCheck, customApiKey: customGeminiApiKey }),
          signal,
        });

        const isLimitResponse = res.status === 429;
        let data: any = {};
        try {
          data = await res.json();
        } catch (jsonErr) {}

        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const hasLimitMessage = 
          data.error?.toLowerCase().includes("limit") || 
          data.error?.toLowerCase().includes("quota") || 
          data.error?.toLowerCase().includes("exhausted") || 
          data.error?.toLowerCase().includes("429");

        if (isLimitResponse || !res.ok || !data.success || hasLimitMessage) {
          if (isLimitResponse || hasLimitMessage) {
            const errMsg = data.error || data.message || "AI/Gemini quota limit reached.";
            setApiLimitError(errMsg);
            handleStopAllProcesses();
            throw new Error(`API_LIMIT_REACHED: ${errMsg}`);
          }
          throw new Error(data.error || "Batch news status check failed.");
        }

        const freshResults = data.results as any[];
        
        // Cache news publisher check results to DB and local cache
        await setCachedDomains(freshResults.map((item) => ({
          domain: item.domain,
          isNewsPublisher: item.isNewsPublisher,
          reasoning: item.reasoning,
        })));

        const finalResultsMap: Record<string, any> = {};
        freshResults.forEach((item) => {
          finalResultsMap[String(item.domain).toLowerCase().trim()] = {
            isNewsPublisher: item.isNewsPublisher,
            reasoning: item.reasoning,
          };
        });

        setState((prev) => {
          const updatedDomainsRows = prev.domainsRows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = finalResultsMap[row.domain.toLowerCase().trim()];
            if (match) {
              return {
                ...row,
                isNewsPublisher: match.isNewsPublisher,
                reasoning: match.reasoning,
                newsPublisherStatus: "success" as const,
              };
            } else {
              return {
                ...row,
                newsPublisherStatus: "error" as const,
                errorMsg: "No status returned for this domain.",
              };
            }
          });
          return {
            ...prev,
            domainsRows: updatedDomainsRows,
            rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
          };
        });
      }

      addToast("Successfully checked news publisher status for selected domains!", "success");
    } catch (err: any) {
      if (err.name === "AbortError" || err.message === "Aborted") {
        console.log("News publisher check process aborted by user.");
      } else {
        const msg = err.message || String(err);
        console.log(`Error checking news status: ${msg}`);
        addToast(`News check error: ${msg}`, "error");

        setState((prev) => {
          const updatedDomainsRows = prev.domainsRows.map((r) =>
            indicesToRun.includes(r.index) && r.newsPublisherStatus === "processing"
              ? { ...r, newsPublisherStatus: "error" as const, errorMsg: msg }
              : r
          );
          return {
            ...prev,
            domainsRows: updatedDomainsRows,
            rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
          };
        });
      }
    } finally {
      setState((prev) => ({ ...prev, isCheckingNewsPublisher: false }));
      domainAbortControllerRef.current = null;
    }
  };

  // Run the batch domain classification using caching and Gemini fallback
  const classifyDomainsBatch = async (rawIndices: number[]) => {
    const domainsRowsList = state.domainsRows;
    // Only hit pending items: filter out successes!
    const indicesToRun = rawIndices.filter(
      (idx) => domainsRowsList[idx] && domainsRowsList[idx].status !== "success"
    );
    if (indicesToRun.length === 0 || state.isClassifying) {
      if (rawIndices.length > 0 && indicesToRun.length === 0) {
        addToast("All selected domains have already been successfully classified!", "info");
      }
      return;
    }

    if (domainAbortControllerRef.current) {
      domainAbortControllerRef.current.abort();
    }
    domainAbortControllerRef.current = new AbortController();
    const signal = domainAbortControllerRef.current.signal;

    setState((prev) => {
      const updatedDomainsRows = prev.domainsRows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, status: "processing" as const, newsPublisherStatus: "processing" as const } : r
      );
      return {
        ...prev,
        domainsRows: updatedDomainsRows,
        rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
        isClassifying: true
      };
    });

    let currentChunk: number[] = [];
    const allProcessedResults: any[] = [];

    try {
      const BATCH_SIZE = 100;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        currentChunk = chunkIndices;
        const rowsToAnalyze = chunkIndices.map((idx) => domainsRowsList[idx]);
        const domainsToClassify = rowsToAnalyze.map((r) => r.domain);

        // 1. Fetch from Domain Cache
        const cachedData = await getCachedDomains(domainsToClassify);
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const hitRows: { index: number; data: any }[] = [];
        const missIndices: number[] = [];
        const missDomains: string[] = [];

        rowsToAnalyze.forEach((row) => {
          const cleanDom = row.domain.toLowerCase().trim();
          const cached = cachedData[cleanDom];
          // Ensure we have a valid cache hit that includes the updated metadata properties (siteName, displayName)
          if (cached && (cached.siteName || cached.displayName)) {
            hitRows.push({ index: row.index, data: cached });
          } else {
            missIndices.push(row.index);
            missDomains.push(row.domain);
          }
        });

        let finalResultsMap: Record<string, any> = {};

        // Initialize with cache hits
        hitRows.forEach(({ index, data }) => {
          finalResultsMap[domainsRowsList[index].domain.toLowerCase().trim()] = {
            category: data.category,
            isNewsPublisher: data.isNewsPublisher,
            reasoning: data.reasoning + " (Retrieved from Cache)",
            siteName: data.siteName,
            displayName: data.displayName,
            description: data.description,
            trancoRank: data.trancoRank !== undefined ? data.trancoRank : undefined,
            trancoDate: data.trancoDate !== undefined ? data.trancoDate : undefined,
            country: data.country !== undefined ? data.country : undefined,
            language: data.language !== undefined ? data.language : undefined,
            rssUrl: data.rssUrl !== undefined ? data.rssUrl : undefined,
            sitemapUrl: data.sitemapUrl !== undefined ? data.sitemapUrl : undefined,
            newsCategory: data.newsCategory !== undefined ? data.newsCategory : undefined,
            sourcetype: data.sourcetype !== undefined ? data.sourcetype : undefined,
            status: "success" as const
          };
        });

        // 2. Fetch cache misses from API fallback if needed
        if (missDomains.length > 0) {
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domains: missDomains, customApiKey: customGeminiApiKey }),
            signal,
          });

          const isLimitResponse = res.status === 429;
          let data: any = {};
          try {
            data = await res.json();
          } catch (jsonErr) {}

          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const hasLimitMessage = 
            data.error?.toLowerCase().includes("limit") || 
            data.error?.toLowerCase().includes("quota") || 
            data.error?.toLowerCase().includes("exhausted") || 
            data.error?.toLowerCase().includes("429") ||
            data.message?.toLowerCase().includes("limit") ||
            data.message?.toLowerCase().includes("quota");

          if (isLimitResponse || !res.ok || !data.success || hasLimitMessage) {
            if (isLimitResponse || hasLimitMessage) {
              const errMsg = data.error || data.message || "AI/Gemini quota limit reached or daily API limits exceeded.";
              setApiLimitError(errMsg);
              // Force stop all remaining background queues instantly
              handleStopAllProcesses();
              throw new Error(`API_LIMIT_REACHED: ${errMsg}`);
            }
            throw new Error(data.error || "Batch classification query failed.");
          }

          const freshResults = data.results as any[];

          // Save fresh results to the database cache
          await setCachedDomains(freshResults);

          freshResults.forEach((item) => {
            finalResultsMap[String(item.domain).toLowerCase().trim()] = {
              category: item.category,
              isNewsPublisher: item.isNewsPublisher,
              reasoning: item.reasoning,
              siteName: item.siteName,
              displayName: item.displayName,
              description: item.description,
              status: "success" as const
            };
          });
        }

        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let processedResultsForBatch: any[] = [];

        // Map everything back to UI state incrementally
        setState((prev) => {
          const updatedDomainsRows = prev.domainsRows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = finalResultsMap[row.domain.toLowerCase().trim()];
            if (match) {
              const isSuccess = match.category && match.isNewsPublisher;
              const hasNewsSuccess = match.country && match.language;
              return {
                ...row,
                category: match.category !== undefined ? match.category : row.category,
                isNewsPublisher: match.isNewsPublisher !== undefined ? match.isNewsPublisher : row.isNewsPublisher,
                reasoning: match.reasoning !== undefined ? match.reasoning : row.reasoning,
                siteName: match.siteName !== undefined ? match.siteName : row.siteName,
                displayName: match.displayName !== undefined ? match.displayName : row.displayName,
                description: match.description !== undefined ? match.description : row.description,
                trancoRank: match.trancoRank !== undefined ? match.trancoRank : row.trancoRank,
                trancoDate: match.trancoDate !== undefined ? match.trancoDate : row.trancoDate,
                trancoStatus: match.trancoRank !== undefined ? ("success" as const) : row.trancoStatus,
                country: match.country !== undefined ? match.country : row.country,
                language: match.language !== undefined ? match.language : row.language,
                rssUrl: match.rssUrl !== undefined ? match.rssUrl : row.rssUrl,
                sitemapUrl: match.sitemapUrl !== undefined ? match.sitemapUrl : row.sitemapUrl,
                newsCategory: match.newsCategory !== undefined ? match.newsCategory : row.newsCategory,
                sourcetype: match.sourcetype !== undefined ? match.sourcetype : row.sourcetype,
                newsStatus: hasNewsSuccess ? ("success" as const) : row.newsStatus,
                status: isSuccess ? ("success" as const) : row.status,
                newsPublisherStatus: isSuccess ? ("success" as const) : row.newsPublisherStatus,
              };
            } else {
              return {
                ...row,
                status: "error" as const,
                newsPublisherStatus: "error" as const,
                errorMsg: "No classification matching this domain returned/cached.",
              };
            }
          });

          processedResultsForBatch = updatedDomainsRows.filter((r) => chunkIndices.includes(r.index));
          return {
            ...prev,
            domainsRows: updatedDomainsRows,
            rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows
          };
        });

        allProcessedResults.push(...processedResultsForBatch);

        // Small yield to let react components paint and avoid API hammering
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Save complete run history log in single chunk/documents of up to 100
      if (allProcessedResults.length > 0) {
        saveRunHistory(
          firebaseUser?.uid || "offline_sandbox_bypass_user",
          firebaseUser?.email || "Guest Sandbox Developer",
          state.config.spreadsheetId ? `Google Sheet: ${state.config.spreadsheetId.slice(0, 8)}` : "Uploaded File",
          "domains",
          allProcessedResults
        );
      }

      setState((prev) => ({ ...prev, isClassifying: false }));

    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        console.log("Classification aborted by user.");
        setState((prev) => {
          const updatedDomainsRows = prev.domainsRows.map((r) =>
            indicesToRun.includes(r.index) && r.status === "processing"
              ? { ...r, status: "pending" as const, newsPublisherStatus: "pending" as const }
              : r
          );
          return {
            ...prev,
            domainsRows: updatedDomainsRows,
            rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
            isClassifying: false
          };
        });
        return;
      }

      const isLimit = err.message?.startsWith("API_LIMIT_REACHED");
      if (isLimit) {
        const cleanMsg = err.message.replace("API_LIMIT_REACHED: ", "");
        setState((prev) => {
          const updatedDomainsRows = prev.domainsRows.map((r) => {
            if (!indicesToRun.includes(r.index)) return r;
            if (currentChunk.includes(r.index)) {
              return { ...r, status: "error" as const, newsPublisherStatus: "error" as const, errorMsg: cleanMsg };
            }
            if (r.status === "processing") {
              return { ...r, status: "pending" as const, newsPublisherStatus: "pending" as const };
            }
            return r;
          });
          return {
            ...prev,
            domainsRows: updatedDomainsRows,
            rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
            isClassifying: false
          };
        });
        return;
      }

      console.error(err);
      setState((prev) => {
        const updatedDomainsRows = prev.domainsRows.map((r) => {
          if (!indicesToRun.includes(r.index)) return r;
          if (currentChunk.includes(r.index)) {
            return {
              ...r,
              status: "error" as const,
              newsPublisherStatus: "error" as const,
              errorMsg: err.message || "Cache check or AI classification failed"
            };
          }
          if (r.status === "processing") {
            return { ...r, status: "pending" as const, newsPublisherStatus: "pending" as const };
          }
          return r;
        });
        return {
          ...prev,
          domainsRows: updatedDomainsRows,
          rows: prev.appMode === "domains" ? updatedDomainsRows : prev.rows,
          isClassifying: false
        };
      });
    } finally {
      if (domainAbortControllerRef.current?.signal === signal) {
        domainAbortControllerRef.current = null;
      }
    }
  };

  // Find news feed elements using caching & AI model query fallback
  const validateNewsSourcesBatch = async (rawIndices: number[]) => {
    const sourcesRowsList = state.sourcesRows;
    // Only hit pending items: filter out successes!
    const indicesToRun = rawIndices.filter(
      (idx) => sourcesRowsList[idx] && sourcesRowsList[idx].newsStatus !== "success"
    );
    if (indicesToRun.length === 0 || isAnalyzingNews) {
      if (rawIndices.length > 0 && indicesToRun.length === 0) {
        addToast("All selected feeds/sources have already been successfully analyzed!", "info");
      }
      return;
    }

    if (newsAbortControllerRef.current) {
      newsAbortControllerRef.current.abort();
    }
    newsAbortControllerRef.current = new AbortController();
    const signal = newsAbortControllerRef.current.signal;

    setIsAnalyzingNews(true);
    setState((prev) => {
      const updatedSourcesRows = prev.sourcesRows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, newsStatus: "processing" as const } : r
      );
      return {
        ...prev,
        sourcesRows: updatedSourcesRows,
        rows: prev.appMode === "sources" ? updatedSourcesRows : prev.rows
      };
    });

    const isSourcesMode = state.appMode === "sources";

    let currentChunk: number[] = [];
    const allProcessedResults: any[] = [];

    try {
      const BATCH_SIZE = 100;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        currentChunk = chunkIndices;
        const chunkRows = chunkIndices.map((idx) => sourcesRowsList[idx]);
        const chunkDomains = chunkRows.map((r) => r.domain);

        let finalNewsMap: Record<string, any> = {};

        // --- Feed / Source level mode with source_cache ---
        const cachedSources = await getCachedSources(chunkDomains);
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const hitRows: { index: number; data: any }[] = [];
        const missIndices: number[] = [];
        const missSources: string[] = [];

        chunkRows.forEach((row) => {
          const cleanSrc = row.domain.toLowerCase().trim();
          if (cachedSources[cleanSrc]) {
            hitRows.push({ index: row.index, data: cachedSources[cleanSrc] });
          } else {
            missIndices.push(row.index);
            missSources.push(row.domain);
          }
        });

        // Add hits to map
        hitRows.forEach(({ index, data }) => {
          finalNewsMap[sourcesRowsList[index].domain.toLowerCase().trim()] = {
            country: data.country,
            language: data.language,
            newsCategory: normalizeCategory(data.category || data.newsCategory),
            sourcetype: data.sourcetype,
            newsStatus: "success" as const,
            isCacheHit: true
          };
        });

        // Evaluate misses with API
        if (missSources.length > 0) {
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const res = await fetch("/api/classify-source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sources: missSources, customApiKey: customGeminiApiKey }),
            signal,
          });

          const isLimitResponse = res.status === 429;
          let data: any = {};
          try {
            data = await res.json();
          } catch (jsonErr) {}

          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const hasLimitMessage = 
            data.error?.toLowerCase().includes("limit") || 
            data.error?.toLowerCase().includes("quota") || 
            data.error?.toLowerCase().includes("exhausted") || 
            data.error?.toLowerCase().includes("429") ||
            data.message?.toLowerCase().includes("limit") ||
            data.message?.toLowerCase().includes("quota");

          if (isLimitResponse || !res.ok || !data.success || hasLimitMessage) {
            if (isLimitResponse || hasLimitMessage) {
              const errMsg = data.error || data.message || "AI/Gemini quota limit reached or daily API limits exceeded.";
              setApiLimitError(errMsg);
              handleStopAllProcesses();
              throw new Error(`API_LIMIT_REACHED: ${errMsg}`);
            }
            throw new Error(data.error || "Direct source classification failed.");
          }

          const freshResults = data.results as any[];

          // Cache freshly classified sources
          await setCachedSources(freshResults);

          freshResults.forEach((item) => {
            finalNewsMap[String(item.source).toLowerCase().trim()] = {
              country: item.country,
              language: item.language,
              newsCategory: normalizeCategory(item.category),
              sourcetype: item.sourcetype,
              newsStatus: "success" as const
            };
          });
        }

        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let processedResultsForBatch: any[] = [];

        // Update React State with final results incrementally
        setState((prev) => {
          const updatedSourcesRows = prev.sourcesRows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = finalNewsMap[row.domain.toLowerCase().trim()];
            if (match) {
              return {
                ...row,
                country: match.country !== undefined && match.country !== null && match.country !== "" ? match.country : row.country,
                language: match.language !== undefined && match.language !== null && match.language !== "" ? match.language : row.language,
                rssUrl: match.rssUrl || row.rssUrl,
                sitemapUrl: match.sitemapUrl || row.sitemapUrl,
                newsCategory: match.newsCategory !== undefined && match.newsCategory !== null && match.newsCategory !== "" ? match.newsCategory : row.newsCategory,
                sourcetype: match.sourcetype || row.sourcetype,
                newsStatus: "success" as const,
                // Mark as news publisher when news analysis succeeds
                isNewsPublisher: match.isNewsPublisher || row.isNewsPublisher,
                reasoning: match.isCacheHit 
                  ? (row.reasoning ? row.reasoning : "Loaded from Cache")
                  : row.reasoning
              };
            } else {
              return {
                ...row,
                newsStatus: "error" as const,
                newsErrorMsg: "No metadata returned or cached.",
              };
            }
          });

          processedResultsForBatch = updatedSourcesRows.filter((r) => chunkIndices.includes(r.index));
          return {
            ...prev,
            sourcesRows: updatedSourcesRows,
            rows: prev.appMode === "sources" ? updatedSourcesRows : prev.rows
          };
        });

        allProcessedResults.push(...processedResultsForBatch);

        // Small yield to balance network loads
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Save complete run history log in single chunk/documents of up to 100
      if (allProcessedResults.length > 0) {
        saveRunHistory(
          firebaseUser?.uid || "offline_sandbox_bypass_user",
          firebaseUser?.email || "Guest Sandbox Developer",
          state.config.spreadsheetId ? `Google Sheet: ${state.config.spreadsheetId.slice(0, 8)}` : "Uploaded Feed List",
          isSourcesMode ? "sources" : "domains",
          allProcessedResults
        );
      }

      setIsAnalyzingNews(false);

    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        console.log("Sources analysis aborted by user.");
        setState((prev) => {
          const updatedSourcesRows = prev.sourcesRows.map((r) =>
            indicesToRun.includes(r.index) && r.newsStatus === "processing"
              ? { ...r, newsStatus: "pending" as const }
              : r
          );
          return {
            ...prev,
            sourcesRows: updatedSourcesRows,
            rows: prev.appMode === "sources" ? updatedSourcesRows : prev.rows
          };
        });
        setIsAnalyzingNews(false);
        return;
      }

      const isLimit = err.message?.startsWith("API_LIMIT_REACHED");
      if (isLimit) {
        const cleanMsg = err.message.replace("API_LIMIT_REACHED: ", "");
        setState((prev) => {
          const updatedSourcesRows = prev.sourcesRows.map((r) => {
            if (!indicesToRun.includes(r.index)) return r;
            if (currentChunk.includes(r.index)) {
              return { ...r, newsStatus: "error" as const, newsErrorMsg: cleanMsg };
            }
            if (r.newsStatus === "processing") {
              return { ...r, newsStatus: "pending" as const };
            }
            return r;
          });
          return {
            ...prev,
            sourcesRows: updatedSourcesRows,
            rows: prev.appMode === "sources" ? updatedSourcesRows : prev.rows
          };
        });
        setIsAnalyzingNews(false);
        return;
      }

      console.error(err);
      setState((prev) => {
        const updatedSourcesRows = prev.sourcesRows.map((r) => {
          if (!indicesToRun.includes(r.index)) return r;
          if (currentChunk.includes(r.index)) {
            return {
              ...r,
              newsStatus: "error" as const,
              newsErrorMsg: err.message || "Feed cached discovery failed"
            };
          }
          if (r.newsStatus === "processing") {
            return { ...r, newsStatus: "pending" as const };
          }
          return r;
        });
        return {
          ...prev,
          sourcesRows: updatedSourcesRows,
          rows: prev.appMode === "sources" ? updatedSourcesRows : prev.rows
        };
      });
      setIsAnalyzingNews(false);
    } finally {
      if (newsAbortControllerRef.current?.signal === signal) {
        newsAbortControllerRef.current = null;
      }
    }
  };

  // Run validation for news-source attributes
  const handleSetAppMode = (mode: "domains" | "sources") => {
    setState((prev) => {
      const currentMode = prev.appMode;
      const savedConfig = prev.config;
      const savedHeaders = prev.headers;
      const savedDomainCol = prev.domainColumnIndex;
      const savedRows = prev.rows;

      let nextDomainsConfig = prev.domainsConfig || { url: DEFAULT_SHEET_URL, spreadsheetId: "", gid: "", sheetName: "" };
      let nextDomainsHeaders = prev.domainsHeaders || [];
      let nextDomainsDomainColumnIndex = prev.domainsDomainColumnIndex || 0;
      let nextDomainsRows = prev.domainsRows || [];

      let nextSourcesConfig = prev.sourcesConfig || { url: DEFAULT_SHEET_URL, spreadsheetId: "", gid: "", sheetName: "" };
      let nextSourcesHeaders = prev.sourcesHeaders || [];
      let nextSourcesDomainColumnIndex = prev.sourcesDomainColumnIndex || 0;
      let nextSourcesRows = prev.sourcesRows || [];

      if (currentMode === "domains") {
        nextDomainsConfig = savedConfig;
        nextDomainsHeaders = savedHeaders;
        nextDomainsDomainColumnIndex = savedDomainCol;
        nextDomainsRows = savedRows;
      } else {
        nextSourcesConfig = savedConfig;
        nextSourcesHeaders = savedHeaders;
        nextSourcesDomainColumnIndex = savedDomainCol;
        nextSourcesRows = savedRows;
      }

      let newConfig = mode === "domains" ? nextDomainsConfig : nextSourcesConfig;
      let newHeaders = mode === "domains" ? nextDomainsHeaders : nextSourcesHeaders;
      let newDomainCol = mode === "domains" ? nextDomainsDomainColumnIndex : nextSourcesDomainColumnIndex;
      let newRows = mode === "domains" ? nextDomainsRows : nextSourcesRows;

      const updatedRows = newRows.map((row) => {
        const rawValue = String((row.originalValues && row.originalValues[newDomainCol]) || row.domain || row.d_url || "").trim();
        let cleanDomain = rawValue;
        if (mode === "domains") {
          cleanDomain = rawValue
            .toLowerCase()
            .replace(/^(https?:\/\/)?(www\.)?/, "")
            .split("/")[0]
            .split("?")[0];
        } else {
          cleanDomain = rawValue;
        }
        return {
          ...row,
          domain: cleanDomain,
        };
      });

      return {
        ...prev,
        appMode: mode,
        config: newConfig,
        headers: newHeaders,
        domainColumnIndex: newDomainCol,
        rows: updatedRows,
        domainsConfig: nextDomainsConfig,
        domainsHeaders: nextDomainsHeaders,
        domainsDomainColumnIndex: nextDomainsDomainColumnIndex,
        domainsRows: mode === "domains" ? updatedRows : nextDomainsRows,
        sourcesConfig: nextSourcesConfig,
        sourcesHeaders: nextSourcesHeaders,
        sourcesDomainColumnIndex: nextSourcesDomainColumnIndex,
        sourcesRows: mode === "sources" ? updatedRows : nextSourcesRows,
        filterCategory: "",
        filterNews: "",
        searchTerm: "",
      };
    });
  };

  const handleValidateNewsSelected = (indices: number[]) => {
    validateNewsSourcesBatch(indices);
  };

  const handleCheckNewsPublisherSelected = (indices: number[]) => {
    checkNewsPublisherBatch(indices);
  };

  const handleCheckNewsPublisherRemaining = () => {
    const pendings = state.rows.filter((r) => r.newsPublisherStatus !== "success").map((r) => r.index);
    if (pendings.length > 0) {
      checkNewsPublisherBatch(pendings);
    }
  };

  // Fire a classification run for manually marked checkboxes
  const handleClassifySelected = (indices: number[]) => {
    classifyDomainsBatch(indices);
  };

  // Run remaining unmarked domains
  const handleClassifyRemaining = () => {
    const pendings = state.rows.filter((r) => r.status === "pending").map((r) => r.index);
    if (pendings.length > 0) {
      classifyDomainsBatch(pendings);
    }
  };

  const handleStopAllProcesses = () => {
    let abortedAny = false;
    if (domainAbortControllerRef.current) {
      domainAbortControllerRef.current.abort();
      domainAbortControllerRef.current = null;
      abortedAny = true;
    }
    if (newsAbortControllerRef.current) {
      newsAbortControllerRef.current.abort();
      newsAbortControllerRef.current = null;
      abortedAny = true;
    }
    if (trancoAbortControllerRef.current) {
      trancoAbortControllerRef.current.abort();
      trancoAbortControllerRef.current = null;
      abortedAny = true;
    }

    // Force reset any active spinners and return "processing" rows to "pending"
    setIsAnalyzingNews(false);
    setIsFetchingTranco(false);
    setState((prev) => {
      const sanitizeRow = (r: any) => ({
        ...r,
        status: r.status === "processing" ? "pending" : r.status,
        newsStatus: r.newsStatus === "processing" ? "pending" : r.newsStatus,
        trancoStatus: r.trancoStatus === "processing" ? undefined : r.trancoStatus,
        newsPublisherStatus: r.newsPublisherStatus === "processing" ? "pending" : r.newsPublisherStatus,
      });

      const sanitizedRows = prev.rows.map(sanitizeRow);
      const sanitizedDomainsRows = (prev.domainsRows || []).map(sanitizeRow);
      const sanitizedSourcesRows = (prev.sourcesRows || []).map(sanitizeRow);

      return {
        ...prev,
        isClassifying: false,
        isCheckingNewsPublisher: false,
        rows: sanitizedRows,
        domainsRows: sanitizedDomainsRows,
        sourcesRows: sanitizedSourcesRows,
      };
    });

    if (abortedAny) {
      console.log("Active analysis processes terminated successfully.");
    }
  };

  const handleResetSession = () => {
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    localStorage.removeItem(`publisher_autosave_session${userKeySuffix}`);
    localStorage.removeItem("publisher_autosave_session_guest");
    localStorage.removeItem("publisher_autosave_session");
    
        // Wipe all local storage caches related to domains, sources, and feeds
    localStorage.removeItem("publisher_cache_domains");
    localStorage.removeItem("publisher_cache_sources");

    setState((prev) => ({
      ...prev,
      config: {
        url: DEFAULT_SHEET_URL,
        spreadsheetId: "",
        gid: "",
        sheetName: "",
      },
      headers: [],
      domainColumnIndex: 0,
      rows: [],
      domainsConfig: {
        url: DEFAULT_SHEET_URL,
        spreadsheetId: "",
        gid: "",
        sheetName: "",
      },
      domainsHeaders: [],
      domainsDomainColumnIndex: 0,
      domainsRows: [],
      sourcesConfig: {
        url: DEFAULT_SHEET_URL,
        spreadsheetId: "",
        gid: "",
        sheetName: "",
      },
      sourcesHeaders: [],
      sourcesDomainColumnIndex: 0,
      sourcesRows: [],
      activeTab: "database",
      filterCategory: "",
      filterNews: "",
      searchTerm: "",
    }));
    // Do NOT trigger any spreadsheet fetching. Let the workspace stay completely clean & empty as requested.
    addToast("Wiped active session & classification caches successfully!", "success");
  };

  const handleClearCurrentResults = () => {
    // Clear local storage caches so the next run does not hit the cache
    localStorage.removeItem("publisher_cache_domains");
    localStorage.removeItem("publisher_cache_sources");

    const clearRowData = (row: any) => ({
      ...row,
      category: undefined,
      isNewsPublisher: undefined,
      reasoning: undefined,
      status: "pending" as const,
      errorMsg: undefined,
      country: undefined,
      language: undefined,
      rssUrl: undefined,
      sitemapUrl: undefined,
      newsCategory: undefined,
      newsStatus: "pending" as const,
      newsErrorMsg: undefined,
      sourcetype: undefined,
    });

    setState((prev) => ({
      ...prev,
      rows: prev.rows.map(clearRowData),
      domainsRows: (prev.domainsRows || []).map(clearRowData),
      sourcesRows: (prev.sourcesRows || []).map(clearRowData),
    }));
    addToast("Wiped all cached classifications of the current dataset!", "info");
  };

  const handleWipeDatabaseCache = async () => {
    try {
      await wipeGlobalDatabaseCache();
      const clearRowData = (row: any) => ({
        ...row,
        category: undefined,
        isNewsPublisher: undefined,
        reasoning: undefined,
        siteName: undefined,
        displayName: undefined,
        description: undefined,
        status: "pending" as const,
        errorMsg: undefined,
        country: undefined,
        language: undefined,
        rssUrl: undefined,
        sitemapUrl: undefined,
        newsCategory: undefined,
        newsStatus: "pending" as const,
        newsErrorMsg: undefined,
        sourcetype: undefined,
      });

      setState((prev) => ({
        ...prev,
        rows: prev.rows.map(clearRowData),
        domainsRows: (prev.domainsRows || []).map(clearRowData),
        sourcesRows: (prev.sourcesRows || []).map(clearRowData),
      }));
      addToast("Cleaned cloud database successfully! Cache has been completely wiped.", "success");
    } catch (err: any) {
      console.error(err);
      addToast(`Oops! Failed to clean cloud cache database: ${err.message || err}`, "error");
    }
  };

  // Connect Google using direct Firebase login with spreadsheets scope, fallback to GSI Token client
  const handleConnectGoogle = async () => {
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    // Attempt standard direct Firebase Auth Popup – zero-configuration & bulletproof in the build applet!
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/spreadsheets");
      
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (credential && credential.accessToken) {
        const token = credential.accessToken;
        const email = result.user.email || "Google Account";
        setState((prev) => ({
          ...prev,
          googleAccessToken: token,
          googleUserEmail: email,
        }));
        localStorage.setItem(`google_access_token${userKeySuffix}`, token);
        localStorage.setItem(`google_user_email${userKeySuffix}`, email);
        addToast("Google Sheets connected successfully!", "success");
        fetchSpreadsheet(state.config.spreadsheetId, state.config.gid, token);
        return;
      }
    } catch (directError: any) {
      console.warn("Direct sign-in popup bypassed or failed. Trying custom Client ID flow.", directError);
    }

    // Fallback B: If direct login was closed/failed and they have configured a client ID, use GSI Token client:
    if (state.googleClientId) {
      try {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: state.googleClientId,
          scope: "https://www.googleapis.com/auth/spreadsheets",
          callback: (resp: any) => {
            if (resp.access_token) {
              setState((prev) => ({
                ...prev,
                googleAccessToken: resp.access_token,
                googleUserEmail: "Authorized Account",
              }));
              localStorage.setItem(`google_access_token${userKeySuffix}`, resp.access_token);
              localStorage.setItem(`google_user_email${userKeySuffix}`, "Authorized Account");
              addToast("Google Access Authorized Successfully via Client ID!", "success");
              // Auto re-fetch sheet with new credentials immediately
              fetchSpreadsheet(state.config.spreadsheetId, state.config.gid, resp.access_token);
            }
          },
        });
        client.requestAccessToken();
        return;
      } catch (err: any) {
        console.error("GSI Token init error:", err);
      }
    }

    // Fallback C: Prompt them to configure manually or input their token
    setShowTokenInputModal(true);
  };

  const handleDisconnectGoogle = () => {
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    setState((prev) => ({ ...prev, googleAccessToken: null, googleUserEmail: null }));
    localStorage.removeItem(`google_access_token${userKeySuffix}`);
    localStorage.removeItem(`google_user_email${userKeySuffix}`);
    addToast("Disconnected Google Account.", "info");
  };

  const handleSaveClientId = (clientId: string) => {
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    setState((prev) => ({ ...prev, googleClientId: clientId }));
    localStorage.setItem(`google_client_id${userKeySuffix}`, clientId);
    addToast("Google Client ID configured successfully!", "success");
  };

  // Paste custom Access Token directly (Bulletproof developer bypass)
  const handleManualAccessToken = () => {
    if (!accessTokenInput.trim()) return;
    const manualToken = accessTokenInput.trim();
    const userKeySuffix = firebaseUser ? `_${firebaseUser.uid}` : "_guest";
    setState((prev) => ({
      ...prev,
      googleAccessToken: manualToken,
      googleUserEmail: "Manual Token Session",
    }));
    localStorage.setItem(`google_access_token${userKeySuffix}`, manualToken);
    localStorage.setItem(`google_user_email${userKeySuffix}`, "Manual Token Session");
    setShowTokenInputModal(false);
    setAccessTokenInput("");
    addToast("Integration Access Token Configured!", "success");
    // Auto re-fetch sheet with custom manual token
    fetchSpreadsheet(state.config.spreadsheetId, state.config.gid, manualToken);
  };  // export results back to the Google Sheet (via Google spreadsheets update API)
  const handleExportToGoogleSheet = async () => {
    setSheetDebugLogs([]); // Clear previous logs
    const addLog = (message: string) => {
      const ts = new Date().toLocaleTimeString();
      setSheetDebugLogs((prev) => [...prev, `[${ts}] ${message}`]);
      console.log(`[Google Sheet Sync Log] ${message}`);
    };

    addLog("Starting Google Sheets export process (User clicked Save back to Sheets)...");
    addLog(`Target Spreadsheet ID: "${state.config.spreadsheetId}"`);
    addLog(`Target GID: "${state.config.gid}"`);

    if (!state.googleAccessToken) {
      addLog("ERROR: No Google OAuth access token detected in memory.");
      setShowTokenInputModal(true);
      return;
    }

    addLog("Google OAuth Access Token detected. Initiating API metadata handshake...");
    setIsUpdatingSheet(true);
    setSheetUpdateResult(null);

    try {
      // 1. Fetch current Sheet info to find sheet title/name representing current GID
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.config.spreadsheetId}`;
      addLog(`Requesting spreadsheet metadata from: ${metaUrl}`);
      
      const sheetMetaDataRes = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${state.googleAccessToken}` },
      });

      addLog(`Metadata API response code: ${sheetMetaDataRes.status} (${sheetMetaDataRes.statusText})`);

      if (!sheetMetaDataRes.ok) {
        if (sheetMetaDataRes.status === 401) {
          handleDisconnectGoogle();
        }
        const errBody = await sheetMetaDataRes.text();
        addLog(`Metadata API failed with body: "${errBody}"`);
        throw new Error(
          `Sheet access error (HTTP ${sheetMetaDataRes.status}). Verify your OAuth token is active and has sheets access.`
        );
      }

      const metaData = await sheetMetaDataRes.json();
      addLog("Successfully parsed spreadsheet metadata. Looking up specific Sheet title by GID...");
      
      const sheetObj = metaData.sheets.find((s: any) => String(s.properties.sheetId) === String(state.config.gid));
      if (sheetObj) {
        addLog(`Found matching Sheet GID metadata! Tab Title is: "${sheetObj.properties.title}" (ID: ${sheetObj.properties.sheetId})`);
      } else {
        addLog(`WARNING: Could not find explicit tab with GID: "${state.config.gid}". Defaulting lookup range to index 0/Sheet1.`);
      }

      const finalSheetName = sheetObj ? sheetObj.properties.title : "Sheet1";
      const escapedSheetName = `'${finalSheetName.replace(/'/g, "''")}'`;

      // 2. Look up header names in spreadsheet values to find where to write results
      const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.config.spreadsheetId}/values/${encodeURIComponent(
        `${escapedSheetName}!A1:Z1`
      )}`;
      addLog(`Fetching existing spreadsheet column headers from range: ${headerUrl}`);
      
      const readHeadersRes = await fetch(headerUrl, {
        headers: { Authorization: `Bearer ${state.googleAccessToken}` },
      });

      addLog(`Column headers read API response code: ${readHeadersRes.status}`);

      if (!readHeadersRes.ok) {
        if (readHeadersRes.status === 401) {
          handleDisconnectGoogle();
        }
        const headerErrBody = await readHeadersRes.text();
        addLog(`Headers API failure: "${headerErrBody}"`);
        throw new Error(`Could not read current spreadsheet header values. Tab lookup or Sheet permissions might be restricted.`);
      }

      const readHeadersData = await readHeadersRes.json();
      const currentHeaders: string[] = readHeadersData.values?.[0] || [];
      addLog(`Spreadsheet headers read successfully. Found ${currentHeaders.length} existing columns: "${currentHeaders.join('", "')}"`);

      const totalOriginalCols = currentHeaders.length;
      const maxRows = state.rows.length + 1; // including header

      const isSources = state.appMode === "sources";

      // 3. Define target columns we want to export based on current appMode
      const exportSchema = isSources 
        ? [
            {
              id: "domain",
              name: "Source URL (fULL URL)",
              matchFn: (h: string) => ["source url (full url)", "source url (direct feed)", "source url", "feed url", "domain"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.domain || ""
            },
            {
              id: "newsStatus",
              name: "Status",
              matchFn: (h: string) => ["status", "newsstatus"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.newsStatus || "pending"
            },
            {
              id: "country",
              name: "Target Country",
              matchFn: (h: string) => ["target country", "country", "geo"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.country || ""
            },
            {
              id: "language",
              name: "Language",
              matchFn: (h: string) => ["language", "lang"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.language || ""
            },
            {
              id: "newsCategory",
              name: "News Category",
              matchFn: (h: string) => ["news category", "source category", "news_category"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.newsCategory || ""
            },
            {
              id: "sourcetype",
              name: "Source Type",
              matchFn: (h: string) => ["source type", "sourcetype", "type"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.sourcetype || ""
            }
          ]
        : [
            {
              id: "siteName",
              name: "Name",
              matchFn: (h: string) => ["name", "site name", "sitename"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.siteName || ""
            },
            {
              id: "displayName",
              name: "Display_Name",
              matchFn: (h: string) => ["display_name", "display name", "displayname"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.displayName || ""
            },
            {
              id: "description",
              name: "Detailed Brand Identity & Description",
              matchFn: (h: string) => ["detailed brand identity & description", "detailed brand identity and description", "description", "domain description"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.description || ""
            },
            {
              id: "d_url",
              name: "Domain(url)",
              matchFn: (h: string) => ["domain(url)", "d_url", "raw url", "url"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.d_url || r.domain || ""
            },
            {
              id: "domain",
              name: "Base Domain",
              matchFn: (h: string) => ["base domain", "domain", "domain url"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.domain || ""
            },
            {
              id: "status",
              name: "Status",
              matchFn: (h: string) => ["status", "analysis status"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.status || "pending"
            },
            {
              id: "trancoRank",
              name: "Tranco Traffic Rank",
              matchFn: (h: string) => ["tranco traffic rank", "tranco priority", "tranco rank", "priority", "tranco"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.trancoRank !== undefined && r.trancoRank !== null ? r.trancoRank.toString() : "-"
            },
            {
              id: "category",
              name: "Category",
              matchFn: (h: string) => ["category", "domain category"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.category || ""
            },
            {
              id: "pagePurpose",
              name: "Page Purpose",
              matchFn: (h: string) => ["page purpose", "purpose", "news publisher", "is newspublisher"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.isNewsPublisher || ""
            },
            {
              id: "reasoning",
              name: "Ai Reasoning",
              matchFn: (h: string) => ["ai reasoning", "reasoning"].includes(h.toLowerCase()),
              valFn: (r: DomainRow) => r.reasoning || ""
            }
          ];

      addLog(`Unifying export column mappings for non-destructive "${state.appMode}" mode...`);

      // 4. Filter out headers belonging to the OTHER mode to keep them separate
      const otherModeKeys = isSources
        ? [
            "name", "site name", "sitename",
            "display_name", "display name", "displayname",
            "detailed brand identity & description", "detailed brand identity and description", "description", "domain description",
            "domain(url)", "d_url", "raw url", "url",
            "base domain", "domain url",
            "tranco traffic rank", "tranco priority", "tranco rank", "priority", "tranco",
            "category",
            "page purpose", "purpose", "news publisher", "is newspublisher",
            "ai reasoning", "reasoning"
          ]
        : [
            "source url (direct feed)",
            "source url (full url)",
            "source url",
            "target country",
            "language",
            "news category",
            "source type"
          ];

      const indicesToKeep: number[] = [];
      const filteredHeaders: string[] = [];
      
      currentHeaders.forEach((h, idx) => {
        const lower = h.toLowerCase().trim();
        if (otherModeKeys.includes(lower)) {
          addLog(`Excluding extra column belonging to other classification mode: "${h}" at index ${idx}`);
        } else {
          indicesToKeep.push(idx);
          filteredHeaders.push(h);
        }
      });

      const totalFilteredCols = filteredHeaders.length;

      let nextAvailableAppendOffset = 0;
      const mappedCols = exportSchema.map((col) => {
        const foundIndex = filteredHeaders.findIndex(col.matchFn);
        if (foundIndex !== -1) {
          addLog(` - Found existing column for "${col.name}" at index ${foundIndex}`);
          return { ...col, finalIndex: foundIndex, isAppend: false };
        } else {
          const finalIndex = totalFilteredCols + nextAvailableAppendOffset;
          nextAvailableAppendOffset++;
          addLog(` - Did not find existing column for "${col.name}". Will append at index ${finalIndex}`);
          return { ...col, finalIndex, isAppend: true };
        }
      });

      let maxColIdx = Math.max(totalFilteredCols - 1, ...mappedCols.map(c => c.finalIndex));
      // Overwrite any trailing extra columns from the original spreadsheet with empty strings to clear them
      maxColIdx = Math.max(maxColIdx, totalOriginalCols - 1);

      // Factor in original values lengths in case some rows are longer than headers (mapped to kept indices)
      for (const rowObj of state.rows) {
        if (rowObj && Array.isArray(rowObj.originalValues)) {
          const maxKeptOriginalIdx = indicesToKeep.length - 1;
          maxColIdx = Math.max(maxColIdx, maxKeptOriginalIdx);
        }
      }

      const endLetter = getColumnLetter(maxColIdx + 1);
      const writeRange = `${escapedSheetName}!A1:${endLetter}${maxRows}`;
      addLog(`Calculated target non-destructive write range: "${writeRange}" (A1 through ${endLetter}${maxRows})`);

      const dataMatrix: string[][] = Array.from({ length: maxRows }, () => []);

      // 1. Prepare Header Row (dataMatrix[0])
      const headerRow: string[] = [...filteredHeaders];
      while (headerRow.length <= maxColIdx) {
        headerRow.push("");
      }
      mappedCols.forEach((col) => {
        headerRow[col.finalIndex] = col.name;
      });
      if (headerRow.length > maxColIdx + 1) {
        headerRow.length = maxColIdx + 1;
      }
      dataMatrix[0] = headerRow;

      // 2. Prepare Data Rows (dataMatrix[r + 1])
      let countExported = 0;
      for (let r = 0; r < state.rows.length; r++) {
        const rowObj = state.rows[r];
        const originalRowVals = Array.isArray(rowObj.originalValues) ? [...rowObj.originalValues] : [];
        const keptRowVals = indicesToKeep.map(idx => originalRowVals[idx] !== undefined && originalRowVals[idx] !== null ? originalRowVals[idx] : "");
        const dataRow: string[] = keptRowVals.map(v => String(v));
        
        while (dataRow.length <= maxColIdx) {
          dataRow.push("");
        }
        
        mappedCols.forEach((col) => {
          dataRow[col.finalIndex] = col.valFn(rowObj);
        });
        
        if (dataRow.length > maxColIdx + 1) {
          dataRow.length = maxColIdx + 1;
        }
        dataMatrix[r + 1] = dataRow;
        countExported++;
      }
      addLog(`Prepared fully integrated matrix for ${countExported} records. Ready to send non-destructive update payload.`);

      // Execute PUT back to Google Sheets range
      const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.config.spreadsheetId}/values/${encodeURIComponent(
        writeRange
      )}?valueInputOption=USER_ENTERED`;

      addLog(`Sending cells payload PUT update to API URL: ${writeUrl}`);
      addLog(`Payload details: majorDimension="ROWS", matrix height=${dataMatrix.length}, matrix width=${dataMatrix[0]?.length || 0}`);

      const updateRes = await fetch(writeUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.googleAccessToken}`,
        },
        body: JSON.stringify({
          range: writeRange,
          majorDimension: "ROWS",
          values: dataMatrix,
        }),
      });

      addLog(`Google Sheet Values Write response status: ${updateRes.status} (${updateRes.statusText})`);

      if (!updateRes.ok) {
        if (updateRes.status === 401) {
          handleDisconnectGoogle();
        }
        const errText = await updateRes.text();
        addLog(`Write request failed! Response body: "${errText}"`);
        throw new Error(`Write API Error (HTTP ${updateRes.status}): ${errText}`);
      }

      addLog("SUCCESS! Spreadsheet values updated successfully. Triggering state refresh handler with updated Google Sheet sync snapshot...");
      setSheetUpdateResult({
        type: "success",
        msg: "Sheet updated successfully! Re-sync details from Google Sheets to confirm.",
      });

      // Reload sheet after update is complete to sync client status
      fetchSpreadsheet(state.config.spreadsheetId, state.config.gid);
    } catch (err: any) {
      addLog(`ERROR encountered: ${err.message || "Unknown error."}`);
      console.error(err);
      setSheetUpdateResult({
        type: "error",
        msg: `Failed to export to spreadsheet: ${err.message || "Unknown error occurred."}`,
      });
    } finally {
      setIsUpdatingSheet(false);
      addLog("Export background run completed.");
    }
  };

  // Client-side CSV download fallback
  const handleDownloadCSV = () => {
    let csvContent = "";
    if (state.appMode === "sources") {
      const headersToDownload = [
        "Source URL (Direct Feed)",
        "Status",
        "Target Country",
        "Language",
        "News Category",
        "Source Type"
      ];
      csvContent += headersToDownload.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";
      for (const row of state.rows) {
        const rowParts = [
          `"${(row.domain || "").replace(/"/g, '""')}"`,
          `"${(row.newsStatus || "pending").replace(/"/g, '""')}"`,
          `"${(row.country || "").replace(/"/g, '""')}"`,
          `"${(row.language || "").replace(/"/g, '""')}"`,
          `"${(row.newsCategory || "").replace(/"/g, '""')}"`,
          `"${(row.sourcetype || "").replace(/"/g, '""')}"`,
        ];
        csvContent += rowParts.join(",") + "\n";
      }
    } else {
      // Header
      const modifiedHeaders = [
        "Name",
        "Display_Name",
        "Detailed Brand Identity & Description",
        "Domain(url)",
        "Base Domain",
        "Status",
        "Tranco Traffic Rank",
        "Category",
        "Page Purpose",
        "Ai Reasoning"
      ];
      csvContent += modifiedHeaders.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

      // Rows
      for (const row of state.rows) {
        const resultsParts = [
          `"${(row.siteName || "").replace(/"/g, '""')}"`,
          `"${(row.displayName || "").replace(/"/g, '""')}"`,
          `"${(row.description || "").replace(/"/g, '""')}"`,
          `"${(row.d_url || row.domain || "").replace(/"/g, '""')}"`,
          `"${(row.domain || "").replace(/"/g, '""')}"`,
          `"${(row.status || "pending").replace(/"/g, '""')}"`,
          `"${(row.trancoRank !== undefined && row.trancoRank !== null ? row.trancoRank.toString() : "-").replace(/"/g, '""')}"`,
          `"${(row.category || "").replace(/"/g, '""')}"`,
          `"${(row.isNewsPublisher || "").replace(/"/g, '""')}"`,
          `"${(row.reasoning || "").replace(/"/g, '""')}"`,
        ];
        csvContent += resultsParts.join(",") + "\n";
      }
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `classified_${state.appMode === "sources" ? "sources" : "domains"}_${state.config.spreadsheetId ? state.config.spreadsheetId.slice(0, 6) : "export"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const classifiedCount = state.appMode === "sources"
    ? state.rows.filter((r) => r.newsStatus === "success").length
    : state.rows.filter((r) => r.status === "success").length;
  const totalCount = state.rows.length;

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 font-sans">
        <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest animate-pulse">Initializing Security Systems...</p>
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthScreen onAuthSuccess={(user) => setFirebaseUser(user)} />;
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] flex flex-col font-sans antialiased text-gray-800 pb-16">
      {/* Floating Toast Notification Stack */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          let bgCol = "bg-white border-gray-100 text-gray-900";
          let iconCol = "text-indigo-500";
          if (toast.type === "success") {
            bgCol = "bg-emerald-50 bg-opacity-95 border-emerald-100 text-emerald-950 shadow-md";
            iconCol = "text-emerald-500";
          } else if (toast.type === "error") {
            bgCol = "bg-rose-50 bg-opacity-95 border-rose-100 text-rose-950 shadow-md";
            iconCol = "text-rose-500";
          } else if (toast.type === "info") {
            bgCol = "bg-sky-50 bg-opacity-95 border-sky-100 text-sky-950 shadow-md";
            iconCol = "text-sky-500";
          }
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-3.5 rounded-2xl border flex items-start gap-2.5 shadow-sm transition-all duration-300 ${bgCol}`}
            >
              {toast.type === "success" ? (
                <CheckCircle2 className={`h-4.5 w-4.5 shrink-0 ${iconCol}`} />
              ) : toast.type === "error" ? (
                <ShieldAlert className={`h-4.5 w-4.5 shrink-0 ${iconCol}`} />
              ) : (
                <Info className={`h-4.5 w-4.5 shrink-0 ${iconCol}`} />
              )}
              <div className="flex-1 text-[11px] font-semibold leading-relaxed">
                {toast.message}
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-gray-400 hover:text-gray-600 transition-colors pointer-events-auto shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Header controls bar */}
      <Header
        sheetUrlInput={state.config.url}
        setSheetUrlInput={handleSetSheetUrl}
        onFetchSpreadsheet={() => fetchSpreadsheet(state.config.spreadsheetId, state.config.gid)}
        isFetchingSheet={state.isFetchingSheet}
        googleAccessToken={state.googleAccessToken}
        googleUserEmail={state.googleUserEmail}
        onConnectGoogle={handleConnectGoogle}
        onDisconnectGoogle={handleDisconnectGoogle}
        activeTab={state.activeTab}
        setActiveTab={(tab) => setState((prev) => ({ ...prev, activeTab: tab }))}
        appMode={state.appMode}
        setAppMode={handleSetAppMode}
        countClassified={classifiedCount}
        countTotal={totalCount}
        firebaseUser={firebaseUser}
        onSignOutFirebase={handleSignOutFirebase}
        onResetSession={handleResetSession}
        customGeminiApiKey={customGeminiApiKey}
        setCustomGeminiApiKey={setCustomGeminiApiKey}
      />

      {/* Main Display Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-grow w-full">
        {/* Sheet fetching error alert */}
        {sheetFetchError && (
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-950 mb-6 flex items-start gap-3 justify-between">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold">Could Not Load Google Sheet</p>
                <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                  {sheetFetchError}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  {(sheetFetchError.toLowerCase().includes("expired") || sheetFetchError.toLowerCase().includes("401") || sheetFetchError.toLowerCase().includes("auth") || sheetFetchError.toLowerCase().includes("token")) && (
                    <button
                      onClick={handleConnectGoogle}
                      className="px-2.5 py-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-750 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      Connect Google Sheets
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowTokenInputModal(true);
                    }}
                    className="px-2.5 py-1 text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    Authenticate / Paste Token
                  </button>
                  <button
                    onClick={() => {
                      fetchSpreadsheet(state.config.spreadsheetId, state.config.gid);
                    }}
                    className="px-2.5 py-1 text-[10px] font-semibold border border-amber-300 text-amber-800 rounded-lg bg-white hover:bg-amber-100 transition-colors cursor-pointer"
                  >
                    Retry Fetch
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSheetFetchError(null)}
              className="text-amber-500 hover:text-amber-700 text-xs font-bold shrink-0"
              title="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* API limit error alert banner */}
        {apiLimitError && (
          <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-950 mb-6 flex items-start gap-3 justify-between animate-bounce">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-5 w-5 text-red-600 mt-0.5 shrink-0 animate-pulse" />
              <div>
                <p className="text-xs font-bold text-red-850">AI API Quota / Rate Limit Exceeded</p>
                <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                  {apiLimitError}
                </p>
                <p className="text-[10px] text-red-600 mt-1.5 font-semibold">
                  All active classifications have been automatically halted to preserve your progress. Please check your billing or try again in a moment.
                </p>
              </div>
            </div>
            <button
              onClick={() => setApiLimitError(null)}
              className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0 cursor-pointer"
              title="Dismiss error alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Banner with feedback status checks */}
        {sheetUpdateResult && (
          <div
            className={`p-4 rounded-xl border mb-6 flex items-start gap-3 justify-between ${
              sheetUpdateResult.type === "success"
                ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                : "bg-red-50 border-red-100 text-red-800"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {sheetUpdateResult.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-xs font-semibold">
                  {sheetUpdateResult.type === "success" ? "Google Sheet Export Successful" : "Google Sheet Export Failed"}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">{sheetUpdateResult.msg}</p>
                {sheetUpdateResult.type === "error" && (sheetUpdateResult.msg.toLowerCase().includes("401") || sheetUpdateResult.msg.toLowerCase().includes("auth") || sheetUpdateResult.msg.toLowerCase().includes("token") || sheetUpdateResult.msg.toLowerCase().includes("unauthorized") || sheetUpdateResult.msg.toLowerCase().includes("permissions")) && (
                  <div className="mt-3">
                    <button
                      onClick={handleConnectGoogle}
                      className="px-2.5 py-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-750 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      Connect Google Sheets
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setSheetUpdateResult(null)}
              className="text-xs font-medium text-gray-400 hover:text-gray-650"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Dynamic real-time/historical Google Sheet export debugging log */}
        {sheetDebugLogs.length > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-gray-950 text-gray-100 shadow-md">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-[11px] font-bold tracking-wider font-mono uppercase text-gray-400">Google Sheet Actions Sync Debugger Logs</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(sheetDebugLogs.join("\n"));
                    addToast("Debug logs successfully copied to your clipboard!", "success");
                  }}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-gray-800 hover:bg-gray-750 text-gray-300 rounded border border-gray-700 transition-colors cursor-pointer"
                >
                  Copy Log
                </button>
                <button
                  type="button"
                  onClick={() => setSheetDebugLogs([])}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-gray-800 hover:bg-gray-750 text-gray-400 rounded hover:text-white transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto font-mono text-[10px] space-y-1.5 leading-relaxed pr-1 rounded bg-black/40 p-3 select-text border border-gray-900">
              {sheetDebugLogs.map((log, index) => {
                let colorClass = "text-gray-300";
                if (log.includes("ERROR") || log.includes("failed") || log.includes("Error")) {
                  colorClass = "text-red-400 font-bold";
                } else if (log.includes("SUCCESS") || log.includes("successfully") || log.includes("read successfully")) {
                  colorClass = "text-emerald-400 font-semibold";
                } else if (log.includes("WARNING")) {
                  colorClass = "text-amber-400";
                } else if (log.includes("Sending") || log.includes("Requesting") || log.includes("Handshake") || log.includes("Handled")) {
                  colorClass = "text-sky-300";
                }
                return (
                  <div key={index} className={colorClass}>
                    {log}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[9px] text-gray-500 text-right">
              Logs are printed dynamically upon clicking any "Save" or "Export" action button.
            </div>
          </div>
        )}

        {/* Sync panel representing quick actions when sheet is loaded */}
        {totalCount > 0 && (
          <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-xs mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Active Document: <span className="font-mono text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border text-[10px]">{state.config.spreadsheetId}</span>
              </div>
              <p className="text-[10px] text-gray-400">
                Found {totalCount} domains. {classifiedCount} classified. {totalCount - classifiedCount} pending.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {state.isClassifying || isAnalyzingNews || state.isCheckingNewsPublisher || isFetchingTranco ? (
                <button
                  type="button"
                  onClick={handleStopAllProcesses}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer animate-pulse mr-2"
                  title="Force stop all running background processes"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white block animate-ping mr-1.5"></span>
                  Stop Process
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-400 text-xs font-bold rounded-xl cursor-not-allowed mr-2 opacity-80"
                  title="No active processes running"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-300 block mr-1.5"></span>
                  Stop Process
                </button>
              )}

              <button
                onClick={handleDownloadCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-xs font-semibold rounded-xl text-gray-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>

              <button
                onClick={handleExportToGoogleSheet}
                disabled={isUpdatingSheet || state.rows.length === 0}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-white text-xs font-semibold rounded-xl transition-all duration-300 shadow-xs focus:outline-hidden focus:ring-2 disabled:opacity-45 disabled:cursor-not-allowed ${
                  isUpdatingSheet
                    ? "bg-amber-500 hover:bg-amber-600 focus:ring-amber-300 animate-pulse"
                    : sheetUpdateResult?.type === "success"
                    ? "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300"
                    : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-300"
                }`}
              >
                {isUpdatingSheet ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Exporting to Sheet...
                  </>
                ) : sheetUpdateResult?.type === "success" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-white" />
                    Saved to Sheets Successfully!
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4" />
                    Write results to Google Sheet
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Primary View Router */}
        {state.activeTab === "database" && (
          <DomainTable
            rows={state.rows}
            isClassifying={state.isClassifying}
            onClassifySelected={handleClassifySelected}
            onClassifyRemaining={handleClassifyRemaining}
            isCheckingNewsPublisher={state.isCheckingNewsPublisher}
            onCheckNewsPublisherSelected={handleCheckNewsPublisherSelected}
            onCheckNewsPublisherRemaining={handleCheckNewsPublisherRemaining}
            filterCategory={state.filterCategory}
            setFilterCategory={(val) => setState((prev) => ({ ...prev, filterCategory: val }))}
            filterNews={state.filterNews}
            setFilterNews={(val) => setState((prev) => ({ ...prev, filterNews: val }))}
            searchTerm={state.searchTerm}
            setSearchTerm={(val) => setState((prev) => ({ ...prev, searchTerm: val }))}
            isAnalyzingNews={isAnalyzingNews}
            onValidateNewsSelected={handleValidateNewsSelected}
            appMode={state.appMode}
            onStopAllProcesses={handleStopAllProcesses}
            onClearCurrentResults={handleClearCurrentResults}
            onWipeDatabaseCache={handleWipeDatabaseCache}
            isFetchingTranco={isFetchingTranco}
            onFetchTrancoRanks={handleFetchTrancoRanks}
          />
        )}

        {state.activeTab === "analytics" && <VisualCharts rows={state.rows} />}

        {state.activeTab === "history" && firebaseUser && (
          <HistoryScreen 
            userId={firebaseUser.uid} 
            onLoadRun={(results, fileName, mode) => {
              setState((prev) => ({
                ...prev,
                rows: results,
                appMode: mode,
                activeTab: "database"
              }));
            }} 
          />
        )}

        {state.activeTab === "instructions" && (
          <SetupInstructions googleClientId={state.googleClientId} onSaveClientId={handleSaveClientId} />
        )}
      </main>

      {/* Manual Access Token input dialog overlay */}
      {showTokenInputModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full border border-gray-100 shadow-xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 uppercase tracking-wide">
                  <Key className="h-4 w-4 text-indigo-600" />
                  Configure Sheets API Authorization
                </h3>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  To save classification results back into your Google Sheet, paste your temporary Access Token or configure Google Sign-In.
                </p>
              </div>
              <button
                onClick={() => setShowTokenInputModal(false)}
                className="text-gray-400 hover:text-gray-650 font-semibold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-gray-400 uppercase">Option A: Paste Google Access Token</label>
              <textarea
                placeholder="Paste Bearer Access Token here..."
                rows={3}
                value={accessTokenInput}
                onChange={(e) => setAccessTokenInput(e.target.value)}
                className="w-full text-xs font-mono p-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-hidden bg-gray-50/50"
              />
              <button
                onClick={handleManualAccessToken}
                disabled={!accessTokenInput.trim()}
                className="w-full py-2 text-xs font-semibold bg-gray-900 hover:bg-gray-850 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                Initialize Token
              </button>
            </div>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-200"></div>
              <span className="flex-shrink mx-3 text-[10px] text-gray-400 font-bold uppercase">Or</span>
              <div className="flex-grow border-t border-gray-200"></div>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-gray-400 uppercase">Option B: Set up Google Web OAuth</label>
              <p className="text-[10px] text-gray-500 leading-normal">
                To utilize the direct Sign-In popup in your browser, enter your Google OAuth client ID under the <strong>Guides &amp; Configuration tab</strong> first!
              </p>
              <button
                onClick={() => {
                  setShowTokenInputModal(false);
                  setState((prev) => ({ ...prev, activeTab: "instructions" }));
                }}
                className="w-full py-2 text-xs font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                Go to OAuth setup guides
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
