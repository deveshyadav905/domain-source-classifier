import { useState } from "react";
import { DomainRow } from "../types";
import { Search, SlidersHorizontal, Loader2, Sparkles, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Check, Globe, Rss, MapPin, Languages, Trash2, Database } from "lucide-react";

interface DomainTableProps {
  rows: DomainRow[];
  isClassifying: boolean;
  onClassifySelected: (selectedIndices: number[]) => void;
  onClassifyRemaining: () => void;
  filterCategory: string;
  setFilterCategory: (val: string) => void;
  filterNews: string;
  setFilterNews: (val: string) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  isAnalyzingNews: boolean;
  onValidateNewsSelected: (selectedIndices: number[]) => void;
  appMode: "domains" | "sources";
  onStopAllProcesses: () => void;
  onClearCurrentResults: () => void;
  onWipeDatabaseCache?: () => void;
  isFetchingTranco?: boolean;
  onFetchTrancoRanks?: (selectedIndices: number[]) => void;
  isCheckingNewsPublisher?: boolean;
  onCheckNewsPublisherSelected?: (indices: number[]) => void;
  onCheckNewsPublisherRemaining?: () => void;
}

export default function DomainTable({
  rows,
  isClassifying,
  onClassifySelected,
  onClassifyRemaining,
  filterCategory,
  setFilterCategory,
  filterNews,
  setFilterNews,
  searchTerm,
  setSearchTerm,
  isAnalyzingNews,
  onValidateNewsSelected,
  appMode,
  onStopAllProcesses,
  onClearCurrentResults,
  onWipeDatabaseCache,
  isFetchingTranco = false,
  onFetchTrancoRanks,
  isCheckingNewsPublisher = false,
  onCheckNewsPublisherSelected,
  onCheckNewsPublisherRemaining,
}: DomainTableProps) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Multi-select helpers
  const handleToggleRow = (index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleSelectAllOnPage = (pageRows: DomainRow[]) => {
    const pageIndices = pageRows.map((r) => r.index);
    const allSelected = pageIndices.every((idx) => selectedIndices.includes(idx));

    if (allSelected) {
      setSelectedIndices((prev) => prev.filter((idx) => !pageIndices.includes(idx)));
    } else {
      setSelectedIndices((prev) => {
        const union = new Set([...prev, ...pageIndices]);
        return Array.from(union);
      });
    }
  };

  // Filter calculation depending on mode
  const filteredRows = rows.filter((r) => {
    const matchesSearch = r.domain.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (r.reasoning?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                          (r.country?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                          (r.language?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                          (r.newsCategory?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);

    if (appMode === "domains") {
      const matchesCategory = !filterCategory || r.category === filterCategory;
      const matchesNews = !filterNews || r.isNewsPublisher === filterNews;
      return matchesSearch && matchesCategory && matchesNews;
    } else {
      // In sources/feed mode, filterCategory matches row's newsCategory, filterNews matches target country/lang
      const matchesNewsCategory = !filterCategory || 
                                  (r.newsCategory && 
                                   r.newsCategory.split(",").map((c) => c.trim().toLowerCase()).includes(filterCategory.toLowerCase()));
      const matchesCountryOrLang = !filterNews || 
                                   (r.country?.toLowerCase() === filterNews.toLowerCase()) ||
                                   (r.language?.toLowerCase() === filterNews.toLowerCase());
      return matchesSearch && matchesNewsCategory && matchesCountryOrLang;
    }
  });

  // Pagination calculation
  const totalItems = filteredRows.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + itemsPerPage);

  // Status Badge styles helper
  const getStatusBadge = (status: DomainRow["status"] | DomainRow["newsStatus"], errMsg?: string) => {
    const currentStatus = status || "pending";
    switch (currentStatus) {
      case "pending":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
            Pending
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 pb-1">
            <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
            Analyzing
          </span>
        );
      case "success":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
            Success
          </span>
        );
      case "error":
        return (
          <span
            title={errMsg || "Classification error"}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100 cursor-help"
          >
            <AlertCircle className="h-3 w-3 text-red-500" />
            Failed
          </span>
        );
    }
  };

  const getCategoryBadge = (cat?: DomainRow["category"]) => {
    if (!cat) return <span className="text-gray-400 text-xs">-</span>;
    switch (cat) {
      case "e-commerce":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-800 font-mono">
            e-commerce
          </span>
        );
      case "technology":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-cyan-50 text-cyan-800 font-mono">
            technology
          </span>
        );
      case "blogs":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800 font-mono">
            blogs
          </span>
        );
      case "other":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-gray-50 text-gray-600 font-mono">
            other
          </span>
        );
    }
  };

  const getNewsBadge = (isNews?: DomainRow["isNewsPublisher"], status?: string) => {
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50/60 px-2 py-0.5 rounded-md animate-pulse border border-amber-100">
          <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
          Checking...
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50/60 px-2 py-0.5 rounded-md border border-red-100" title="News check failed">
          <AlertCircle className="h-3 w-3 text-red-500" />
          Error
        </span>
      );
    }
    if (!isNews) return <span className="text-gray-400 text-xs italic">pending check</span>;
    return isNews === "Yes" ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
        Yes (News)
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-50 text-slate-600 border border-slate-100">
        No
      </span>
    );
  };

  const getTrancoBadge = (rank: number | null | undefined, date: string | undefined, status: string | undefined) => {
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 bg-indigo-50/60 px-2 py-1 rounded-md animate-pulse border border-indigo-100">
          <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
          Fetching...
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200" title={date}>
          <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
          {date || "Error"}
        </span>
      );
    }
    if (rank !== undefined && rank !== null) {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
            Rank: #{rank.toLocaleString()}
          </span>
          {date && <span className="text-[9px] text-gray-400 font-mono tracking-tight leading-none">As of: {date}</span>}
        </div>
      );
    }
    return (
      <span className="text-gray-400 font-mono text-[10px]" title={date}>
        {date === "not ranked" ? "Not Ranked" : "-"}
      </span>
    );
  };

  const pageIndices = paginatedRows.map((r) => r.index);
  const isAllSelectedOnPage = pageIndices.length > 0 && pageIndices.every((idx) => selectedIndices.includes(idx));

  const countPending = appMode === "domains" 
    ? rows.filter((r) => r.status === "pending").length
    : rows.filter((r) => !r.country && !r.language).length;

  const countClassified = rows.filter((r) => r.status === "success").length;
  const countTrancoSuccess = rows.filter((r) => r.trancoStatus === "success").length;
  const countTrancoTotal = rows.length;
  const countTotal = rows.length;

  const countNewsChecked = rows.filter((r) => r.newsPublisherStatus === "success").length;
  const countNewsPending = rows.filter((r) => r.newsPublisherStatus !== "success").length;
  const failedNewsPublisherCount = rows.filter((r) => r.newsPublisherStatus === "error").length;

  const failedClassifiedCount = rows.filter((r) => r.status === "error").length;
  const failedTrancoCount = rows.filter((r) => r.trancoStatus === "error").length;
  const failedNewsCount = rows.filter((r) => r.newsStatus === "error").length;
  const countNewsPendingOnly = rows.filter((r) => !r.country && !r.language && r.newsStatus !== "error" && r.newsStatus !== "processing").length;


  // Extract unique news categories from source rows dynamically for filtering
  const uniqueNewsCategories = Array.from(
    new Set(
      rows
        .flatMap((r) => r.newsCategory ? r.newsCategory.split(",").map((c) => c.trim()) : [])
        .filter(Boolean)
    )
  ) as string[];

  // Extract unique countries / languages for feed filter
  const uniqueLocations = Array.from(
    new Set([
      ...rows.map((r) => r.country).filter(Boolean),
      ...rows.map((r) => r.language).filter(Boolean)
    ])
  ) as string[];

  return (
    <div className="space-y-4">
      {/* 1. Search and Filters Card */}
      <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-xs space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={appMode === "domains" ? "Search domain URLs or reasoning..." : "Search source URLs, country, category, language..."}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 pr-4 py-2 w-full text-xs rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 focus:outline-hidden bg-gray-50/55 font-sans"
            />
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap gap-2 text-xs items-center text-gray-600">
            <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400 mr-1 uppercase tracking-wide">
              <SlidersHorizontal className="h-3 w-3" /> Filters:
            </span>

            {appMode === "domains" ? (
              <>
                {/* Category SELECT */}
                <select
                  value={filterCategory}
                  onChange={(e) => {
                    setFilterCategory(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white text-gray-700 focus:outline-hidden cursor-pointer"
                >
                  <option value="">All Categories</option>
                  <option value="e-commerce">E-Commerce</option>
                  <option value="technology">Technology</option>
                  <option value="blogs">Blogs</option>
                  <option value="other">Other</option>
                </select>

                {/* News Publisher SELECT */}
                <select
                  value={filterNews}
                  onChange={(e) => {
                    setFilterNews(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white text-gray-700 focus:outline-hidden cursor-pointer"
                >
                  <option value="">All News Status</option>
                  <option value="Yes">Yes (News Publisher)</option>
                  <option value="No">No (Standard Site)</option>
                </select>
              </>
            ) : (
              <>
                {/* Fine-grained News Category Filter */}
                <select
                  value={filterCategory}
                  onChange={(e) => {
                    setFilterCategory(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] bg-white text-gray-700 focus:outline-hidden cursor-pointer"
                >
                  <option value="">All News Topics / Categories</option>
                  {uniqueNewsCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="Politics">Politics</option>
                  <option value="General News">General News</option>
                  <option value="Financial & Business">Financial &amp; Business</option>
                  <option value="Technology Journalism">Technology Journalism</option>
                </select>

                {/* Country / Language Filter */}
                <select
                  value={filterNews}
                  onChange={(e) => {
                    setFilterNews(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] bg-white text-gray-700 focus:outline-hidden cursor-pointer"
                >
                  <option value="">All Country / Languages</option>
                  {uniqueLocations.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                  <option value="United States">United States</option>
                  <option value="Global">Global</option>
                  <option value="English">English</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </>
            )}

            {/* Reset Filter Button */}
            {(filterCategory || filterNews || searchTerm) && (
              <button
                onClick={() => {
                  setFilterCategory("");
                  setFilterNews("");
                  setSearchTerm("");
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 border border-gray-200 hover:bg-gray-50 text-[11px] font-medium rounded-lg text-gray-500 whitespace-nowrap cursor-pointer transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Action Controls Toolbar */}
      <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-xs flex flex-col gap-3 text-xs">
        {/* Info Note about token savings */}
        <div className="flex items-center gap-2 text-[11px] text-gray-500 bg-amber-50/50 border border-amber-100/60 p-2.5 rounded-xl">
          <span className="font-bold text-amber-700 font-mono bg-amber-100 px-1.5 py-0.5 rounded uppercase text-[9px]">Token Saver</span>
          <p>
            Optimize your costs! First run <strong>Check News Publisher (Yes/No)</strong> to classify your list. Then, running <strong>AI META</strong> will automatically skip all non-news domains, saving you massive Gemini API tokens.
          </p>
        </div>

        {/* Left Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {appMode === "domains" ? (
            <>
              {/* Feature 0 Button: News Publisher Check */}
              <div className="flex items-center gap-2.5 bg-amber-50/40 p-1 px-2 rounded-xl border border-amber-200/50">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700 bg-amber-100/80 p-0.5 px-1.5 rounded flex items-center gap-1.5" title="Checks if domain is a news publisher (Yes/No)">
                  <span>NEWS CHECK</span>
                  <span className="text-[9px] font-mono bg-white px-1.5 py-0.2 rounded-full text-amber-800 font-bold border border-amber-100 animate-pulse">
                    {countNewsChecked}/{countTotal}
                  </span>
                </span>
                {selectedIndices.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        if (onCheckNewsPublisherSelected) {
                          onCheckNewsPublisherSelected(selectedIndices);
                          setSelectedIndices([]);
                        }
                      }}
                      disabled={isCheckingNewsPublisher}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                      title="Run News Publisher status check for chosen rows"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-200" />
                      Check News Status ({selectedIndices.length})
                    </button>
                    {isCheckingNewsPublisher && (
                      <button
                        onClick={onStopAllProcesses}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-2xs cursor-pointer animate-pulse"
                        title="Stop check news publisher process"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-white block animate-ping mr-1"></span>
                        Stop News Check
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={onCheckNewsPublisherRemaining}
                      disabled={isCheckingNewsPublisher || countNewsPending === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                      title="Run News Publisher status check for all remaining rows"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isCheckingNewsPublisher ? "animate-spin" : ""}`} />
                      Check News Publisher (Yes/No) ({countNewsPending})
                    </button>
                    {isCheckingNewsPublisher && (
                      <button
                        onClick={onStopAllProcesses}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-2xs cursor-pointer animate-pulse"
                        title="Stop check news publisher process"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-white block animate-ping mr-1"></span>
                        Stop News Check
                      </button>
                    )}
                    {failedNewsPublisherCount > 0 && !isCheckingNewsPublisher && (
                      <button
                        onClick={() => {
                          const failed = rows.filter((r) => r.newsPublisherStatus === "error").map((r) => r.index);
                          if (onCheckNewsPublisherSelected) {
                            onCheckNewsPublisherSelected(failed);
                          }
                        }}
                        disabled={isCheckingNewsPublisher}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-red-600 text-white rounded-lg text-[11px] font-bold hover:bg-red-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Retry only the failed news checks"
                      >
                        <AlertCircle className="h-3.5 w-3.5 text-red-200" />
                        Retry Failed ({failedNewsPublisherCount})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Feature 1 Button: Classify Domains */}
              <div className="flex items-center gap-2.5 bg-indigo-50/40 p-1 px-2 rounded-xl border border-indigo-200/50">
                <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-700 bg-indigo-100/80 p-0.5 px-1.5 rounded flex items-center gap-1.5" title="Fetches site name, display name, domain description, and category via Gemini AI">
                  <span>AI META</span>
                  <span className="text-[9px] font-mono bg-white px-1.5 py-0.2 rounded-full text-indigo-800 font-bold border border-indigo-100 animate-pulse">
                    {countClassified}/{countTotal}
                  </span>
                </span>
                {selectedIndices.length > 0 ? (
                  <button
                    onClick={() => {
                      onClassifySelected(selectedIndices);
                      setSelectedIndices([]);
                    }}
                    disabled={isClassifying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                    title="Retrieve site brand metadata (name, description, category) via Gemini AI for chosen rows"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                    Fetch Details for Selected ({selectedIndices.length})
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={onClassifyRemaining}
                      disabled={isClassifying || countPending === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                      title="Retrieve site brand metadata via Gemini AI for pending rows (auto-skips non-news)"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isClassifying ? "animate-spin" : ""}`} />
                      Fetch Domain Metadata (Auto-skip non-news) ({countPending})
                    </button>
                    {failedClassifiedCount > 0 && (
                      <button
                        onClick={() => {
                          const failed = rows.filter((r) => r.status === "error").map((r) => r.index);
                          onClassifySelected(failed);
                        }}
                        disabled={isClassifying}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Retry only the failed domain classifications"
                      >
                        <AlertCircle className="h-3.5 w-3.5 text-amber-200" />
                        Retry Failed ({failedClassifiedCount})
                      </button>
                    )}
                  </div>
                )}
              </div>
 
              {/* Feature 2 Button: Fetch Priorities */}
              {onFetchTrancoRanks && (
                <div className="flex items-center gap-2.5 bg-emerald-50/40 p-1 px-2 rounded-xl border border-emerald-200/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 bg-emerald-100/80 p-0.5 px-1.5 rounded flex items-center gap-1.5" title="Queries standard Traffic Rank from Tranco API to deduce priorities">
                    <span>TRANCO RANK</span>
                    <span className="text-[9px] font-mono bg-white px-1.5 py-0.2 rounded-full text-emerald-800 font-bold border border-emerald-100">
                      {countTrancoSuccess}/{countTrancoTotal}
                    </span>
                  </span>
                  {selectedIndices.length > 0 ? (
                    <button
                      onClick={() => {
                        onFetchTrancoRanks(selectedIndices);
                        setSelectedIndices([]);
                      }}
                      disabled={isFetchingTranco}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-[11px] font-bold hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                      title="Request global internet traffic priority from Tranco API for chosen rows"
                    >
                      <Globe className={`h-3.5 w-3.5 text-teal-200 ${isFetchingTranco ? "animate-spin" : ""}`} />
                      Fetch Priority for Selected ({selectedIndices.length})
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onFetchTrancoRanks(rows.map((r) => r.index))}
                        disabled={isFetchingTranco || rows.length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-[11px] font-bold hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Request global internet traffic rankings from Tranco API for all domains"
                      >
                        <Globe className={`h-3.5 w-3.5 ${isFetchingTranco ? "animate-spin" : ""}`} />
                        Fetch Priorities (Tranco API)
                      </button>
                      {failedTrancoCount > 0 && (
                        <button
                          onClick={() => {
                            const failed = rows.filter((r) => r.trancoStatus === "error").map((r) => r.index);
                            onFetchTrancoRanks(failed);
                          }}
                          disabled={isFetchingTranco}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                          title="Retry only the failed Tranco rank requests"
                        >
                          <AlertCircle className="h-3.5 w-3.5 text-amber-200" />
                          Retry Failed ({failedTrancoCount})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Simple buttons for target news sources feed classification */
            <div className="flex items-center gap-2.5 bg-rose-50/40 p-1 px-2 rounded-xl border border-rose-200/50">
              {selectedIndices.length > 0 ? (
                <button
                  onClick={() => {
                    onValidateNewsSelected(selectedIndices);
                    setSelectedIndices([]);
                  }}
                  disabled={isAnalyzingNews}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-rose-200" />
                  Classify Selected Sources ({selectedIndices.length})
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {failedNewsCount > 0 ? (
                    <>
                      <button
                        onClick={() => {
                          const items = rows.filter((r) => !r.country && !r.language && r.newsStatus !== "error").map((r) => r.index);
                          if (items.length > 0) {
                            onValidateNewsSelected(items);
                          }
                        }}
                        disabled={isAnalyzingNews || countNewsPendingOnly === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Analyze only the newly added pending feeds that have not failed"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzingNews ? "animate-spin" : ""}`} />
                        Classify Pending ({countNewsPendingOnly})
                      </button>

                      <button
                        onClick={() => {
                          const failed = rows.filter((r) => r.newsStatus === "error").map((r) => r.index);
                          onValidateNewsSelected(failed);
                        }}
                        disabled={isAnalyzingNews || failedNewsCount === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Retry only the failed feed classifications"
                      >
                        <AlertCircle className="h-3.5 w-3.5 text-amber-200" />
                        Retry Failed ({failedNewsCount})
                      </button>

                      <button
                        onClick={() => {
                          const items = rows.filter((r) => !r.country && !r.language).map((r) => r.index);
                          if (items.length > 0) {
                            onValidateNewsSelected(items);
                          }
                        }}
                        disabled={isAnalyzingNews || countPending === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                        title="Retry failed classifications and run all pending feeds together"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                        Retry Failed & Run Pending ({countPending})
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        const items = rows.filter((r) => !r.country && !r.language).map((r) => r.index);
                        if (items.length > 0) {
                          onValidateNewsSelected(items);
                        }
                      }}
                      disabled={isAnalyzingNews || countPending === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                      title="Analyze all pending feeds in the list"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzingNews ? "animate-spin" : ""}`} />
                      Classify All Pending Feeds ({countPending})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Action Control Utilities */}
        <div className="flex items-center gap-1.5">
          {isClassifying || isAnalyzingNews || isFetchingTranco || isCheckingNewsPublisher ? (
            <button
              onClick={onStopAllProcesses}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs cursor-pointer animate-pulse"
              title="Terminate running validation tasks"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white block animate-ping"></span>
              Stop Process
            </button>
          ) : (
            <button
              disabled
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-200 text-gray-400 rounded-lg text-[11px] font-bold cursor-not-allowed"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 block"></span>
              Inactive
            </button>
          )}

          <button
            onClick={onClearCurrentResults}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-rose-200 bg-rose-50/40 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Wipe table cells back to pending status"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Reset State
          </button>

          {onWipeDatabaseCache && (
            <button
              onClick={onWipeDatabaseCache}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-red-200 bg-red-50/45 hover:bg-red-100 text-red-700 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
              title="Completely clear and reset both local and cloud cache database"
            >
              <Database className="h-3.5 w-3.5 text-red-500 animate-pulse" />
              Clean DB Cache
            </button>
          )}
        </div>
      </div>

      {/* Main Table View */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-xs overflow-hidden">
        <div className="bg-gray-50/40 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between text-xs text-gray-500 font-sans flex-wrap gap-2">
          <div className="font-semibold text-gray-700 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Database Entry Inventory ({filteredRows.length} displayed)</span>
            {appMode === "domains" && (
              <>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100/70" title="Metadata correctly classified with Gemini AI">
                  AI Classified: <strong className="font-bold">{countClassified}/{countTotal}</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100/70" title="Domain Traffic ranks correctly fetched with Tranco API">
                  Tranco Rank: <strong className="font-bold">{countTrancoSuccess}/{countTrancoTotal}</strong>
                </span>
              </>
            )}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">Total uploaded elements: {rows.length}</div>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-xs">No spreadsheet records loaded yet.</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-xs">No records match the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-left text-xs text-gray-700">
              <thead className="bg-gray-50/55 font-semibold text-gray-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={isAllSelectedOnPage}
                      onChange={() => handleSelectAllOnPage(paginatedRows)}
                      className="rounded-sm border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                    />
                  </th>
                  <th className="py-3 px-4 w-8 text-center">Row</th>
                  {appMode === "domains" ? (
                    <>
                      <th className="py-3 px-6 text-left text-gray-500 font-mono text-[11px] uppercase tracking-wider font-bold">d_url</th>
                      <th className="py-3 px-6">Domain URL</th>
                      <th className="py-3 px-4">Site Name</th>
                      <th className="py-3 px-4">Status & Category</th>
                      <th className="py-3 px-4">News Pub</th>
                      <th className="py-3 px-4">Tranco Priority</th>
                      <th className="py-3 px-6 w-2/5">Detailed Brand Identity & Description</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-6 text-left text-gray-500 font-mono text-[11px] uppercase tracking-wider font-bold">d_url</th>
                      <th className="py-3 px-6">Source URL (Direct Feed)</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Target Country</th>
                      <th className="py-3 px-4 text-center">Language</th>
                      <th className="py-3 px-4">News Category</th>
                      <th className="py-3 px-4 text-center">Source Type</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {paginatedRows.map((row) => {
                  const isRowSelected = selectedIndices.includes(row.index);
                  return (
                    <tr
                      key={row.index}
                      className={`hover:bg-gray-55/40 transition-colors ${
                        isRowSelected ? "bg-indigo-50/25" : ""
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <input
                           type="checkbox"
                           checked={isRowSelected}
                           onChange={() => handleToggleRow(row.index)}
                           className="rounded-sm border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-center text-gray-400 font-mono text-[10px]">
                        {row.index + 1}
                      </td>
                      {appMode === "domains" ? (
                        <>
                          <td className="py-2.5 px-6 font-mono text-gray-500 text-xs select-all" title={row.d_url || row.domain}>
                            <span className="break-all">{row.d_url || row.domain}</span>
                          </td>
                          <td className="py-2.5 px-6 font-mono font-medium text-gray-900 text-xs">
                            <span className="break-all">{row.domain}</span>
                          </td>
                          <td className="py-2.5 px-4">
                            {(row.displayName || row.siteName) ? (
                              <div className="flex flex-col gap-0.5">
                                {row.displayName && <span className="font-bold text-gray-800 text-xs leading-tight">{row.displayName}</span>}
                                {row.siteName && <span className="text-[10px] text-gray-400 font-mono">slug: {row.siteName}</span>}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic text-[11px]">pending analysis</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 space-y-1">
                            <div>{getStatusBadge(row.status, row.errorMsg)}</div>
                            <div className="pt-0.5">{getCategoryBadge(row.category)}</div>
                          </td>
                          <td className="py-2.5 px-4">
                            {getNewsBadge(row.isNewsPublisher, row.newsPublisherStatus)}
                          </td>
                          <td className="py-2.5 px-4 text-xs font-medium">
                            {getTrancoBadge(row.trancoRank, row.trancoDate, row.trancoStatus)}
                          </td>
                          <td className="py-2.5 px-6 font-sans text-xs leading-relaxed space-y-1.5 text-left">
                            {row.description && (
                              <p className="text-gray-800 font-semibold leading-normal">
                                {row.description}
                              </p>
                            )}
                            {row.reasoning && (
                              <p className="text-gray-400 text-[10.5px] italic">
                                Reasoning: {row.reasoning}
                              </p>
                            )}
                            {!row.description && !row.reasoning && (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 px-6 font-mono text-gray-500 text-xs select-all" title={row.d_url || row.domain}>
                            <span className="break-all">{row.d_url || row.domain}</span>
                          </td>
                          <td className="py-2.5 px-6 font-mono font-bold text-gray-950 text-xs max-w-xs truncate" title={row.domain}>
                            <span className="flex items-center gap-1.5 text-rose-800 break-all">
                              <Rss className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              {row.domain}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {getStatusBadge(row.newsStatus || "pending", row.newsErrorMsg)}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {row.country ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-50 text-pink-800 border border-pink-100">
                                <MapPin className="h-3 w-3 text-pink-500 shrink-0" />
                                {row.country}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-mono text-[10px]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {row.language ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-800 border border-indigo-100">
                                <Languages className="h-3 w-3 text-indigo-500 shrink-0" />
                                {row.language}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-mono text-[10px]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            {row.newsCategory ? (
                              <div className="flex flex-wrap gap-1 items-center justify-start">
                                {row.newsCategory.split(",").map((cat, idx) => {
                                  const trimmed = cat.trim();
                                  if (!trimmed) return null;
                                  return (
                                    <span 
                                      key={idx} 
                                      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-amber-50 text-amber-900 border border-amber-100 hover:bg-amber-100 transition-colors shadow-2xs whitespace-nowrap"
                                    >
                                      {trimmed}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-gray-400 font-mono text-[10px]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {row.sourcetype ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold bg-teal-50 text-teal-800 border border-teal-100 hover:bg-teal-100 transition-colors shadow-2xs">
                                {row.sourcetype}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-mono text-[10px]">-</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer with Pagination Controls */}
        {filteredRows.length > 0 && (
          <div className="bg-gray-55/20 border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <div className="text-[11px] text-gray-500">
              Page <span className="font-semibold text-gray-800">{currentPage}</span> of{" "}
              <span className="font-semibold text-gray-800">{totalPages}</span> — showing items{" "}
              <span className="font-semibold text-gray-800">{startIndex + 1}</span> to{" "}
              <span className="font-semibold text-gray-800">
                {Math.min(startIndex + itemsPerPage, filteredRows.length)}
              </span>{" "}
              out of <span className="font-semibold text-gray-800">{filteredRows.length}</span>
            </div>

            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 px-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 px-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
