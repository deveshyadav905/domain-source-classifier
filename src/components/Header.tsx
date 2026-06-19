import { useState } from "react";
import { Globe, FileSpreadsheet, Sparkles, Check, Database, HelpCircle, LogOut, History, User } from "lucide-react";

interface HeaderProps {
  sheetUrlInput: string;
  setSheetUrlInput: (url: string) => void;
  onFetchSpreadsheet: () => void;
  isFetchingSheet: boolean;
  googleAccessToken: string | null;
  googleUserEmail: string | null;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  activeTab: "database" | "analytics" | "instructions" | "history";
  setActiveTab: (tab: "database" | "analytics" | "instructions" | "history") => void;
  appMode: "domains" | "sources";
  setAppMode: (mode: "domains" | "sources") => void;
  countClassified: number;
  countTotal: number;
  firebaseUser: any | null;
  onSignOutFirebase: () => void;
  onResetSession: () => void;
}

export default function Header({
  sheetUrlInput,
  setSheetUrlInput,
  onFetchSpreadsheet,
  isFetchingSheet,
  googleAccessToken,
  googleUserEmail,
  onConnectGoogle,
  onDisconnectGoogle,
  activeTab,
  setActiveTab,
  appMode,
  setAppMode,
  countClassified,
  countTotal,
  firebaseUser,
  onSignOutFirebase,
  onResetSession,
}: HeaderProps) {
  const [urlError, setUrlError] = useState("");

  const handleLoadClick = () => {
    setUrlError("");
    if (!sheetUrlInput) {
      setUrlError("Please enter a Google Sheets link.");
      return;
    }
    // Simple verification check to see if it is a real google spreadsheet
    if (!sheetUrlInput.includes("docs.google.com/spreadsheets")) {
      setUrlError("URL must be a valid Google Sheets URL (containing docs.google.com/spreadsheets).");
      return;
    }
    onFetchSpreadsheet();
  };

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
      {/* Upper bar: brand name & Authentication controls */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo block */}
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-100">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-display font-bold text-gray-900 tracking-tight flex items-center gap-1.5 leading-tight">
              Domain Classifier
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 uppercase font-semibold">Gemini 3.5</span>
            </h1>
            <p className="text-[10px] text-gray-500 font-sans mt-0.5">Automated batch categories &amp; news status generator</p>
          </div>
        </div>

        {/* Integration indicators (Google Account Connection & Firebase account status) */}
        <div className="flex items-center gap-3">
          {/* Firebase user account status */}
          {firebaseUser && (
            <div className="flex items-center gap-2 bg-indigo-50/70 border border-indigo-100 px-3 py-1.5 rounded-xl">
              <User className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <div className="text-left">
                <p className="text-[9px] font-bold text-indigo-900 leading-tight uppercase tracking-wide">Workspace User</p>
                <p className="text-[10px] text-indigo-700 font-semibold truncate max-w-[140px]" title={firebaseUser.email || "Guest Developer"}>
                  {firebaseUser.email || "Guest Developer"}
                </p>
              </div>
              <button
                onClick={onSignOutFirebase}
                title="Sign Out Workspace"
                className="text-indigo-400 hover:text-indigo-750 ml-1 p-0.5 cursor-pointer transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {googleAccessToken ? (
            <div className="flex items-center gap-2 bg-emerald-50/75 border border-emerald-100 px-3 py-1.5 rounded-xl">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <div className="text-left">
                <p className="text-[9px] font-bold text-emerald-900 leading-tight uppercase tracking-wide">Google Sheets</p>
                <p className="text-[10px] text-emerald-700 font-semibold truncate max-w-[130px]">{googleUserEmail || "Active"}</p>
              </div>
              <button
                onClick={onDisconnectGoogle}
                title="Disconnect Google Docs"
                className="text-emerald-400 hover:text-emerald-750 ml-1 p-0.5 cursor-pointer transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onConnectGoogle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-xs text-gray-700 hover:bg-gray-50 transition-colors font-semibold cursor-pointer shadow-2xs"
            >
              <div className="h-2 w-2 rounded-full bg-gray-300" />
              <span>Connect Google Sheets</span>
            </button>
          )}
        </div>
      </div>

      {/* Main control panel: pasting and searching spreadsheet URL */}
      <div className="bg-gray-50/75 py-4 border-t border-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-end md:items-center justify-between">
            {/* Link input bar */}
            <div className="flex-1 w-full space-y-1">
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Paste your Google Sheet link</label>
              <div className="flex gap-2">
                <div className="relative flex-grow">
                  <FileSpreadsheet className="absolute left-3.5 top-3 h-4.5 w-4.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="e.g. https://docs.google.com/spreadsheets/d/1MBAlFt-YPa8NMsmyrPqGMOkJ5ukjLgODufd6bh4Hwik/edit#gid=0"
                    value={sheetUrlInput}
                    onChange={(e) => {
                      setSheetUrlInput(e.target.value);
                      setUrlError("");
                    }}
                    className="pl-10 pr-4 py-2 w-full text-xs rounded-xl border border-gray-300 focus:border-indigo-500 focus:outline-hidden bg-white shadow-xs font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleLoadClick}
                  disabled={isFetchingSheet}
                  className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-gray-850 disabled:opacity-50 transition-colors shrink-0"
                >
                  {isFetchingSheet ? "Loading..." : "Load Spreadsheet"}
                </button>
                <button
                  type="button"
                  onClick={onResetSession}
                  className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-750 border border-rose-200 rounded-xl text-[11px] font-bold transition-all shrink-0 uppercase tracking-wider cursor-pointer"
                  title="Wipe current worksheet data from device memory and load defaults"
                >
                  Clear Session
                </button>
              </div>
              {urlError && <p className="text-[11px] text-red-500">{urlError}</p>}
              
              <div className="pt-2 flex flex-col sm:flex-row gap-2.5 items-center">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Operational Process:</span>
                <div className="bg-gray-200/60 p-0.5 rounded-lg inline-flex border border-gray-200 gap-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAppMode("domains")}
                    className={`px-3 py-1 rounded-md text-[10.5px] font-bold transition-all cursor-pointer ${
                      appMode === "domains"
                        ? "bg-white text-indigo-700 shadow-xs"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    1. Domain Classification
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppMode("sources")}
                    className={`px-3 py-1 rounded-md text-[10.5px] font-bold transition-all cursor-pointer ${
                      appMode === "sources"
                        ? "bg-white text-rose-700 shadow-xs"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    2. Source level Classifier (Direct Feed)
                  </button>
                </div>
                <span className="text-[10px] text-gray-400 italic">
                  {appMode === "domains" 
                    ? "Classifies whether domain URL is news publisher and detects general category" 
                    : "Directly validates specified RSS/Feed URLs for country, language, & fine-grained category"}
                </span>
              </div>
            </div>

            {/* Navigation tabs */}
            <div className="flex border-b border-gray-200 mt-2 md:mt-0 shrink-0 w-full md:w-auto self-start md:self-auto gap-1">
              <button
                onClick={() => setActiveTab("database")}
                className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                  activeTab === "database"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                <Database className="h-3.5 w-3.5" />
                Domains Database
                {countTotal > 0 && (
                  <span className="text-[10px] font-mono bg-indigo-50 px-1.5 py-0.5 rounded-full text-indigo-700 font-bold">
                    {countClassified}/{countTotal}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                  activeTab === "analytics"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
                Analytics Dashboard
              </button>

              <button
                onClick={() => setActiveTab("history")}
                className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                  activeTab === "history"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                <History className="h-3.5 w-3.5 text-rose-500" />
                Saved History &amp; Cache Logs
              </button>

              <button
                onClick={() => setActiveTab("instructions")}
                className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                  activeTab === "instructions"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                <HelpCircle className="h-3.5 w-3.5 text-gray-400" />
                Guides &amp; Configuration
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
