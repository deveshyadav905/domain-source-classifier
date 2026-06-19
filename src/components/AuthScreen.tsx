import React, { useState } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInAnonymously
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { Sparkles, Mail, Lock, AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface AuthScreenProps {
  onAuthSuccess: (user: any) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authNotAllowed, setAuthNotAllowed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    setError(null);
    setAuthNotAllowed(false);
    setLoading(true);

    try {
      if (isSignUp) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        onAuthSuccess(credential.user);
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        onAuthSuccess(credential.user);
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      const message = err.message || "";
      if (message.includes("auth/operation-not-allowed")) {
        setAuthNotAllowed(true);
        setError("Firebase Authentication providers (Email/Password) are not enabled yet in your Firebase Project Console.");
      } else if (message.includes("auth/invalid-credential")) {
        setError("Invalid email or password.");
      } else if (message.includes("auth/email-already-in-use")) {
        setError("This email is already registered.");
      } else if (message.includes("auth/weak-password")) {
        setError("Password must be at least 6 characters.");
      } else {
        setError(err.message || "An unexpected error occurred during auth.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError(null);
    setAuthNotAllowed(false);
    setLoading(true);
    try {
      const credential = await signInAnonymously(auth);
      onAuthSuccess(credential.user);
    } catch (err: any) {
      console.error("Guest Auth error:", err);
      const message = err.message || "";
      if (message.includes("auth/operation-not-allowed")) {
        setAuthNotAllowed(true);
        setError("Firebase Authentication provider (Anonymous Sign-In) is not enabled yet in your Firebase Project Console.");
      } else {
        setError(err.message || "An unexpected error occurred during guest login.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBypassSandboxMode = () => {
    onAuthSuccess({
      uid: "offline_sandbox_bypass_user",
      email: "Guest Sandbox Developer"
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-slate-150 rounded-2xl shadow-lg overflow-hidden flex flex-col">
        {/* Decorative Top header */}
        <div className="bg-gradient-to-r from-indigo-700 to-rose-700 p-8 text-center text-white relative">
          <div className="absolute right-4 top-4 bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Enterprise Cache v2
          </div>
          <div className="mx-auto h-12 w-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 mb-3 shadow-md">
            <Sparkles className="h-6 w-6 text-yellow-300" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Publisher Analysis Platform</h1>
          <p className="text-white/80 text-[11px] mt-1.5 font-medium">
            AI-Driven Classification with Real-Time Global Cache Persistence
          </p>
        </div>

        {/* Content Form */}
        <div className="p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 text-center">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
              {isSignUp ? "Create Workspace Account" : "Sign In to Your Workspace"}
            </h2>
            <p className="text-[11px] text-gray-500">
              {isSignUp 
                ? "Sign up to track validation performance, view logs, and save server costs" 
                : "Enter your developer or editor credentials to access the classification systems"}
            </p>
          </div>

          {error && (
            <div className="space-y-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-800 flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <div className="break-all leading-normal font-semibold text-left">{error}</div>
              </div>

              {authNotAllowed && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-3 leading-relaxed text-left">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800 text-xs uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                    How to enable Sign-in in Firebase:
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 font-medium text-amber-950">
                    <li>Go to your <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="underline font-bold text-indigo-700 hover:text-indigo-900">Firebase Console</a></li>
                    <li>Click <span className="font-bold">Build &gt; Authentication</span> in the sidebar.</li>
                    <li>Go to the <span className="font-bold">Sign-in method</span> tab.</li>
                    <li>Click <span className="font-bold">Add new provider</span> and enable <span className="font-bold">Email/Password</span> and <span className="font-bold">Anonymous</span>.</li>
                  </ol>
                  <div className="pt-2.5 border-t border-amber-200/50">
                    <button
                      type="button"
                      onClick={handleBypassSandboxMode}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
                    >
                      🚀 Bypass Auth &amp; Enter Developer Sandbox
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-xs rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 focus:outline-hidden bg-slate-50/50 text-gray-800"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-xs rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 focus:outline-hidden bg-slate-50/50 text-gray-800"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-700 hover:bg-indigo-850 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white/80" />
                  Authenticating...
                </>
              ) : (
                <>
                  {isSignUp ? "Generate Account" : "Access Workspace"}
                </>
              )}
            </button>
          </form>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink mx-3 text-[10px] text-gray-400 font-bold uppercase tracking-wider">Alternative</span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGuestLogin}
              disabled={loading}
              className="w-full py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              Enter as Anonymous Developer (Guest mode)
            </button>

            <button
              type="button"
              onClick={handleBypassSandboxMode}
              className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
            >
              🚀 Skip Auth &amp; Enter Sandbox Mode
            </button>
          </div>

          <p className="text-[11px] text-center text-gray-500">
            {isSignUp ? "Already have a developer account?" : "Need a workspace account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setAuthNotAllowed(false);
              }}
              className="text-indigo-600 hover:underline font-bold transition-all cursor-pointer"
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </div>

        {/* Security / System compliance Footer */}
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-between text-[10px] text-gray-400">
          <span className="font-semibold flex items-center gap-1">
            <RefreshCw className="h-3 w-3 text-emerald-500" /> Cache hit rate optimization live
          </span>
          <span>SSL Secure Auth</span>
        </div>
      </div>
    </div>
  );
}
