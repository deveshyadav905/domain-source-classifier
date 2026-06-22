import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider
} from "firebase/auth";
import { 
  getFirestore 
} from "firebase/firestore";
import config from "../../firebase-applet-config.json";

// Read from dynamic window.FIREBASE_CONFIG or import.meta.env, falling back to firebase-applet-config.json
const windowConfig = (typeof window !== "undefined" && (window as any).FIREBASE_CONFIG) || {};

const metaEnv = (import.meta as any).env || {};

function cleanConfigValue(val: any): string {
  if (val === undefined || val === null) return "";
  let str = String(val).trim();
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

const rawApiKey = windowConfig.apiKey || metaEnv.VITE_FIREBASE_API_KEY || config.apiKey;
const rawAuthDomain = windowConfig.authDomain || metaEnv.VITE_FIREBASE_AUTH_DOMAIN || config.authDomain;
const rawProjectId = windowConfig.projectId || metaEnv.VITE_FIREBASE_PROJECT_ID || config.projectId;
const rawStorageBucket = windowConfig.storageBucket || metaEnv.VITE_FIREBASE_STORAGE_BUCKET || config.storageBucket;
const rawMessagingSenderId = windowConfig.messagingSenderId || metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || config.messagingSenderId;
const rawAppId = windowConfig.appId || metaEnv.VITE_FIREBASE_APP_ID || config.appId;

const firebaseConfig = {
  apiKey: cleanConfigValue(rawApiKey),
  authDomain: cleanConfigValue(rawAuthDomain),
  projectId: cleanConfigValue(rawProjectId),
  storageBucket: cleanConfigValue(rawStorageBucket),
  messagingSenderId: cleanConfigValue(rawMessagingSenderId),
  appId: cleanConfigValue(rawAppId)
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const customDbId = (config as any).firestoreDatabaseId || (windowConfig as any).firestoreDatabaseId;
export const db = customDbId 
  ? getFirestore(app, customDbId)
  : getFirestore(app, "ai-studio-3aaaed14-abc7-45a7-9842-d91be2e74bd2");
