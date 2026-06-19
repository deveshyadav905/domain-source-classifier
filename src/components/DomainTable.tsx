import { useState } from "react";
import { DomainRow } from "../types";
import { Search, SlidersHorizontal, Loader2, Sparkles, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Check, Globe, Rss, MapPin, Languages, Trash2 } from "lucide-react";

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
      const matchesNewsCategory = !filterCategory || r.newsCategory === filterCategory;
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

  const getNewsBadge = (isNews?: DomainRow["isNewsPublisher"]) => {
    if (!isNews) return <span className="text-gray-400 text-xs">-</span>;
    return isNews === "Yes" ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-100">
        Yes (Publisher)
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-50 text-slate-600 border border-slate-100">
        No
      </span>
    );
  };

  const pageIndices = paginatedRows.map((r) => r.index);
  const isAllSelectedOnPage = pageIndices.length > 0 && pageIndices.every((idx) => selectedIndices.includes(idx));

  const countPending = appMode === "domains" 
    ? rows.filter((r) => r.status === "pending").length
    : rows.filter((r) => !r.country && !r.language).length;

  // Extract unique news categories from source rows dynamically for filtering
  const uniqueNewsCategories = Array.from(
    new Set(rows.map((r) => r.newsCategory).filter(Boolean))
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
      {/* Search and Filters Hub */}
      <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-xs space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 items-center">
            {selectedIndices.length > 0 && (
              <>
                {appMode === "domains" ? (
                  <button
                    onClick={() => {
                      onClassifySelected(selectedIndices);
                      setSelectedIndices([]);
                    }}
                    disabled={isClassifying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-650 text-white rounded-xl text-[11px] font-bold hover:bg-indigo-750 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                    Classify Selected Domains ({selectedIndices.length})
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onValidateNewsSelected(selectedIndices);
                      setSelectedIndices([]);
                    }}
                    disabled={isAnalyzingNews}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-650 text-white rounded-xl text-[11px] font-bold hover:bg-rose-750 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                  >
                    <Globe className="h-3.5 w-3.5 text-rose-200" />
                    Classify Selected Sources ({selectedIndices.length})
                  </button>
                )}
              </>
            )}

            {appMode === "domains" ? (
              <button
                onClick={onClassifyRemaining}
                disabled={isClassifying || countPending === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isClassifying ? "animate-spin" : ""}`} />
                Batch Classify Pending ({countPending})
              </button>
            ) : (
              <button
                onClick={() => {
                  const items = rows.filter((r) => !r.country && !r.language).map((r) => r.index);
                  if (items.length > 0) {
                    onValidateNewsSelected(items);
                  }
                }}
                disabled={isAnalyzingNews || countPending === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzingNews ? "animate-spin" : ""}`} />
                Classify All Pending Feeds ({countPending})
              </button>
            )}

            {isClassifying || isAnalyzingNews ? (
              <button
                type="button"
                onClick={onStopAllProcesses}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[11px] font-bold transition-all shadow-xs cursor-pointer animate-pulse shrink-0"
                title="Stop all currently running processes"
              >
                <span className="h-2 w-2 rounded-full bg-white block animate-ping mr-1"></span>
                Stop Process
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-400 rounded-xl text-[11px] font-bold cursor-not-allowed shrink-0"
                title="No active processes running"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gray-300 block mr-1"></span>
                Stop Process
              </button>
            )}

            <button
              onClick={onClearCurrentResults}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:border-gray-200 disabled:text-gray-400 transition-colors shadow-2xs cursor-pointer ml-auto"
              title="Reset all rows back to pending status and clear local classification details"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Reset Classification Results
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-50 text-xs items-center text-gray-600">
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400 mr-2 uppercase tracking-wide">
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
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-700 focus:outline-hidden cursor-pointer"
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
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-700 focus:outline-hidden cursor-pointer"
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
                className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] bg-white text-gray-700 focus:outline-hidden cursor-pointer"
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

          {/* Reset button */}
          {(filterCategory || filterNews || searchTerm) && (
            <button
              onClick={() => {
                setFilterCategory("");
                setFilterNews("");
                setSearchTerm("");
                setCurrentPage(1);
              }}
              className="text-xs text-indigo-600 hover:underline font-semibold ml-2 cursor-pointer"
            >
              Clear filters
            </button>
          )}

          <div className="ml-auto text-[11px] text-gray-400">
            Showing {filteredRows.length} of {rows.length} rows
          </div>
        </div>
      </div>

      {/* Main Table View */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-xs overflow-hidden">
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
                      <th className="py-3 px-6">Domain url</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">News Publisher</th>
                      <th className="py-3 px-6 w-2/5">AI Domain Description / Reasoning</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-6">Source URL (Direct Feed)</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Target Country</th>
                      <th className="py-3 px-4 text-center">Language</th>
                      <th className="py-3 px-4">News Category</th>
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
                          <td className="py-2.5 px-6 font-mono font-medium text-gray-900 group relative text-xs">
                            <span className="break-all">{row.domain}</span>
                          </td>
                          <td className="py-2.5 px-4 text-xs font-medium">
                            {getStatusBadge(row.status, row.errorMsg)}
                          </td>
                          <td className="py-2.5 px-4">
                            {getCategoryBadge(row.category)}
                          </td>
                          <td className="py-2.5 px-4">
                            {getNewsBadge(row.isNewsPublisher)}
                          </td>
                          <td className="py-2.5 px-6 font-sans text-gray-500 text-xs italic leading-relaxed">
                            {row.reasoning || "-"}
                          </td>
                        </>
                      ) : (
                        <>
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
                              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-55/60 text-amber-900 border border-amber-200">
                                {row.newsCategory}
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
