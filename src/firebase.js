import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent, setAnalyticsCollectionEnabled } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCdAFT7prK4M5C-IxPvMT2W6-QNARzM9aQ",
  authDomain: "arrow-escape-puzzle-master.firebaseapp.com",
  projectId: "arrow-escape-puzzle-master",
  storageBucket: "arrow-escape-puzzle-master.firebasestorage.app",
  messagingSenderId: "721873930529",
  appId: "1:721873930529:web:f066e9d428476f96782d668",
  measurementId: "G-2849E5YQNB",
};

let analytics = null;

export function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    analytics = getAnalytics(app);
    // Disable automatic page_view events — Capacitor WebView treats
    // every screen change as a page view, which floods the dashboard
    // with useless data. We track only what matters manually.
    setAnalyticsCollectionEnabled(analytics, true);
    console.log("[firebase] ready");
  } catch (e) {
    console.warn("[firebase] init failed:", e);
  }
}

export function track(event, params) {
  try {
    if (analytics) logEvent(analytics, event, params || {});
  } catch {}
}
