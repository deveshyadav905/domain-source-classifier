import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider
} from "firebase/auth";
import { 
  getFirestore 
} from "firebase/firestore";
import config from "../../firebase-applet-config.json";

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = (config as any).firestoreDatabaseId 
  ? getFirestore(app, (config as any).firestoreDatabaseId)
  : getFirestore(app, "ai-studio-3aaaed14-abc7-45a7-9842-d91be2e74bd2");
