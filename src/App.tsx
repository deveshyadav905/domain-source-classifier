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
  getCachedNewsFeeds, 
  setCachedNewsFeeds, 
  saveRunHistory 
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
    isFetchingSheet: false,
    isClassifying: false,
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
  const [apiLimitError, setApiLimitError] = useState<string | null>(null);

  const domainAbortControllerRef = useRef<AbortController | null>(null);
  const newsAbortControllerRef = useRef<AbortController | null>(null);

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
          // Clean up any remaining processing rows so they don't look stuck or keep running in automode
          const cleanedRows = parsed.rows.map((row: any) => ({
            ...row,
            status: row.status === "processing" ? "pending" : row.status,
            newsStatus: row.newsStatus === "processing" ? "pending" : row.newsStatus,
          }));

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
        appMode: state.appMode,
        activeTab: state.activeTab,
      };
      localStorage.setItem(`publisher_autosave_session${userKeySuffix}`, JSON.stringify(saveData));
    }
  }, [state.rows, state.headers, state.domainColumnIndex, state.config, state.appMode, state.activeTab, firebaseUser, authInitialized]);

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

      // Check if Category, News Publisher, Reasoning already exist in the sheet
      let catColIdx = headers.findIndex((h) => h.toLowerCase() === "category" || h.toLowerCase() === "news category" || h.toLowerCase() === "sub-category");
      let newsColIdx = headers.findIndex((h) => h.toLowerCase() === "news publisher");
      let reasonColIdx = headers.findIndex((h) => h.toLowerCase() === "reasoning" || h.toLowerCase() === "ai description / reasoning" || h.toLowerCase() === "ai domain description");
      let countryColIdx = headers.findIndex((h) => h.toLowerCase() === "country");
      let langColIdx = headers.findIndex((h) => h.toLowerCase() === "language" || h.toLowerCase() === "lang");

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
          cleanDomain = rawDomain.replace(/^(https?:\/\/)?(www\.)?/, "");
        }

        // Read pre-existing values if any
        const existingCat = catColIdx !== -1 ? (rawRow[catColIdx] as any) : undefined;
        const existingNews = newsColIdx !== -1 ? (rawRow[newsColIdx] as any) : undefined;
        const existingReason = reasonColIdx !== -1 ? rawRow[reasonColIdx] : undefined;
        const existingCountry = countryColIdx !== -1 ? rawRow[countryColIdx] : undefined;
        const existingLang = langColIdx !== -1 ? rawRow[langColIdx] : undefined;

        const isSuccess = existingCat && existingNews;
        const hasNewsSuccess = existingCountry && existingLang;

        return {
          index: i,
          domain: cleanDomain || rawDomain,
          originalValues: rawRow,
          category: isSuccess ? existingCat : undefined,
          isNewsPublisher: isSuccess ? existingNews : undefined,
          reasoning: isSuccess ? existingReason : undefined,
          country: existingCountry,
          language: existingLang,
          newsCategory: isSuccess ? existingCat : undefined,
          status: isSuccess ? "success" as const : "pending" as const,
          newsStatus: hasNewsSuccess ? "success" as const : "pending" as const,
        };
      });

      setState((prev) => ({
        ...prev,
        headers,
        domainColumnIndex: detectedCol,
        rows,
        isFetchingSheet: false,
      }));
    } catch (err: any) {
      console.error(err);
      setSheetFetchError(err.message || "Failed to fetch spreadsheet. Confirm that the resource is public/viewable.");
      setState((prev) => ({ ...prev, isFetchingSheet: false }));
    }
  };

  // Run the batch domain classification using caching and Gemini fallback
  const classifyDomainsBatch = async (rawIndices: number[]) => {
    // Only hit pending items: filter out successes!
    const indicesToRun = rawIndices.filter(
      (idx) => state.rows[idx] && state.rows[idx].status !== "success"
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
      const updatedRows = prev.rows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, status: "processing" as const } : r
      );
      return { ...prev, rows: updatedRows, isClassifying: true };
    });

    try {
      const BATCH_SIZE = 5;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        const rowsToAnalyze = chunkIndices.map((idx) => state.rows[idx]);
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
          if (cachedData[cleanDom]) {
            hitRows.push({ index: row.index, data: cachedData[cleanDom] });
          } else {
            missIndices.push(row.index);
            missDomains.push(row.domain);
          }
        });

        let finalResultsMap: Record<string, any> = {};

        // Initialize with cache hits
        hitRows.forEach(({ index, data }) => {
          finalResultsMap[state.rows[index].domain.toLowerCase().trim()] = {
            category: data.category,
            isNewsPublisher: data.isNewsPublisher,
            reasoning: data.reasoning + " (Retrieved from Cache)",
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
            body: JSON.stringify({ domains: missDomains }),
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
              status: "success" as const
            };
          });
        }

        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        // Map everything back to UI state incrementally
        setState((prev) => {
          const updatedRows = prev.rows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = finalResultsMap[row.domain.toLowerCase().trim()];
            if (match) {
              return {
                ...row,
                category: match.category,
                isNewsPublisher: match.isNewsPublisher,
                reasoning: match.reasoning,
                status: "success" as const,
              };
            } else {
              return {
                ...row,
                status: "error" as const,
                errorMsg: "No classification matching this domain returned/cached.",
              };
            }
          });

          // Save run history log incrementally
          const processedResults = updatedRows.filter((r) => chunkIndices.includes(r.index));
          saveRunHistory(
            firebaseUser?.uid || "offline_sandbox_bypass_user",
            firebaseUser?.email || "Guest Sandbox Developer",
            prev.config.spreadsheetId ? `Google Sheet: ${prev.config.spreadsheetId.slice(0, 8)}` : "Uploaded File",
            "domains",
            processedResults
          );

          return { ...prev, rows: updatedRows };
        });

        // Small yield to let react components paint and avoid API hammering
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      setState((prev) => ({ ...prev, isClassifying: false }));

    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        console.log("Classification aborted by user.");
        setState((prev) => {
          const updatedRows = prev.rows.map((r) =>
            indicesToRun.includes(r.index) && r.status === "processing"
              ? { ...r, status: "pending" as const }
              : r
          );
          return { ...prev, rows: updatedRows, isClassifying: false };
        });
        return;
      }

      const isLimit = err.message?.startsWith("API_LIMIT_REACHED");
      if (isLimit) {
        // Reset remaining processing rows to pending on rate limits
        setState((prev) => {
          const updatedRows = prev.rows.map((r) =>
            indicesToRun.includes(r.index) && r.status === "processing"
              ? { ...r, status: "pending" as const }
              : r
          );
          return { ...prev, rows: updatedRows, isClassifying: false };
        });
        return;
      }

      console.error(err);
      setState((prev) => {
        const updatedRows = prev.rows.map((r) =>
          indicesToRun.includes(r.index) && r.status === "processing"
            ? { ...r, status: "error" as const, errorMsg: err.message || "Cache check or AI classification failed" }
            : r
        );
        return { ...prev, rows: updatedRows, isClassifying: false };
      });
    } finally {
      if (domainAbortControllerRef.current?.signal === signal) {
        domainAbortControllerRef.current = null;
      }
    }
  };

  // Find news feed elements using caching & AI model query fallback
  const validateNewsSourcesBatch = async (rawIndices: number[]) => {
    // Only hit pending items: filter out successes!
    const indicesToRun = rawIndices.filter(
      (idx) => state.rows[idx] && state.rows[idx].newsStatus !== "success"
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
      const updatedRows = prev.rows.map((r) =>
        indicesToRun.includes(r.index) ? { ...r, newsStatus: "processing" as const } : r
      );
      return { ...prev, rows: updatedRows };
    });

    const isSourcesMode = state.appMode === "sources";

    try {
      const BATCH_SIZE = 5;
      for (let b = 0; b < indicesToRun.length; b += BATCH_SIZE) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const chunkIndices = indicesToRun.slice(b, b + BATCH_SIZE);
        const chunkRows = chunkIndices.map((idx) => state.rows[idx]);
        const chunkDomains = chunkRows.map((r) => r.domain);

        let finalNewsMap: Record<string, any> = {};

        if (isSourcesMode) {
          // --- 1. Feed / Source level mode with source_cache ---
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
            finalNewsMap[state.rows[index].domain.toLowerCase().trim()] = {
              country: data.country,
              language: data.language,
              newsCategory: data.category || data.newsCategory,
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
              body: JSON.stringify({ sources: missSources }),
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
                newsCategory: item.category,
                newsStatus: "success" as const
              };
            });
          }

        } else {
          // --- 2. Domain level feed discovery with news_feed_cache ---
          const cachedFeeds = await getCachedNewsFeeds(chunkDomains);
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const hitRows: { index: number; data: any }[] = [];
          const missIndices: number[] = [];
          const missDomains: string[] = [];

          chunkRows.forEach((row) => {
            const cleanDom = row.domain.toLowerCase().trim();
            if (cachedFeeds[cleanDom]) {
              hitRows.push({ index: row.index, data: cachedFeeds[cleanDom] });
            } else {
              missIndices.push(row.index);
              missDomains.push(row.domain);
            }
          });

          // Add hits to final map
          hitRows.forEach(({ index, data }) => {
            finalNewsMap[state.rows[index].domain.toLowerCase().trim()] = {
              country: data.country,
              language: data.language,
              rssUrl: data.rssUrl,
              sitemapUrl: data.sitemapUrl,
              newsCategory: data.newsCategory,
              newsStatus: "success" as const,
              isNewsPublisher: "Yes" as const,
              isCacheHit: true
            };
          });

          // Evaluate misses with API
          if (missDomains.length > 0) {
            if (signal.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            const res = await fetch("/api/validate-news-source", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ domains: missDomains }),
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
              throw new Error(data.error || "News feed discovery request failed.");
            }

            const freshResults = data.results as any[];

            // Cache fresh news feeds
            await setCachedNewsFeeds(freshResults);

            freshResults.forEach((item) => {
              finalNewsMap[String(item.domain).toLowerCase().trim()] = {
                country: item.country,
                language: item.language,
                rssUrl: item.rssUrl,
                sitemapUrl: item.sitemapUrl,
                newsCategory: item.newsCategory,
                newsStatus: "success" as const,
                isNewsPublisher: "Yes" as const
              };
            });
          }
        }

        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        // Update React State with final results incrementally
        setState((prev) => {
          const updatedRows = prev.rows.map((row) => {
            if (!chunkIndices.includes(row.index)) return row;

            const match = finalNewsMap[row.domain.toLowerCase().trim()];
            if (match) {
              return {
                ...row,
                country: match.country,
                language: match.language,
                rssUrl: match.rssUrl || row.rssUrl,
                sitemapUrl: match.sitemapUrl || row.sitemapUrl,
                newsCategory: match.newsCategory,
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

          // Save run history log incrementally
          const processedResults = updatedRows.filter((r) => chunkIndices.includes(r.index));
          saveRunHistory(
            firebaseUser?.uid || "offline_sandbox_bypass_user",
            firebaseUser?.email || "Guest Sandbox Developer",
            prev.config.spreadsheetId ? `Google Sheet: ${prev.config.spreadsheetId.slice(0, 8)}` : "Uploaded Feed List",
            isSourcesMode ? "sources" : "domains",
            processedResults
          );

          return { ...prev, rows: updatedRows };
        });

        // Small yield to balance network loads
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      setIsAnalyzingNews(false);

    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        console.log("Sources analysis aborted by user.");
        setState((prev) => {
          const updatedRows = prev.rows.map((r) =>
            indicesToRun.includes(r.index) && r.newsStatus === "processing"
              ? { ...r, newsStatus: "pending" as const }
              : r
          );
          return { ...prev, rows: updatedRows };
        });
        setIsAnalyzingNews(false);
        return;
      }

      const isLimit = err.message?.startsWith("API_LIMIT_REACHED");
      if (isLimit) {
        setState((prev) => {
          const updatedRows = prev.rows.map((r) =>
            indicesToRun.includes(r.index) && r.newsStatus === "processing"
              ? { ...r, newsStatus: "pending" as const }
              : r
          );
          return { ...prev, rows: updatedRows };
        });
        setIsAnalyzingNews(false);
        return;
      }

      console.error(err);
      setState((prev) => {
        const updatedRows = prev.rows.map((r) =>
          indicesToRun.includes(r.index) && r.newsStatus === "processing"
            ? { ...r, newsStatus: "error" as const, newsErrorMsg: err.message || "Feed cached discovery failed" }
            : r
        );
        return { ...prev, rows: updatedRows };
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
      const updatedRows = prev.rows.map((row) => {
        const rawValue = String(row.originalValues[prev.domainColumnIndex] || "").trim();
        let cleanDomain = rawValue;
        if (mode === "domains") {
          cleanDomain = rawValue
            .toLowerCase()
            .replace(/^(https?:\/\/)?(www\.)?/, "")
            .split("/")[0]
            .split("?")[0];
        } else {
          cleanDomain = rawValue.replace(/^(https?:\/\/)?(www\.)?/, "");
        }
        return {
          ...row,
          domain: cleanDomain,
        };
      });

      return {
        ...prev,
        appMode: mode,
        rows: updatedRows,
        filterCategory: "",
        filterNews: "",
        searchTerm: "",
      };
    });
  };

  const handleValidateNewsSelected = (indices: number[]) => {
    validateNewsSourcesBatch(indices);
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

    // Force reset any active spinners and return "processing" rows to "pending"
    setIsAnalyzingNews(false);
    setState((prev) => {
      const sanitizedRows = prev.rows.map((r) => ({
        ...r,
        status: r.status === "processing" ? "pending" : r.status,
        newsStatus: r.newsStatus === "processing" ? "pending" : r.newsStatus,
      }));
      return {
        ...prev,
        isClassifying: false,
        rows: sanitizedRows,
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
    localStorage.removeItem("publisher_cache_newsfeeds");

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
    localStorage.removeItem("publisher_cache_newsfeeds");

    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => ({
        ...row,
        category: undefined,
        isNewsPublisher: undefined,
        reasoning: undefined,
        status: "pending",
        errorMsg: undefined,
        country: undefined,
        language: undefined,
        rssUrl: undefined,
        sitemapUrl: undefined,
        newsCategory: undefined,
        newsStatus: "pending",
        newsErrorMsg: undefined,
      })),
    }));
    addToast("Wiped all cached classifications of the current dataset!", "info");
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
  };

  // export results back to the Google Sheet (via Google spreadsheets update API)
  const handleExportToGoogleSheet = async () => {
    setSheetDebugLogs([]); // Clear previous logs
    const addLog = (message: string) => {
      const ts = new Date().toLocaleTimeString();
      setSheetDebugLogs((prev) => [...prev, `[${ts}] ${message}`]);
      console.log(`[Google Sheet Sync Log] ${message}`);
    };

    addLog("Starting Google Sheets export process (User clicked Save back to Sheets)...");

    addLog("Starting Google Sheets export process...");
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
      // We read the first row
      const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.config.spreadsheetId}/values/${encodeURIComponent(
        `${escapedSheetName}!A1:Z1`
      )}`;
      addLog(`Fetching existing spreadsheet column headers from range: ${headerUrl}`);
      
      const readHeadersRes = await fetch(headerUrl, {
        headers: { Authorization: `Bearer ${state.googleAccessToken}` },
      });

      addLog(`Column headers read API response code: ${readHeadersRes.status}`);

      if (!readHeadersRes.ok) {
        const headerErrBody = await readHeadersRes.text();
        addLog(`Headers API failure: "${headerErrBody}"`);
        throw new Error(`Could not read current spreadsheet header values. Tab lookup or Sheet permissions might be restricted.`);
      }

      const readHeadersData = await readHeadersRes.json();
      const currentHeaders: string[] = readHeadersData.values?.[0] || [];
      addLog(`Spreadsheet headers read successfully. Found ${currentHeaders.length} existing columns: "${currentHeaders.join('", "')}"`);

      // Find indices for target columns if they exist
      let catIdx = currentHeaders.findIndex((h) => h.toLowerCase() === "category" || h.toLowerCase() === "news category" || h.toLowerCase() === "sub-category");
      let newsIdx = currentHeaders.findIndex((h) => h.toLowerCase() === "news publisher");
      let reasonIdx = currentHeaders.findIndex((h) => h.toLowerCase() === "reasoning" || h.toLowerCase() === "ai description / reasoning" || h.toLowerCase() === "ai domain description");
      let countryIdx = currentHeaders.findIndex((h) => h.toLowerCase() === "country");
      let langIdx = currentHeaders.findIndex((h) => h.toLowerCase() === "language" || h.toLowerCase() === "lang");

      addLog(`Detected Target Columns indices (0-indexed):`);
      addLog(` - Category / Sub-Category Column Index: ${catIdx !== -1 ? catIdx : "NOT FOUND (Will append)"}`);
      addLog(` - News Publisher Column Index: ${newsIdx !== -1 ? newsIdx : "NOT FOUND (Will append)"}`);
      addLog(` - AI Description / Reasoning Column Index: ${reasonIdx !== -1 ? reasonIdx : "NOT FOUND (Will append)"}`);
      addLog(` - Country Column Index: ${countryIdx !== -1 ? countryIdx : "NOT FOUND (Will append)"}`);
      addLog(` - Language Column Index: ${langIdx !== -1 ? langIdx : "NOT FOUND (Will append)"}`);

      const totalOriginalCols = currentHeaders.length;
      const maxRows = state.rows.length + 1; // including header
      const dataMatrix: string[][] = Array.from({ length: maxRows }, () => []);

      let writeRange = "";

      if (catIdx !== -1 || newsIdx !== -1 || reasonIdx !== -1 || countryIdx !== -1 || langIdx !== -1) {
        addLog("CASE detected: At least one target column already exists. Writing directly to specific pre-defined columns standard offset rules.");
        const writeCols = [
          { name: "Category", curIdx: catIdx, fallbackOffset: 0, valFn: (r: DomainRow) => r.newsCategory || r.category || "" },
          { name: "News Publisher", curIdx: newsIdx, fallbackOffset: 1, valFn: (r: DomainRow) => r.isNewsPublisher || "" },
          { name: "AI Domain Description", curIdx: reasonIdx, fallbackOffset: 2, valFn: (r: DomainRow) => r.reasoning || "" },
          { name: "Country", curIdx: countryIdx, fallbackOffset: 3, valFn: (r: DomainRow) => r.country || "" },
          { name: "Language", curIdx: langIdx, fallbackOffset: 4, valFn: (r: DomainRow) => r.language || "" },
        ];

        const mappedCols = writeCols.map((col) => {
          const finalIndex = col.curIdx !== -1 ? col.curIdx : totalOriginalCols + col.fallbackOffset;
          return { ...col, finalIndex };
        });

        const minCol = Math.min(...mappedCols.map((c) => c.finalIndex));
        const maxCol = Math.max(...mappedCols.map((c) => c.finalIndex));

        const startLetter = getColumnLetter(minCol + 1);
        const endLetter = getColumnLetter(maxCol + 1);
        writeRange = `${escapedSheetName}!${startLetter}1:${endLetter}${maxRows}`;
        addLog(`Calculated target update range span: "${writeRange}" (Columns ${startLetter} through ${endLetter})`);

        // Populate Headers
        mappedCols.forEach((col) => {
          dataMatrix[0][col.finalIndex - minCol] = col.name;
        });

        // Populate Rows
        let countWritten = 0;
        for (let r = 0; r < state.rows.length; r++) {
          const rowObj = state.rows[r];
          mappedCols.forEach((col) => {
            dataMatrix[r + 1][col.finalIndex - minCol] = col.valFn(rowObj);
          });
          countWritten++;
        }
        addLog(`Prepared write matrix cells for ${countWritten} records.`);
      } else {
        addLog("CASE detected: None of the target columns exist. Appending 5 brand-new columns to the end of your original sheet...");
        const columnsToAppend = [
          "Category", 
          "News Publisher", 
          "AI Domain Description",
          "Country",
          "Language"
        ];
        const startLetter = getColumnLetter(totalOriginalCols + 1);
        const endLetter = getColumnLetter(totalOriginalCols + columnsToAppend.length);
        writeRange = `${escapedSheetName}!${startLetter}1:${endLetter}${maxRows}`;
        addLog(`Calculated target append range span: "${writeRange}" (Columns ${startLetter} through ${endLetter})`);

        // Header
        dataMatrix[0] = columnsToAppend;

        // Body rows matching
        let countAppended = 0;
        for (let r = 0; r < state.rows.length; r++) {
          const rowObj = state.rows[r];
          dataMatrix[r + 1] = [
            rowObj.newsCategory || rowObj.category || "", 
            rowObj.isNewsPublisher || "", 
            rowObj.reasoning || "",
            rowObj.country || "",
            rowObj.language || ""
          ];
          countAppended++;
        }
        addLog(`Prepared append matrix for ${countAppended} records under 5 new headers.`);
      }

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
    // Header
    const modifiedHeaders = [
      ...state.headers, 
      "Category", 
      "News Publisher", 
      "AI Domain Description",
      "Country",
      "Language"
    ];
    csvContent += modifiedHeaders.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

    // Rows
    for (const row of state.rows) {
      const originalParts = row.originalValues.map((v) => `"${v.replace(/"/g, '""')}"`);
      const resultsParts = [
        `"${(row.newsCategory || row.category || "").replace(/"/g, '""')}"`,
        `"${(row.isNewsPublisher || "").replace(/"/g, '""')}"`,
        `"${(row.reasoning || "").replace(/"/g, '""')}"`,
        `"${(row.country || "").replace(/"/g, '""')}"`,
        `"${(row.language || "").replace(/"/g, '""')}"`,
      ];
      csvContent += [...originalParts, ...resultsParts].join(",") + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `classified_domains_${state.config.spreadsheetId.slice(0, 6)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const classifiedCount = state.rows.filter((r) => r.status === "success").length;
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
                  <button
                    onClick={() => {
                      setShowTokenInputModal(true);
                    }}
                    className="px-2.5 py-1 text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
                  >
                    Authenticate / Paste Token
                  </button>
                  <button
                    onClick={() => {
                      fetchSpreadsheet(state.config.spreadsheetId, state.config.gid);
                    }}
                    className="px-2.5 py-1 text-[10px] font-semibold border border-amber-300 text-amber-800 rounded bg-white hover:bg-amber-100 transition-colors"
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
              {state.isClassifying || isAnalyzingNews ? (
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
                disabled={isUpdatingSheet || classifiedCount === 0}
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
