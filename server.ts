import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Parse typical JSON bodies up to 10mb
app.use(express.json({ limit: "10mb" }));

function convertToCSV(values: any[][]): string {
  if (!values || !Array.isArray(values)) return "";
  return values
    .map((row) =>
      row
        .map((val) => {
          const cellStr = val === null || val === undefined ? "" : String(val);
          if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n") || cellStr.includes("\r")) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        })
        .join(",")
    )
    .join("\n");
}

// Endpoint to fetch public/private Google Sheet as CSV with multi-stage authorization bypasses
app.get("/api/fetch-sheet", async (req, res) => {
  try {
    const { spreadsheetId, gid } = req.query;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId parameter is required." });
    }

    const authHeader = req.headers.authorization;
    let csvText: string | null = null;
    let isAuthorized = false;
    let hadAuth401 = false;

    // Direct REST API Handshake first (for private spreadsheets using bearer tokens)
    if (authHeader && authHeader !== "Bearer null" && authHeader !== "Bearer undefined") {
      isAuthorized = true;
      try {
        console.log(`Attempting secure REST API fetch for spreadsheet ${spreadsheetId}...`);
        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
          headers: { Authorization: authHeader, "User-Agent": "aistudio-build" },
        });

        if (metaRes.ok) {
          const metaData = await metaRes.json();
          const sheets = metaData.sheets || [];
          let targetSheetTitle = sheets[0]?.properties?.title || "Sheet1";
          if (gid) {
            const matchedSheet = sheets.find((s: any) => String(s.properties?.sheetId) === String(gid));
            if (matchedSheet) {
              targetSheetTitle = matchedSheet.properties.title;
            }
          }

          console.log(`Retrieving secure range values for tab: "${targetSheetTitle}"...`);
          const valuesRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(targetSheetTitle)}`,
            { headers: { Authorization: authHeader, "User-Agent": "aistudio-build" } }
          );

          if (valuesRes.ok) {
            const valuesData = await valuesRes.json();
            csvText = convertToCSV(valuesData.values || []);
            console.log("Secure Sheets API fetch succeeded.");
          } else {
            console.warn(`Values REST API fetch failed with status: ${valuesRes.status}`);
            if (valuesRes.status === 401) {
              hadAuth401 = true;
            }
          }
        } else if (metaRes.status === 401) {
          console.warn(`Spreadsheet metadata REST API fetch failed with status: 401`);
          hadAuth401 = true;
        } else {
          console.warn(`Spreadsheet metadata REST API fetch failed with status: ${metaRes.status}`);
        }
      } catch (authFetchErr) {
        console.error("Exception during secure REST API handshake:", authFetchErr);
      }
    }

    // If secure REST API fetch didn't return values, proceed to web export fallbacks
    if (csvText === null) {
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
      const headers: Record<string, string> = {
        "User-Agent": "aistudio-build",
      };
      if (authHeader && authHeader !== "Bearer null" && authHeader !== "Bearer undefined") {
        headers["Authorization"] = authHeader;
      }

      let response = await fetch(url, { headers });
      const originalStatus = response.status;

      // Fallback 1: If authorized fetch returned 401/error, retry anonymously!
      if (!response.ok && headers["Authorization"]) {
        console.log(`Private/Authorized fetch returned HTTP ${response.status}. Retrying as public anonymous request...`);
        const anonResponse = await fetch(url, {
          headers: { "User-Agent": "aistudio-build" },
        });
        if (anonResponse.ok) {
          response = anonResponse;
        }
      }

      // Fallback 2: Try the Google GViz Visualization query endpoint
      if (!response.ok) {
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`;
        console.log(`Standard fetch failed with HTTP ${response.status}. Trying gviz fallback URL: ${gvizUrl}`);
        const gvizResponse = await fetch(gvizUrl, {
          headers: { "User-Agent": "aistudio-build" },
        });
        if (gvizResponse.ok) {
          response = gvizResponse;
        }
      }

      if (!response.ok) {
        const finalStatus = (originalStatus === 401 || hadAuth401) ? 401 : response.status;
        return res.status(finalStatus === 401 ? 401 : 400).json({
          error: `Failed to fetch sheet (HTTP ${finalStatus}). ${
            finalStatus === 401
              ? "Your Google Sheets connection has expired. Please click 'Connect Google Sheets' to refresh access."
              : finalStatus === 403
                ? "Access denied. Make sure you have authorized permissions/access to this spreadsheet."
                : "Make sure the Google Sheet is shared with 'Anyone with the link can view' permission, or authenticate to access it."
          }`,
        });
      }
      csvText = await response.text();
    }

    return res.json({ success: true, csv: csvText });
  } catch (error: any) {
    console.error("Fetch-sheet error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch spreadsheet. Check server connection." });
  }
});

// Initialize the server-side Gemini client
let ai: GoogleGenAI | null = null;
function getGemini(customKey?: string): GoogleGenAI {
  if (customKey && customKey.trim()) {
    return new GoogleGenAI({
      apiKey: customKey.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Configure it in Settings > Secrets.");
    }
    ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// Inline content helper with exponential backoff retry and model fallback
async function generateContentWithRetry(gemini: GoogleGenAI, params: any, retries: number = 3, baseDelayMs: number = 1000): Promise<any> {
  const modelsToTry = [
    "gemini-3.5-flash",        // Primary, state-of-the-art developer model with high limits
    "gemini-3.1-flash-lite",   // Highly reliable lightweight fallback
    "gemini-flash-latest"      // Lightweight backup
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    const attemptParams = { ...params, model };
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        console.log(`Sending prompt to ${model} (attempt ${attempt + 1}/${retries})...`);
        const response = await gemini.models.generateContent(attemptParams);
        return response;
      } catch (err: any) {
        lastError = err;
        const msg = String(err.message || "").toLowerCase();
        const code = err.status || (err.error && err.error.code) || 0;

        // Determine if this is a hard quota / limit error where retrying the exact same model is futile
        const isQuotaExceeded = code === 429 || 
                                msg.includes("quota") || 
                                msg.includes("resource_exhausted") || 
                                msg.includes("rate limit") ||
                                msg.includes("limit: 20") ||
                                msg.includes("exceeded your current quota");

        const isOverloaded = code === 503 || 
                             msg.includes("503") || 
                             msg.includes("unavailable") || 
                             msg.includes("high demand") || 
                             msg.includes("spikes in demand") || 
                             msg.includes("overloaded") ||
                             msg.includes("temporary");

        const currentModelIndex = modelsToTry.indexOf(model);
        const hasFallbackModel = currentModelIndex !== -1 && currentModelIndex < modelsToTry.length - 1;

        // For quota errors, immediately break to try the next fallback model
        if (isQuotaExceeded && hasFallbackModel) {
          console.warn(`Model ${model} quota exceeded. Swapping immediately to next fallback model...`);
          break; // Break inner loop of this model to try the next model instantly
        }

        // For overloaded errors, we should retry the same model with exponential backoff
        if (isOverloaded && attempt < retries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`Transient busy error on ${model} (attempt ${attempt + 1}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // If overloaded and we ran out of retries, or if it is any other non-retriable error
          console.error(`Attempt ${attempt + 1} with ${model} failed or reached max attempts: ${err.message}`);
          break; // Stop retrying this model, proceed to the fallback model if any
        }
      }
    }
  }

  throw lastError;
}

// Helper to sanitize and clarify Gemini API errors for users
function sanitizeGeminiError(err: any): string {
  if (!err) return "An unexpected error occurred.";
  
  const originalMessage = String(err.message || "");
  let messageLower = originalMessage.toLowerCase();
  
  // Try to parse if it is a JSON string from API (like ApiError format with text prefix)
  try {
    const jsonStartIndex = originalMessage.indexOf("{");
    if (jsonStartIndex !== -1) {
      const jsonSubstring = originalMessage.slice(jsonStartIndex);
      const parsed = JSON.parse(jsonSubstring);
      if (parsed.error && parsed.error.message) {
        let nestedMsg = parsed.error.message;
        if (parsed.error.code === 429 || String(parsed.error.status).toLowerCase() === "resource_exhausted") {
          return `AI Daily Free-Tier Quota Limit Exceeded: ${nestedMsg}. Please add a custom development key or select a paid API tier under Settings > Secrets to continue without constraints.`;
        }
        return nestedMsg;
      }
    }
  } catch (e) {
    // Treat as non-json if failing to parse
  }

  // Fallback checks on plain text message
  if (messageLower.includes("quota") || messageLower.includes("resource_exhausted") || messageLower.includes("limit: 20") || messageLower.includes("429")) {
    return "AI API Request Limit Exceeded: You have reached the maximum allowed daily classifications for this model. Add a custom Gemini key under Settings > Secrets to run unlimited processes.";
  }
  if (messageLower.includes("503") || messageLower.includes("unavailable") || messageLower.includes("overloaded") || messageLower.includes("high demand") || messageLower.includes("spikes in demand")) {
    return "The Gemini service is temporarily overloaded due to high demand. We made 3 retry attempts, but the server is still unavailable. Please check back in a few seconds.";
  }
  
  return err.message || String(err);
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

function toDomainTitleCaseWithoutTLD(domain: string): string {
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

function toDomainTitleCase(domain: string): string {
  return toDomainTitleCaseWithoutTLD(domain);
}

// API routes go here FIRST
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    keys: Object.keys(process.env).filter(
      (k) => !k.toLowerCase().includes("key") && !k.toLowerCase().includes("secret")
    ),
  });
});

// Dynamic endpoint serving firebase config structure directly to client-side window object
app.get("/firebase-config.js", (req, res) => {
  const cleanVal = (v: any) => {
    if (!v) return "";
    let s = String(v).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  };
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
    window.FIREBASE_CONFIG = {
      projectId: ${JSON.stringify(process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "")},
      appId: ${JSON.stringify(process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || "")},
      apiKey: ${JSON.stringify(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "")},
      authDomain: ${JSON.stringify(process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || "")},
      storageBucket: ${JSON.stringify(process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || "")},
      messagingSenderId: ${JSON.stringify(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || "")},
      measurementId: ${JSON.stringify(process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || "")}
    };
  `);
});

app.post("/api/classify", async (req, res) => {
  try {
    const { domains, customApiKey } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: "Missing or invalid domains array." });
    }

    const gemini = getGemini(customApiKey);

    // Split domains into chunks of 100 to avoid token or rate limitations
    const CHUNK_SIZE = 100;
    const results = [];

    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
      const chunk = domains.slice(i, i + CHUNK_SIZE);
      const prompt = `Classify the following list of domains and extract their identity details.
For each domain, identify:
1. Site name which MUST be the domain name itself WITHOUT the top-level domain (TLD) suffix (e.g. remove '.com', '.net', '.org', '.edu', '.co.uk', '.media', etc.), formatted strictly in Title Case, keeping any dots ('.') or hyphens ('-') exactly as they are in the remaining domain name (e.g., 'Kaktus' for 'kaktus.media', 'Shopify' for 'shopify.com', 'Harvard' for 'harvard.edu', 'Blog.Csdn' for 'blog.csdn.net', 'E-Commerce-Site' for 'e-commerce-site.com').
2. Official/polished display name in Title Case and FULL expanded form rather than short abbreviation (e.g. 'British Broadcasting Corporation' instead of 'BBC')
3. Detailed site description (e.g., 'An independent regional news outlet...' or 'Global e-commerce portal...')
4. Category - Dynamically determine the primary category/industry of the domain based on its target business, content, or field of activity (e.g., 'e-commerce', 'technology', 'blogs', 'education', 'news', 'healthcare', 'finance', 'travel', 'entertainment', etc.).
5. What is the webpage type/purpose of the domain? Dynamically determine the webpage type or purpose of the domain (e.g., 'News Publisher', 'University / Education', 'Product Website', 'Organization', 'Blog', 'Corporate / Company', 'Government', 'E-commerce', 'Social Media / Forum', 'Search Engine', 'Portfolio', etc.). Be specific and accurate.
6. A brief explanation/reasoning of 1 short sentence why it was categorized this way.

Domains to classify:
${chunk.map((d) => `- ${d}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an elite, highly intelligent domain classification and brand intelligence system.
Analyze the provided domain list, using linguistic structures, brand clues, top-level domains (e.g., localized country code TLDs), and historical web knowledge.

GUIDELINES FOR FIELDS:
1. "siteName": MUST be the domain name itself WITHOUT the top-level domain (TLD) suffix (e.g. remove '.com', '.net', '.org', '.edu', '.co.uk', '.media', etc.), formatted strictly in Title Case, preserving any dots ('.') and hyphens ('-') exactly as they are in the remaining domain URL (e.g., 'Kaktus' for 'kaktus.media', 'Shopify' for 'shopify.com', 'Harvard' for 'harvard.edu', 'Blog.Csdn' for 'blog.csdn.net', 'E-Commerce-Site' for 'e-commerce-site.com'). Do NOT keep or include the TLD suffix under any circumstances.
2. "displayName": MUST be strictly in Title Case and use the FULL expansion of the brand or organization name instead of short abbreviations or acronyms (e.g., use 'British Broadcasting Corporation' instead of 'BBC', 'National Broadcasting Company' instead of 'NBC', 'The New York Times' instead of 'NYT', 'Massachusetts Institute of Technology' instead of 'MIT', 'Cable News Network' instead of 'CNN').
3. "description": A high-fidelity, comprehensive single-sentence description of the site's primary function, target audience, and content style. Must be clear, informative, and avoid generic statements like "A web domain" or "No description available".
4. "category": Dynamically classify the primary industry, topic, or industry vertical of the domain (e.g., 'e-commerce', 'technology', 'blogs', 'education', 'news', 'healthcare', 'finance', 'travel', 'entertainment', etc.). Be highly specific and accurate.
5. "isNewsPublisher": Dynamically determine the webpage type, purpose, or organization style (e.g., 'News Publisher', 'University / Education', 'Product Website', 'Organization', 'Blog', 'Corporate / Company', 'Government', 'E-commerce', 'Social Media / Forum', 'Search Engine', etc.).
6. "reasoning": A crisp, one-sentence objective justification for the selected category.

EXAMPLES OF HIGH-QUALITY CLASSIFICATION:
Input domain: "kaktus.media"
Result: {
  "domain": "kaktus.media",
  "siteName": "Kaktus",
  "displayName": "Kaktus Media",
  "description": "An independent Russian-language online news portal based in Kyrgyzstan covering current national events, politics, and social developments.",
  "category": "news",
  "isNewsPublisher": "News Publisher",
  "reasoning": "Active digital publication delivering local and regional news updates in Central Asia."
}`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                domain: {
                  type: Type.STRING,
                  description: "The exact domain to classify (e.g. example.com). Should match the input domain case-sensitively or in lowercase as provided.",
                },
                siteName: {
                  type: Type.STRING,
                  description: "The domain name itself WITHOUT the top-level domain (TLD) suffix, formatted strictly in Title Case, preserving any dots ('.') and hyphens ('-') exactly as they are in the remaining domain name (e.g. 'Kaktus' for 'kaktus.media', 'Shopify' for 'shopify.com', 'Blog.Csdn' for 'blog.csdn.net').",
                },
                displayName: {
                  type: Type.STRING,
                  description: "The formal/official presentation name of the site in Title Case, using full expansions/full form instead of short abbreviations/acronyms (e.g. 'British Broadcasting Corporation' instead of 'BBC', 'National Broadcasting Company' instead of 'NBC').",
                },
                description: {
                  type: Type.STRING,
                  description: "Full descriptive sentence of the site activity or publication target, preferably in the site's primary language or English if unknown.",
                },
                category: {
                  type: Type.STRING,
                  description: "Dynamically determined primary industry or niche of the domain (e.g., 'e-commerce', 'technology', 'blogs', 'education', 'news', 'healthcare', 'finance', 'travel', etc.).",
                },
                isNewsPublisher: {
                  type: Type.STRING,
                  description: "Dynamically determined webpage type/purpose of the domain (e.g., 'News Publisher', 'University / Education', 'Product Website', 'Organization', 'Blog', 'Corporate / Company', 'Government', 'E-commerce', 'Social Media / Forum', 'Search Engine', etc.).",
                },
                reasoning: {
                  type: Type.STRING,
                  description: "A very brief, 1-sentence description/explanation of the classification.",
                },
              },
              required: ["domain", "siteName", "displayName", "description", "category", "isNewsPublisher", "reasoning"],
            },
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini API.");
      }

      try {
        const parsedChunk = JSON.parse(responseText.trim());
        if (Array.isArray(parsedChunk)) {
          results.push(...parsedChunk);
        } else {
          console.error("Gemini did not return an array:", responseText);
          chunk.forEach((d) => {
            results.push({
              domain: d,
              siteName: toDomainTitleCase(d),
              displayName: toTitleCase(d.split('.')[0]),
              description: "Unknown site description",
              category: "other",
              isNewsPublisher: "Other",
              reasoning: "Failed to parse classification chunk",
            });
          });
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini output", jsonErr, responseText);
        chunk.forEach((d) => {
          results.push({
            domain: d,
            siteName: toDomainTitleCase(d),
            displayName: toTitleCase(d.split('.')[0]),
            description: "Unknown site description",
            category: "other",
            isNewsPublisher: "Other",
            reasoning: "Invalid JSON response from model",
          });
        });
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Classification error:", error);
    const readableError = sanitizeGeminiError(error);
    const isQuota = error.status === 429 || 
                    String(error.message || "").toLowerCase().includes("quota") ||
                    String(error.message || "").toLowerCase().includes("resource_exhausted") ||
                    String(error.message || "").toLowerCase().includes("rate limit") ||
                    String(error.message || "").toLowerCase().includes("limit: 20") ||
                    String(error.message || "").toLowerCase().includes("exceeded your current quota");
    return res.status(isQuota ? 429 : 500).json({ error: readableError });
  }
});


app.post("/api/check-news-publisher", async (req, res) => {
  try {
    const { domains, customApiKey } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: "Missing or invalid domains array." });
    }

    const gemini = getGemini(customApiKey);
    const CHUNK_SIZE = 50; // Smaller chunk size for faster response time
    const chunks = [];
    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
      chunks.push(domains.slice(i, i + CHUNK_SIZE));
    }

    // Process all chunks concurrently using Promise.all for maximum speed!
    const chunkPromises = chunks.map(async (chunk) => {
      const prompt = `Determine the webpage purpose/type of the following domains.
Dynamically determine the webpage type or purpose of the domain (e.g., 'News Publisher', 'University / Education', 'Product Website', 'Organization', 'Blog', 'Corporate / Company', 'Government', 'E-commerce', 'Social Media / Forum', 'Portfolio', 'Search Engine', etc.).
Provide a brief 1-sentence reasoning explaining why it was classified under this type.

Domains:
${chunk.map((d) => `- ${d}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an elite, super fast domain intelligence assistant. For each input domain, dynamically determine its webpage type or purpose and provide a brief 1-sentence reasoning.
Examples of page types include 'News Publisher', 'University / Education', 'Product Website', 'Organization', 'Blog', 'Corporate / Company', 'Government', 'E-commerce', 'Social Media / Forum', etc. Do not be limited to these; choose the most specific and accurate webpage type.

Do not return any other fields in the JSON object besides the schema properties.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                domain: {
                  type: Type.STRING,
                  description: "The exact input domain (e.g. example.com).",
                },
                isNewsPublisher: {
                  type: Type.STRING,
                  description: "Dynamically determined webpage type/purpose of the domain.",
                },
                reasoning: {
                  type: Type.STRING,
                  description: "A very brief, 1-sentence explanation of why it fits this webpage purpose/type.",
                },
              },
              required: ["domain", "isNewsPublisher", "reasoning"],
            },
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini API.");
      }

      try {
        const parsedChunk = JSON.parse(responseText.trim());
        if (Array.isArray(parsedChunk)) {
          return parsedChunk;
        } else {
          console.error("Gemini news publisher check didn't return an array:", responseText);
          return chunk.map((d) => ({
            domain: d,
            isNewsPublisher: "Other",
            reasoning: "Failed to parse news status chunk",
          }));
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini news check", jsonErr, responseText);
        return chunk.map((d) => ({
          domain: d,
          isNewsPublisher: "Other",
          reasoning: "Invalid JSON response from model",
        }));
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    const results = chunkResults.flat();

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("News publisher check error:", error);
    const readableError = sanitizeGeminiError(error);
    const isQuota = error.status === 429 || 
                    String(error.message || "").toLowerCase().includes("quota") ||
                    String(error.message || "").toLowerCase().includes("resource_exhausted") ||
                    String(error.message || "").toLowerCase().includes("rate limit") ||
                    String(error.message || "").toLowerCase().includes("limit: 20") ||
                    String(error.message || "").toLowerCase().includes("exceeded your current quota");
    return res.status(isQuota ? 429 : 500).json({ error: readableError });
  }
});


// Endpoint to fetch Tranco rank details to fetch priorities
app.post("/api/tranco", async (req, res) => {
  try {
    const { domains } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: "Missing or invalid domains array." });
    }

    const results = [];
    for (const d of domains) {
      const cleanDom = String(d).trim().toLowerCase();
      // Refined extraction logic to query base domains on Tranco (e.g. kaktus.media, ritmeurasia.ru)
      let domainName = cleanDom
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split('/')[0]
        .split(':')[0];

      let rank: number | null = null;
      let date = "not ranked";
      let status: "success" | "error" = "success";

      try {
        const url = `https://tranco-list.eu/api/ranks/domain/${domainName}`;
        const trancoRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://tranco-list.eu/query",
            "Origin": "https://tranco-list.eu",
          },
        });

        if (trancoRes.status === 429) {
          date = "rate limited";
          status = "error";
        } else if (trancoRes.ok) {
          const data = await trancoRes.json() as any;
          if (data && data.ranks && data.ranks.length > 0) {
            rank = data.ranks[0].rank;
            date = data.ranks[0].date;
          }
        } else {
          date = trancoRes.status === 404 ? "not ranked" : `HTTP ${trancoRes.status}`;
          if (trancoRes.status !== 404) {
            status = "error";
          }
        }
      } catch (err: any) {
        console.error(`Tranco rank fetch error on ${domainName}:`, err);
        date = `error: ${err.message || err}`;
        status = "error";
      }

      results.push({
        domain: d,
        rank,
        date,
        status,
      });

      if (domains.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Tranco service error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});



app.post("/api/classify-source", async (req, res) => {
  try {
    const { sources, customApiKey } = req.body;
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: "Missing or invalid sources array." });
    }

    const gemini = getGemini(customApiKey);
    const results = [];
    const CHUNK_SIZE = 100;

    for (let i = 0; i < sources.length; i += CHUNK_SIZE) {
      const chunk = sources.slice(i, i + CHUNK_SIZE);
      const prompt = `Identify and classify the geographic/language target metadata, content category, and source content type for the following feed sources or URLs.
These represent direct content sources (RSS feeds, sitemap indexes, content streams, or dedicated channels).

For each source URL, determine:
1. Primary target Country (e.g. "United States", "India", "Germany", "United Kingdom", "France", "Canada", etc.). NEVER use "Global". If a source covers global news or is a global publisher, determine the primary/major country it covers or its country of origin (e.g., "United Kingdom" for BBC, "United States" for CNN).
2. Main content Language (e.g. "English", "Spanish", "German", "Hindi", "French", etc.). STRICT RULE: Identify the actual, real language in which the source publishes its news/content. Do NOT naively assume the language is "English" just because a URL contains common folders like "/en/" or language-like paths if the publisher actually publishes in another language. Analyze the publisher domain's real identity and native language to make an accurate determination.
3. Main Category - MUST be exactly one of these allowed values:
   ["top", "sports", "technology", "business", "science", "entertainment", "health", "world", "politics", "environment", "food", "tourism", "education", "domestic", "crime", "other", "lifestyle", "breaking"]
4. Main Source Type - MUST be exactly one of these allowed values:
   ["news", "blog", "multimedia", "forum", "pressrelease", "review", "research", "opinion", "analysis", "podcast"]

Sources to classify:
${chunk.map((s) => `- ${s}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an expert news and media content analyst specializing in syndication feeds.
For each provided content feed URL, analyze the path structures, domain components, subfolders, and language markers to identify the metadata.

GUIDELINES:
1. "source": Keep this exactly identical to the input URL from the prompt.
2. "country": Primary audience country, parsed from top-level domains or directory folders (e.g., 'United Kingdom', 'United States', 'France', 'India', 'Kyrgyzstan'). STRICT RULE: NEVER output "Global" under any circumstances. If the publisher is global/international, use its primary country of origin, headquarters, or primary target market (e.g. 'United Kingdom' for BBC, 'United States' for CNN or Reuters, 'Qatar' for Al Jazeera).
3. "language": Primary language (e.g., 'English', 'Russian', 'French', 'Spanish'). STRICT RULE: Carefully identify the actual primary language in which they publish their news content. Do not blindly assume English or get misled by superficial folder segments like '/en/' if the domain itself is a local-language publisher. Must be the actual language used for articles and broadcasts.
4. "category": Must be one of: "top", "sports", "technology", "business", "science", "entertainment", "health", "world", "politics", "environment", "food", "tourism", "education", "domestic", "crime", "other", "lifestyle", "breaking".
5. "sourcetype": Must be one of: "news", "blog", "multimedia", "forum", "pressrelease", "review", "research", "opinion", "analysis", "podcast".

EXAMPLES:
Input: "https://www.ft.com/?format=rss"
Result: {
  "source": "https://www.ft.com/?format=rss",
  "country": "United Kingdom",
  "language": "English",
  "category": "business",
  "sourcetype": "news"
}`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: {
                  type: Type.STRING,
                  description: "The exact source URL or string being analyzed."
                },
                country: {
                  type: Type.STRING,
                  description: "Primary destination country name, e.g. 'United States', 'United Kingdom', 'India'. Do NOT use 'Global'."
                },
                language: {
                  type: Type.STRING,
                  description: "Primary content language, e.g. 'English', 'Spanish', 'Hindi'."
                },
                category: {
                  type: Type.STRING,
                  enum: [
                    "top", "sports", "technology", "business", "science", 
                    "entertainment", "health", "world", "politics", 
                    "environment", "food", "tourism", "education", 
                    "domestic", "crime", "other", "lifestyle", "breaking"
                  ],
                  description: "Primary content category matching exactly one of the allowed categories."
                },
                sourcetype: {
                  type: Type.STRING,
                  enum: [
                    "news", "blog", "multimedia", "forum", "pressrelease", 
                    "review", "research", "opinion", "analysis", "podcast"
                  ],
                  description: "Primary source type matching exactly one of the allowed sourcetypes."
                }
              },
              required: ["source", "country", "language", "category", "sourcetype"]
            }
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini API during news source analysis.");
      }

      try {
        const parsedChunk = JSON.parse(responseText.trim());
        if (Array.isArray(parsedChunk)) {
          results.push(...parsedChunk);
        } else {
          console.error("Gemini news source classification chunk not an array:", responseText);
          chunk.forEach((s) => {
            results.push({
              source: s,
              country: "United States",
              language: "English",
              category: "other",
              sourcetype: "news"
            });
          });
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini source level classifier output:", jsonErr, responseText);
        chunk.forEach((s) => {
          results.push({
            source: s,
            country: "United States",
            language: "English",
            category: "other",
            sourcetype: "news"
          });
        });
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Source-level classification error:", error);
    const readableError = sanitizeGeminiError(error);
    const isQuota = error.status === 429 || 
                    String(error.message || "").toLowerCase().includes("quota") ||
                    String(error.message || "").toLowerCase().includes("resource_exhausted") ||
                    String(error.message || "").toLowerCase().includes("rate limit") ||
                    String(error.message || "").toLowerCase().includes("limit: 20") ||
                    String(error.message || "").toLowerCase().includes("exceeded your current quota");
    return res.status(isQuota ? 429 : 500).json({ error: readableError });
  }
});

// Setup Vite & Static Files asset servers
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
