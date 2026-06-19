import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs, orderBy, deleteDoc, doc, Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  History, 
  Trash2, 
  ArrowRight, 
  Calendar, 
  Layers, 
  CheckCircle2, 
  Database,
  FileSpreadsheet,
  Rss,
  Loader2,
  Inbox,
  AlertCircle
} from "lucide-react";

interface HistoryItem {
  id: string;
  userId: string;
  userEmail: string;
  fileName: string;
  mode: "domains" | "sources";
  totalCount: number;
  timestamp: any;
  results: any[];
}

interface HistoryScreenProps {
  userId: string;
  onLoadRun: (results: any[], fileName: string, mode: "domains" | "sources") => void;
}

export default function HistoryScreen({ userId, onLoadRun }: HistoryScreenProps) {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [isOffline, setIsOffline] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    setIsOffline(false);
    
    if (userId === "offline_sandbox_bypass_user") {
      setIsOffline(true);
      try {
        const localVal = localStorage.getItem("publisher_history_runs");
        if (localVal) {
          const parsed = JSON.parse(localVal);
          setHistoryItems(parsed);
        } else {
          setHistoryItems([]);
        }
      } catch (localErr) {
        console.error("Failed loading local history:", localErr);
        setError("Could not retrieve run logs from device memory.");
      }
      setLoading(false);
      return;
    }

    try {
      const q = query(
        collection(db, "history"),
        where("userId", "==", userId),
        orderBy("timestamp", "desc")
      );
      const snapshot = await getDocs(q);
      const items: HistoryItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          userId: data.userId,
          userEmail: data.userEmail || "",
          fileName: data.fileName || "Untitled Upload",
          mode: data.mode || "domains",
          totalCount: data.totalCount || 0,
          timestamp: data.timestamp,
          results: data.results || []
        });
      });
      setHistoryItems(items);
    } catch (err: any) {
      console.warn("Could not query history on Firestore. Falling back to local device storage.", err);
      setIsOffline(true);
      try {
        const localVal = localStorage.getItem("publisher_history_runs");
        if (localVal) {
          const parsed = JSON.parse(localVal);
          setHistoryItems(parsed);
        } else {
          setHistoryItems([]);
        }
      } catch (localErr) {
        console.error("Failed loading local history:", localErr);
        setError("Could not retrieve run logs from device memory.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [userId]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    
    // Always remove from local storage state regardless
    try {
      const localVal = localStorage.getItem("publisher_history_runs");
      if (localVal) {
        const parsed = JSON.parse(localVal) as any[];
        const filtered = parsed.filter(item => item.id !== id);
        localStorage.setItem("publisher_history_runs", JSON.stringify(filtered));
      }
    } catch (e) {
      console.error("Failed local delete sync", e);
    }

    try {
      if (!isOffline && !id.startsWith("local_")) {
        await deleteDoc(doc(db, "history", id));
      }
      setHistoryItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      console.warn("Could not sync delete to Firestore database. Cleared locally anyway.", err);
      setHistoryItems((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "Just now";
    let date: Date;
    if (timestamp instanceof Timestamp) {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else {
      date = new Date(timestamp);
    }
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-white border border-gray-150 p-6 rounded-2xl shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Processed Files &amp; Session Logs</h2>
          </div>
          <p className="text-[11px] text-gray-500 max-w-xl leading-normal">
            Every time domains or feeds are processed, they are saved automatically to your workspace account. 
            You can recall any past sheet instantly down below, bypassing re-upload or API calls.
          </p>
        </div>
        <div className="inline-flex flex-col md:flex-row items-start md:items-center gap-2">
          {isOffline && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 font-bold text-xs uppercase tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
              <span>Developer Sandbox Mode (Local Cache)</span>
            </div>
          )}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-750 font-bold text-xs uppercase tracking-wide">
            <Database className="h-4 w-4" />
            <span>Total runs saved: {historyItems.length}</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 bg-white border border-gray-100 rounded-2xl">
          <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider animate-pulse">Loading Workspace History...</p>
        </div>
      ) : error ? (
        <div className="p-12 text-center border border-red-100 bg-red-50 text-red-800 rounded-2xl">
          <p className="text-xs font-semibold">Could not read run history from Cloud DB</p>
          <p className="text-[11px] text-red-650 mt-1">{error}</p>
          <button
            onClick={fetchHistory}
            className="mt-3 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold transition-all"
          >
            Retry Connection
          </button>
        </div>
      ) : historyItems.length === 0 ? (
        <div className="p-16 text-center border border-gray-100 bg-white rounded-2xl flex flex-col items-center justify-center gap-3">
          <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <Inbox className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-800 uppercase tracking-wide">No History Found</p>
            <p className="text-[11px] text-gray-400 max-w-sm">
              Upload a spreadsheet or RSS file feed. Once domains are classified, the history logs will show up here automatically!
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-left text-xs text-gray-700">
              <thead className="bg-gray-50/75 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-6">Source/Spreadsheet ID</th>
                  <th className="py-3 px-4">Classification Mode</th>
                  <th className="py-3 px-4">Records processed</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {historyItems.map((item) => (
                  <tr 
                    key={item.id} 
                    className="hover:bg-indigo-50/15 cursor-pointer transition-colors"
                    onClick={() => onLoadRun(item.results, item.fileName, item.mode)}
                    title="Click to load this past runner session"
                  >
                    {/* Source filename */}
                    <td className="py-4 px-6 font-semibold text-gray-900">
                      <div className="flex items-center gap-2">
                        {item.mode === "domains" ? (
                          <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Rss className="h-4.5 w-4.5 text-amber-500 shrink-0" />
                        )}
                        <span className="truncate max-w-sm font-sans" title={item.fileName}>
                          {item.fileName.length > 50 ? `${item.fileName.slice(0, 50)}...` : item.fileName}
                        </span>
                      </div>
                    </td>

                    {/* Mode tag */}
                    <td className="py-4 px-4">
                      {item.mode === "domains" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-100">
                          Domain Classifier
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-100">
                          Source Feed Level
                        </span>
                      )}
                    </td>

                    {/* Total count */}
                    <td className="py-4 px-4 font-mono font-medium text-gray-600">
                      {item.totalCount} rows
                    </td>

                    {/* Timestamp */}
                    <td className="py-4 px-4 text-gray-500 font-sans flex items-center gap-1.5 mt-1">
                      <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      {formatDate(item.timestamp)}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          onClick={() => onLoadRun(item.results, item.fileName, item.mode)}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          Load Runner
                          <ArrowRight className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(item.id, e)}
                          title={confirmDeleteId === item.id ? "Click again to confirm delete" : "Delete historical log"}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-300 ${
                            confirmDeleteId === item.id
                              ? "bg-rose-500 text-white hover:bg-rose-600 animate-pulse"
                              : "text-gray-400 hover:text-red-650 hover:bg-slate-50"
                          }`}
                        >
                          {confirmDeleteId === item.id ? (
                            <>
                              <AlertCircle className="h-3.5 w-3.5 text-white" />
                              <span className="text-[10px]">Confirm?</span>
                            </>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
