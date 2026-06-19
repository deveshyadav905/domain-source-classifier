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

// Endpoint to fetch public Google Sheet as CSV
app.get("/api/fetch-sheet", async (req, res) => {
  try {
    const { spreadsheetId, gid } = req.query;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId parameter is required." });
    }
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
    
    const headers: Record<string, string> = {
      "User-Agent": "aistudio-build",
    };
    if (req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorStatus = response.status;
      return res.status(errorStatus === 401 ? 401 : 400).json({
        error: `Failed to fetch sheet (HTTP ${errorStatus}). ${
          errorStatus === 401 
            ? "Your Google Access Token is missing, expired, or invalid. Please click 'Connect Google Docs' or paste a valid Token."
            : errorStatus === 403
              ? "Access denied. Make sure you have authorized permissions/access to this spreadsheet."
              : "Make sure the Google Sheet is shared with 'Anyone with the link can view' permission, or authenticate to access it."
        }`,
      });
    }
    const csvText = await response.text();
    return res.json({ success: true, csv: csvText });
  } catch (error: any) {
    console.error("Fetch-sheet error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch spreadsheet. Check server connection." });
  }
});

// Initialize the server-side Gemini client
let ai: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
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

        if (isQuotaExceeded) {
          console.warn(`Quota or Rate limit exceeded on ${model}. Swapping to the next fallback model immediately...`);
          break; // Break inner loop of this model to try the next model instantly
        }

        const isTransient = code === 503 || 
                            msg.includes("503") || 
                            msg.includes("unavailable") || 
                            msg.includes("high demand") || 
                            msg.includes("spikes in demand") ||
                            msg.includes("overloaded") ||
                            msg.includes("temporary");

        if (isTransient && attempt < retries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`Transient busy error on ${model} (attempt ${attempt + 1}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(`Attempt ${attempt + 1} with ${model} failed or reached max attempts: ${err.message}`);
          break; // Stop retrying this model, proceed to the fallback model if any
        }
      }
    }
  }

  throw lastError;
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

app.post("/api/classify", async (req, res) => {
  try {
    const { domains } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: "Missing or invalid domains array." });
    }

    const gemini = getGemini();

    // Split domains into chunks of 25 to avoid token or rate limitations
    const CHUNK_SIZE = 25;
    const results = [];

    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
      const chunk = domains.slice(i, i + CHUNK_SIZE);
      const prompt = `Classify the following list of domains.
For each domain, identify:
1. Category - Must be strictly one of: "e-commerce", "technology", "blogs", or "other" (representing other generic/specific websites outside these three).
2. Is the domain a News publisher? - Must be strictly "Yes" or "No".
3. A brief explanation/reasoning of 1 short sentence why it was categorized this way.

Domains to classify:
${chunk.map((d) => `- ${d}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an expert domain classifier. For each domain provided in the prompt, identify its category ("e-commerce", "technology", "blogs", "other") and whether it is a News publisher ("Yes" or "No"). Keep your reasonings clear, objective, and short (maximum 1 sentence). If a domain is inactive, classify based on its standard historical or industry category, or classify as "other" if unknown. Ensure you return exactly one classification object for every single domain in the input list. Do not omit any domains.`,
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
                category: {
                  type: Type.STRING,
                  description: "Must be strictly one of: 'e-commerce', 'technology', 'blogs', 'other'.",
                },
                isNewsPublisher: {
                  type: Type.STRING,
                  description: "Must be strictly 'Yes' or 'No'. Yes if they publish daily/frequent current news stories/articles.",
                },
                reasoning: {
                  type: Type.STRING,
                  description: "A very brief, 1-sentence description/explanation of the classification.",
                },
              },
              required: ["domain", "category", "isNewsPublisher", "reasoning"],
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
              category: "other",
              isNewsPublisher: "No",
              reasoning: "Failed to parse classification chunk",
            });
          });
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini output", jsonErr, responseText);
        chunk.forEach((d) => {
          results.push({
            domain: d,
            category: "other",
            isNewsPublisher: "No",
            reasoning: "Invalid JSON response from model",
          });
        });
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Classification error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/validate-news-source", async (req, res) => {
  try {
    const { domains } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: "Missing or invalid domains array." });
    }

    const gemini = getGemini();
    const results = [];
    const CHUNK_SIZE = 25;

    for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
      const chunk = domains.slice(i, i + CHUNK_SIZE);
      const prompt = `Identify, find and validate news publisher feed sources & geographic/language metadata for the following domains.
For each domain, provide:
1. Primary target Country (e.g. "United States", "India", "Germany", "Global")
2. Main publishing Language (e.g. "English", "Spanish", "German")
3. Suggested/standard RSS or Feed URL path representing their content updates (e.g. "https://domain.com/feed", "https://domain.com/rss.xml", or best estimate)
4. Suggested Sitemap XML URL (e.g. "https://domain.com/sitemap.xml", "https://domain.com/sitemap_index.xml", or best estimate)
5. Fine-grained News Sub-Categorization (e.g. "General News", "Technology Journalism", "Local Politics", "Sports News", "Financial & Business", "Lifestyle & Entertainment", "Other")

Domains to analyze:
${chunk.map((d) => `- ${d}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an expert news publication analyzer. For each domain provided, find/estimate its target audience country, primary language, standard RSS/Feed URL endpoint, Sitemap XML endpoint, and fine-grained news sub-category. Return structural JSON matching the required schema. Ensure every single input domain receives exactly one result object in the return array. Do not miss any domains from the chunk.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                domain: {
                  type: Type.STRING,
                  description: "The exact domain being analyzed (e.g. example.com)."
                },
                country: {
                  type: Type.STRING,
                  description: "Full primary destination country name, e.g. 'United States', 'Global', 'India'."
                },
                language: {
                  type: Type.STRING,
                  description: "Primary content language, e.g. 'English', 'Spanish', 'Hindi'."
                },
                rssUrl: {
                  type: Type.STRING,
                  description: "Standard absolute path to RSS feed or content feed (e.g. 'https://domain.com/feed' or 'https://domain.com/rss')."
                },
                sitemapUrl: {
                  type: Type.STRING,
                  description: "Standard sitemap URL (e.g. 'https://domain.com/sitemap.xml')."
                },
                newsCategory: {
                  type: Type.STRING,
                  description: "Specific focus, e.g., 'Politics', 'Financial & Business', 'Technology Journalism', 'Sports', 'General News'."
                }
              },
              required: ["domain", "country", "language", "rssUrl", "sitemapUrl", "newsCategory"]
            }
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response received from Gemini API during news metadata discovery.");
      }

      try {
        const parsedChunk = JSON.parse(responseText.trim());
        if (Array.isArray(parsedChunk)) {
          results.push(...parsedChunk);
        } else {
          console.error("Gemini news source analysis chunk not an array:", responseText);
          chunk.forEach((d) => {
            results.push({
              domain: d,
              country: "Global",
              language: "English",
              rssUrl: `https://${d}/feed`,
              sitemapUrl: `https://${d}/sitemap.xml`,
              newsCategory: "General News"
            });
          });
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini news source output:", jsonErr, responseText);
        chunk.forEach((d) => {
          results.push({
            domain: d,
            country: "Global",
            language: "English",
            rssUrl: `https://${d}/feed`,
            sitemapUrl: `https://${d}/sitemap.xml`,
            newsCategory: "General News"
          });
        });
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("News source metadata discovery error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/classify-source", async (req, res) => {
  try {
    const { sources } = req.body;
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: "Missing or invalid sources array." });
    }

    const gemini = getGemini();
    const results = [];
    const CHUNK_SIZE = 25;

    for (let i = 0; i < sources.length; i += CHUNK_SIZE) {
      const chunk = sources.slice(i, i + CHUNK_SIZE);
      const prompt = `Identify and classify the geographic/language target metadata and news/content category for the following feed sources or URLs.
These represent direct content sources (RSS feeds, sitemap indexes, content streams, or dedicated channels).
For each source URL, determine:
1. Primary target Country (e.g. "United States", "India", "Germany", "Global", "United Kingdom", "France", etc.)
2. Main content Language (e.g. "English", "Spanish", "German", "Hindi", "French", etc.)
3. Fine-grained Content/News Category (e.g. "Technology & Innovation", "Financial & Markets", "General News", "Sports & Athletics", "Health & Wellness", "Politics", "Lifestyle & Entertainment", "Other")

Sources to classify:
${chunk.map((s) => `- ${s}`).join("\n")}`;

      const response = await generateContentWithRetry(gemini, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are an expert news and media analyst. For each provided content source / RSS URL, determine its primary target audience country, main language, and fine-grained news sub-category. Return structural JSON matching the required schema. Ensure every single input source receives exactly one result object in the return array. Do not miss any source from the chunk.`,
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
                  description: "Primary destination country name, e.g. 'United States', 'Global', 'India'."
                },
                language: {
                  type: Type.STRING,
                  description: "Primary content language, e.g. 'English', 'Spanish', 'Hindi'."
                },
                category: {
                  type: Type.STRING,
                  description: "Specific news/content sub-category, e.g., 'Politics', 'Financial & Markets', 'Technology & Innovation', 'Sports & Athletics', 'General News'."
                }
              },
              required: ["source", "country", "language", "category"]
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
              country: "Global",
              language: "English",
              category: "General News"
            });
          });
        }
      } catch (jsonErr) {
        console.error("JSON parsing error on Gemini source level classifier output:", jsonErr, responseText);
        chunk.forEach((s) => {
          results.push({
            source: s,
            country: "Global",
            language: "English",
            category: "General News"
          });
        });
      }
    }

    return res.json({ success: true, results });
  } catch (error: any) {
    console.error("Source-level classification error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
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
