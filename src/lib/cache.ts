import { db } from "./firebase";
import { 
  doc, 
  getDoc, 
  getDocs,
  writeBatch, 
  collection, 
  addDoc, 
  serverTimestamp 
} from "firebase/firestore";

// Helper to sanitize undefined values before sending to Firestore
export function cleanForFirestore(obj: any): any {
  if (obj === undefined) {
    return null;
  }
  if (obj === null) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanForFirestore);
  }
  if (typeof obj === "object") {
    const res: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        res[key] = cleanForFirestore(val);
      } else {
        res[key] = null;
      }
    }
    return res;
  }
  return obj;
}

// Helper to escape domain strings for safe Firestore Document ID reference (avoids multi-segment path segment errors caused by slashes)
export function getSafeDocId(id: string): string {
  if (!id) return "empty_id";
  // Replace slashes and other non-standard Firestore ID characters with underscores, keeping alphanumeric, dots, and hyphens.
  return id.replace(/[^a-zA-Z0-9.-]/g, "_");
}

// Dispatches a global event that src/App.tsx hears to trigger a beautiful toast
export function dispatchSystemToast(message: string, type: "success" | "info" | "error" = "info") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("system-toast", {
        detail: { message, type }
      })
    );
  }
}

// Dispatches a global event that src/App.tsx hears to pop up a detailed system error dialog modal
export function dispatchSystemErrorModal(title: string, message: string, diagnostics?: string, type: "firestore" | "auth" | "unknown" = "firestore") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("system-error-modal", {
        detail: { title, message, diagnostics, type }
      })
    );
  }
}

// Helper functions for browser local storage fallback
function getLocalCache(storeKey: string): Record<string, any> {
  try {
    const value = localStorage.getItem(`publisher_cache_${storeKey}`);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function saveLocalCache(storeKey: string, data: Record<string, any>) {
  try {
    const current = getLocalCache(storeKey);
    const updated = { ...current, ...data };
    localStorage.setItem(`publisher_cache_${storeKey}`, JSON.stringify(updated));
  } catch (e) {
    console.error("Local storage error:", e);
  }
}

function getLocalHistory(userId?: string): any[] {
  try {
    const key = userId ? `publisher_history_runs_${userId}` : "publisher_history_runs";
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function saveLocalHistoryItem(item: any, userId?: string) {
  try {
    const current = getLocalHistory(userId);
    // Keep last 30 runs
    const updated = [item, ...current].slice(0, 30);
    const key = userId ? `publisher_history_runs_${userId}` : "publisher_history_runs";
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.error("Local storage history error:", e);
  }
}

// Fetch cached domain classification results
export async function getCachedDomains(domains: string[]): Promise<Record<string, any>> {
  const cache: Record<string, any> = {};
  
  // 1. Primary check local storage (fast path)
  const local = getLocalCache("domains");
  domains.forEach((dom) => {
    const clean = dom.toLowerCase().trim();
    if (clean && local[clean]) {
      cache[clean] = local[clean];
    }
  });

  // 2. Fetch missing from Cloud Firestore
  const missingDomains = domains.filter(d => !cache[d.toLowerCase().trim()]);
  if (missingDomains.length > 0) {
    try {
      const promises = missingDomains.map(async (domain) => {
        const docClean = domain.toLowerCase().trim();
        if (!docClean) return;
        const docId = getSafeDocId(docClean);
        const docRef = doc(db, "domain_cache", docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          cache[docClean] = data;
          // Synchronize to local cache
          saveLocalCache("domains", { [docClean]: data });
        }
      });
      await Promise.all(promises);
    } catch (err) {
      console.warn("Failed to query domain_cache on Firestore (using local storage fallback instead)", err);
    }
  }
  return cache;
}

// Set domain classification results in the cache
export async function setCachedDomains(results: Array<Partial<any> & { domain: string }>) {
  // 1. Sync to local storage
  const localData: Record<string, any> = {};
  const currentLocal = getLocalCache("domains");
  results.forEach(item => {
    const clean = item.domain.toLowerCase().trim();
    if (clean) {
      const existing = currentLocal[clean] || {};
      const cleaned = cleanForFirestore(item);
      
      localData[clean] = {
        ...existing,
        ...cleaned,
        domain: clean,
        updatedAt: new Date().toISOString()
      };
      
      if (!existing.createdAt && !localData[clean].createdAt) {
        localData[clean].createdAt = new Date().toISOString();
      }
    }
  });
  saveLocalCache("domains", localData);

  // 2. Sync to Firestore
  try {
    const batch = writeBatch(db);
    results.forEach((item) => {
      const docClean = item.domain.toLowerCase().trim();
      if (!docClean) return;
      const docId = getSafeDocId(docClean);
      const ref = doc(db, "domain_cache", docId);
      
      const cleaned = cleanForFirestore(item);
      const payload: Record<string, any> = {
        ...cleaned,
        domain: docClean,
        updatedAt: serverTimestamp()
      };
      
      // Filter out any temporary UI status fields from Firestore doc
      delete payload.index;
      delete payload.originalValues;
      delete payload.status;
      delete payload.errorMsg;
      delete payload.newsStatus;
      delete payload.newsErrorMsg;
      delete payload.newsPublisherStatus;
      delete payload.trancoStatus;

      batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
  } catch (err: any) {
    console.warn("Could not save domains to firestore cache (saved locally instead)", err);
    dispatchSystemToast(`Firestore domain caching failed: ${err.message || err}. Results saved locally.`, "error");
  }
}

// Helper to escape URL strings for safe Document ID reference
function getSourceDocId(url: string) {
  return url.replace(/[^a-zA-Z0-9]/g, "_");
}

// Fetch cached source classification results (for feed/source mode)
export async function getCachedSources(sources: string[]): Promise<Record<string, any>> {
  const cache: Record<string, any> = {};

  // 1. Primary check local storage
  const local = getLocalCache("sources");
  sources.forEach((src) => {
    const clean = src.toLowerCase().trim();
    if (clean && local[clean]) {
      cache[clean] = local[clean];
    }
  });

  // 2. Fallback to Firestore
  const missing = sources.filter(s => !cache[s.toLowerCase().trim()]);
  if (missing.length > 0) {
    try {
      const promises = missing.map(async (src) => {
        const srcClean = src.trim();
        if (!srcClean) return;
        const docId = getSourceDocId(srcClean);
        const docRef = doc(db, "source_cache", docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          cache[srcClean.toLowerCase()] = data;
          saveLocalCache("sources", { [srcClean.toLowerCase()]: data });
        }
      });
      await Promise.all(promises);
    } catch (err) {
      console.warn("Failed to query source_cache on Firestore (using local storage fallback instead)", err);
    }
  }
  return cache;
}

// Set sources in the cache
export async function setCachedSources(results: Array<{ source: string; country: string; language: string; category: string; sourcetype?: string }>) {
  // 1. Save locally
  const localData: Record<string, any> = {};
  const currentLocal = getLocalCache("sources");
  results.forEach(item => {
    const clean = item.source.toLowerCase().trim();
    if (clean) {
      const existing = currentLocal[clean] || {};
      const cleaned = cleanForFirestore(item);
      localData[clean] = {
        ...existing,
        ...cleaned,
        source: item.source,
        updatedAt: new Date().toISOString()
      };
      if (!existing.createdAt && !localData[clean].createdAt) {
        localData[clean].createdAt = new Date().toISOString();
      }
    }
  });
  saveLocalCache("sources", localData);

  // 2. Save on Firestore
  try {
    const batch = writeBatch(db);
    results.forEach((item) => {
      const srcClean = item.source.trim();
      if (!srcClean) return;
      const docId = getSourceDocId(srcClean);
      const ref = doc(db, "source_cache", docId);
      
      const cleaned = cleanForFirestore(item);
      const payload: Record<string, any> = {
        ...cleaned,
        source: srcClean,
        updatedAt: serverTimestamp()
      };
      
      batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
  } catch (err: any) {
    console.warn("Could not save sources to firestore cache (saved locally instead)", err);
    dispatchSystemToast(`Firestore source caching failed: ${err.message || err}. Saved locally instead.`, "error");
  }
}


// Save complete history run log
export async function saveRunHistory(
  userId: string,
  userEmail: string,
  fileName: string,
  mode: "domains" | "sources",
  results: any[]
) {
  // 1. Save to local storage history
  const localItem = {
    id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    userId,
    userEmail,
    fileName,
    mode,
    totalCount: results.length,
    timestamp: { seconds: Math.floor(Date.now() / 1000) },
    results: cleanForFirestore(results)
  };
  saveLocalHistoryItem(localItem, userId);

  // 2. Sync to Firestore history in chunks of 100
  try {
    const historyRef = collection(db, "history");
    const sanitizedResults = cleanForFirestore(results);
    const CHUNK_SIZE = 100;
    
    for (let i = 0; i < sanitizedResults.length; i += CHUNK_SIZE) {
      const chunk = sanitizedResults.slice(i, i + CHUNK_SIZE);
      const isMultiPart = sanitizedResults.length > CHUNK_SIZE;
      const partSuffix = isMultiPart ? ` (Part ${Math.floor(i / CHUNK_SIZE) + 1})` : "";
      
      await addDoc(historyRef, {
        userId: userId || "",
        userEmail: userEmail || "",
        fileName: (fileName || "") + partSuffix,
        mode,
        totalCount: chunk.length,
        timestamp: serverTimestamp(),
        results: chunk
      });
    }
  } catch (err: any) {
    console.warn("Could not save run history to firestore (saved locally instead)", err);
    // Dynamic toast showing exactly why firestore history failed
    dispatchSystemToast(`Firestore Sync Error: ${err.message || err}. Run history was securely backed up in Local Storage.`, "error");
    // Explicit dynamic popup system error modal
    dispatchSystemErrorModal(
      "Cloud Database Sync Blocked",
      `The system was unable to synchronize your classification history to Firebase Firestore. Good news: your data has been securely saved locally on this browser instead!`,
      `Database Path: /history\nDatabase Operation: addDoc(collection)\nFailed Field: results\n\nFirestore Native Exception:\n${err.stack || err.message || err}`,
      "firestore"
    );
  }
}

// Clear all cache/data in the databases (local & cloud)
export async function wipeGlobalDatabaseCache() {
  // 1. Wipe local caches
  localStorage.removeItem("publisher_cache_domains");
  localStorage.removeItem("publisher_cache_sources");

  // 2. Wipe Firestore collections (domain_cache, source_cache)
  try {
    const collectionsToClear = ["domain_cache", "source_cache"];
    for (const collName of collectionsToClear) {
      const snap = await getDocs(collection(db, collName));
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.warn("Could not completely clear cloud cache:", err);
    throw err;
  }
}
