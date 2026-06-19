import { BookOpen, Key, Link2, ArrowRight } from "lucide-react";

interface SetupInstructionsProps {
  googleClientId: string;
  onSaveClientId: (id: string) => void;
}

export default function SetupInstructions({
  googleClientId,
  onSaveClientId,
}: SetupInstructionsProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs">
        <h2 className="text-xl font-display font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-indigo-600" />
          Setup and Operational Guide
        </h2>
        <p className="text-gray-600 text-sm">
          Follow these quick steps to load your domains, run the automated Gemini classifier, and optionally save the results back directly into your Google Sheet.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Section A: Loading Domains */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-xs text-indigo-600 font-bold">1</span>
              Load Domains (Instantly)
            </h3>
            <div className="p-4 bg-gray-50 rounded-xl space-y-3 text-xs text-gray-600 leading-relaxed border border-gray-100">
              <p className="flex items-start gap-1">
                <Link2 className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                <span>
                  <strong>Share configuration:</strong> Open your Google Sheet, click <strong>Share</strong>, and set General Access to <strong>"Anyone with the link can view"</strong> (or Edit).
                </span>
              </p>
              <p className="flex items-start gap-1">
                <ArrowRight className="h-3 w-4 text-gray-400 mt-0.5 shrink-0" />
                <span>
                  <strong>Paste and Load:</strong> Paste the spreadsheet URL in the main bar. The app parses the Spreadsheet ID and sheet ID (GID) automatically and downloads the list in 1 second!
                </span>
              </p>
            </div>
          </div>

          {/* Section B: Saving Back to Google Sheet */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-xs text-emerald-600 font-bold">2</span>
              Save Results Back to Google Sheet
            </h3>
            <div className="p-4 bg-gray-50 rounded-xl space-y-3 text-xs text-gray-600 leading-relaxed border border-gray-100">
              <p>
                To allow the application to write back/mutate your Google Sheet, you can easily provide a temporary Google OAuth token or standard OAuth flow.
              </p>
              <p>
                Alternatively, you can always export the results as a clean <strong>CSV file</strong> to import back directly via <em>File &gt; Import</em> in Google Sheets.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs space-y-4">
        <h3 className="text-md font-display font-semibold text-gray-900 flex items-center gap-2">
          <Key className="h-4 w-4 text-indigo-600" />
          Google Cloud Project Integration (Web Write)
        </h3>
        <p className="text-xs text-gray-600 leading-relaxed">
          Google Sheets updates are made securely from your browser using direct OAuth 2.0. If you wish to use the 1-click Google Auth popup, configure your Google Cloud Console Client ID. This is saved safely only in your browser's local state.
        </p>

        <div className="space-y-3 pt-2">
          <label className="block text-xs font-medium text-gray-700">Google OAuth 2.0 Web Client ID</label>
          <div className="flex gap-2 max-w-xl">
            <input
              type="text"
              placeholder="e.g. 1234567-abcdefg.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => onSaveClientId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
            />
          </div>
          <div className="p-3 bg-indigo-50/50 rounded-lg text-[11px] text-indigo-800 space-y-1">
            <p className="font-medium">How to get a Client ID in 1 minute:</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>Go to the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline font-semibold">Google Cloud Credentials Console</a>.</li>
              <li>Click <strong>Create Credentials</strong> &gt; <strong>OAuth client ID</strong>.</li>
              <li>Select Application Type: <strong>Web Application</strong>.</li>
              <li>Add Authorizations: Under <strong>Authorized JavaScript origins</strong> add <code>{window.location.origin}</code>.</li>
              <li>Under <strong>Authorized redirect URIs</strong> add <code>{window.location.origin}</code>.</li>
              <li>Click Create and paste your Client ID above to enable fluid 1-click Google write back!</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
