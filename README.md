# Domain Classifier 🌐📊

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Gemini_API-8E75C2?style=for-the-badge&logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
</p>

An enterprise-ready, high-performance, full-stack domain intelligence and bulk classification platform. This application integrates **Google Sheets**, the **Gemini AI API**, the **Tranco Domain Popularity Rank API**, and **Firebase** into a cohesive system designed to load, validate, categorize, and enrich bulk domains and content syndication feeds with dynamic caching and speed-boosted parallel processing.

---

## 🗺️ System Architecture

The following diagram illustrates the flow of data through the high-performance pipeline, featuring dual-layer caching, background parallelization, and model-fallback mechanics:

```text
┌────────────────────────────────────────────────────────┐
│                   React 18 Dashboard                   │
│  - Interactive Data Grid     - Recharts Visualizations │
│  - Dual-Mode Filtering       - Dynamic Google Sheet UI │
└───────────┬────────────────────────────────▲───────────┘
            │ 1. Import / Run                │ 6. Real-time updates
            ▼                                │    & State Refresh
┌────────────────────────────────────────────┴───────────┐
│              Express Backend (server.ts)               │
│  - Concurrent Chunking       - Multi-Model Fallbacks  │
│  - Token Optimization        - Response Validation    │
└───────────┬────────────────────────────────▲───────────┘
            ├───────────────┐                │ 5. Returns
            │ (On Cache Hit)│                │    Merged Meta
            ▼               ▼                │
┌───────────────────────┐ ┌──────────────────┴───────────┐
│     Firebase DB       │ │        Gemini API Client     │
│   & Local Cache       │ │  - Primary: gemini-3.5-flash │
│  - Real-time caching  │ │  - Fallback: 3.1-flash-lite │
│  - High-speed lookup  │ │  - Parallel chunks of 50    │
└───────────────────────┘ └──────────────────────────────┘
            ▲                                ▲
            │ 2. Miss? Query AI              │ 3. Fetch Domain Context
            └────────────────────────────────┴───────────────┐
                                                             ▼
                                                    ┌─────────────────┐
                                                    │   Tranco API    │
                                                    │ - Popularity    │
                                                    │ - Traffic Rank  │
                                                    └─────────────────┘
```

---


## 🚀 Key Services & Features

The Domain Classifier application provides a robust suite of server-side data extraction, enhancement, and validation modules:

### 1. Google Sheets Integration (`/api/fetch-sheet`)
*   **Direct OAuth Handshakes:** Supports secure reading of private spreadsheets using standard Bearer authentication tokens passed directly to the Google Sheets REST API.
*   **Multi-Stage Fallbacks:** If token-based authorization fails or expires, the backend automatically tries to fetch public CSV exports, retries anonymously, or queries the **Google GViz Visualization API** endpoint to maximize spreadsheet retrieval success.
*   **Tab-Level Switching:** Fully supports targeted worksheets by querying specific sheet indices (`gid` values).

### 2. Batch Domain-Level Intelligence (`/api/classify`)
*   **Advanced Extraction:** Classifies groups of domains (chunked safely in groups of 100 to prevent API token limits) using state-of-the-art **Gemini 3.5 Flash** models.
*   **Metadata Fields:** For every target domain, the AI system extracts:
    *   **Site Name:** The clean domain host string formatted in Title Case *without* its Top Level Domain (TLD) suffix (e.g., `'Kaktus'` for `kaktus.media`).
    *   **Display Name:** The official, fully-expanded corporate or organizational title (e.g., `'British Broadcasting Corporation'` instead of `BBC`).
    *   **Description:** A precise, polished site description explaining its services or market focus.
    *   **Category:** Standardized into `e-commerce`, `technology`, `blogs`, or `other`.
    *   **Webpage Type:** Classified into standard purposes such as `News Publisher`, `University / Education`, `Product Website`, `Organization`, `Blog`, `Corporate / Company`, `Government`, `E-commerce`, `Social Media / Forum`, or `Other`.
    *   **Reasoning:** A single, concise sentence justifying the classification.

### 3. Feed & Source-Level Classification (`/api/classify-source`)
*   **Geographic Target Determination:** Detects primary target audiences and origin countries without defaulting to generic "Global" values, identifying exact headquarters or headquarters' regions.
*   **Native Language Analysis:** Inspects domain directories, TLD flags, and feed paths to identify the exact language published by the news outlet rather than naively assuming English.
*   **Content Categories & Syndication Types:** Maps URLs and RSS feeds to exact taxonomies (e.g., `business`, `sports`, `politics`, `multimedia`, `podcast`, `pressrelease`).

### 4. Tranco Popularity Rankings (`/api/tranco`)
*   **Domain Authority Queries:** Queries the Tranco popularity database in real-time to fetch traffic rank values and rank dates for input domains.
*   **Polite Scraping Constraints:** Enforces internal throttling delays (300ms) to respect external API rate limiting.

### 5. High-Availability AI Resilience & Fallbacks
*   **Exponential Retry Backoffs:** Protects against transient upstream AI issues by automatically making up to 3 retries with custom delay intervals.
*   **Dynamic Model Cascading:** Automatically switches models on quota exhaustion:
    1.  `gemini-3.5-flash` (Primary)
    2.  `gemini-3.1-flash-lite` (Fallback)
    3.  `gemini-flash-latest` (Secondary Fallback)
*   **Intelligent Error Sanitization:** Transforms opaque API errors into clear, actionable advice (e.g., informing users to provide their own developer API Key under the *Settings > Secrets* panel).

### 6. Interactive Visualizations & Analytics
*   **Responsive Charts:** Incorporates highly detailed **Recharts** dashboard visualization panels showing real-time distribution charts for category, webpage type, and geographic origin of parsed files.

---

## 🏗️ Architecture & Project Structure

The codebase is split into an Express + Node.js backend server and a Vite-driven React client:

```text
├── server.ts                       # Express backend (API endpoints & Vite middleware proxy)
├── package.json                    # Application dependencies and build scripts
├── metadata.json                   # Applet permissions, name, and capability manifest
├── .env.example                    # Sample configuration template for environment variables
├── src/
│   ├── main.tsx                    # React client entrypoint
│   ├── App.tsx                     # Primary client layout and application state orchestrator
│   ├── index.css                   # Global styles and Tailwind v4 themes
│   ├── types.ts                    # Global shared TypeScript schemas and enum declarations
│   └── components/                 # Extracted UI blocks
│       ├── AuthScreen.tsx          # Google & Firebase Authentication overlay
│       ├── DomainTable.tsx         # Highly Interactive Data Grid with filtering, sorting, & exports
│       ├── Header.tsx              # Navigation bar, sheet selector, and status indicators
│       ├── HistoryScreen.tsx       # Saved historical runs loaded from cache / databases
│       ├── SetupInstructions.tsx   # Visual guides on setting up and loading sheets
│       └── VisualCharts.tsx        # Responsive analytics charts powered by Recharts
```

---

## 🛠️ Installation & Setup Process

Follow these steps to run the application in your local environment.

### 1. Prerequisites
Ensure you have the following installed on your machine:
*   **Node.js** (v18.0.0 or higher recommended)
*   **npm** (comes packaged with Node.js)

### 2. Installation
Clone the repository or navigate to the project directory, then install all required packages:

```bash
# Clone the repository (if applicable) or enter workspace
cd domain-classifier

# Install dependencies from package.json
npm install
```

### 3. Application Setup (Environment Variables)
Copy the example environment file to create your own configuration:

```bash
cp .env.example .env
```

Open `.env` and fill in the required credentials:

```env
# Required for Gemini AI classifications. Add your API key here:
GEMINI_API_KEY="AI_Studio_or_Google_Makersuite_Key"

# Optional: Firebase credentials for storing/retrieving database caches
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

---

## ⚙️ Running the Application

This platform supports separate execution modes for development and production build systems.

### Development Mode
Boot the server directly in development mode using `tsx`. The server will automatically mount Vite as middleware and serve the React application on **port 3000** with Hot Module Replacement (HMR) capabilities.

```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### Production Build & Launch
Build the React frontend assets and compile the `/server.ts` TypeScript backend into a CJS-bundled production file under `dist/server.cjs` utilizing `esbuild`:

```bash
# 1. Compile the frontend and bundle the backend
npm run build

# 2. Launch the optimized standalone server
npm run start
```
The server will boot on port **3000** and serve the static files in `dist/` with optimum production caching.

---

## 🔒 Security & Deployment Notes

*   **Server-Side Proxies:** All sensitive calls to the Gemini API are handled exclusively server-side via `/api/*` endpoints. This ensures your private `GEMINI_API_KEY` is never exposed or downloaded to client browsers.
*   **Lazy Credentials:** The AI SDK validates the environment at the moment of execution. If the default API key is missing, users can input their own temporary key in the UI, which will be safely transferred in the headers of their request.

---

## 🚀 GitHub Searchability & SEO Optimization Guide

To maximize this project's visibility, attract search engine traffic, and make it highly professional for viewers on GitHub, implement the following configurations:

### 1. Configure Search-Friendly Repository Topics
Topics are the tags users search for on GitHub. In your repository homepage, click the **Settings icon** next to **About** and add these specific, high-intent tags:
*   `gemini-api` — Brings in developers searching for Gemini models.
*   `domain-classification` — Targets users looking for domain intelligence tools.
*   `data-enrichment` — Attracts people wanting to clean or enrich sheet data.
*   `google-sheets-integration` — For anyone integrating Sheets with Express/React.
*   `recharts-dashboard` — For developers looking for premium visualization templates.
*   `fullstack-typescript` — For modern Node.js + React stacks.
*   `tranco-rank` — Specific to domain authority integrations.
*   `tailwindcss-v4` — Highlights usage of modern frontend styling.

### 2. Craft a Captivating About Section
Set your GitHub **About** description to something concise, keyword-rich, and benefit-focused:
> 🌐📊 Full-stack Domain Intelligence Platform. Enrich bulk domains with Site Name, Display Name, Category, Page Purpose (e.g. News, Government, Blog), and Tranco Popularity Rankings. Powered by Gemini AI, Google Sheets, React, Express, and Firebase.

### 3. Setup GitHub Pages / Social Preview (OpenGraph Image)
*   **Social Preview:** Go to **Settings > General > Social preview** and upload a high-quality screenshot of the dashboard. This makes the link look incredibly clean and engaging when shared on Twitter, LinkedIn, or Discord.
*   **Vibrant README Screenshot:** If possible, take a screenshot of your interactive Recharts distribution charts and the Domain Table grid, save it to `assets/dashboard-preview.png`, and reference it in this README using `<img src="./assets/dashboard-preview.png" alt="Dashboard Preview" />`.

### 4. Optimize the Google Sheets Integration Setup Guide
*   Keep the **Share Link** instructions clear.
*   Providing a public sample spreadsheet with 50-100 mixed domains (like `harvard.edu`, `bbc.co.uk`, `github.com`) makes it instantly testable for visitors, encouraging them to star and bookmark the repository.

