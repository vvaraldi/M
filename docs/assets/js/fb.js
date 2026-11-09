// Firebase initialisation and the few helpers shared by the portal and the admin page.
// The SDK version is pinned (13.2.0, the version the Firebase console gave us).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, isSignInWithEmailLink, sendSignInLinkToEmail,
  signInWithEmailLink, signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  writeBatch, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js";
import { firebaseConfig, DATABASE_ID } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, DATABASE_ID);

export {
  onAuthStateChanged, signOut, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, writeBatch, serverTimestamp, query, where
};

/** Call a Cloud Function (region us-central1). Resolves with the function's result, rejects with an error that has .code and .details. */
export async function callFn(name, data) {
  const res = await httpsCallable(getFunctions(app, "us-central1"), name)(data);
  return res.data;
}

const EMAIL_KEY = "emailForSignIn";

/** URL of the portal home page (folder of the current page), used as the sign-in link target. */
export function portalHome() {
  return location.origin + location.pathname.replace(/[^/]*$/, "");
}

/** Send a sign-in link. `rememberOnThisDevice` is false when the admin sends one to somebody else. */
export async function sendLink(email, lang, rememberOnThisDevice = true) {
  auth.languageCode = lang || "en";
  await sendSignInLinkToEmail(auth, email, { url: portalHome(), handleCodeInApp: true });
  if (rememberOnThisDevice) {
    try { localStorage.setItem(EMAIL_KEY, email); } catch (e) { /* private mode: the user will retype it */ }
  }
}

export function openedFromEmailLink() {
  return isSignInWithEmailLink(auth, location.href);
}

/**
 * Complete a sign-in when the page was opened from an emailed link.
 * `askEmail` is called when the link was opened on a different device than the one that asked for it.
 * Returns null on success, or an error code string.
 */
export async function completeEmailLink(askEmail) {
  try {
    // A link always signs in as the person it was sent to. If somebody else is already signed in on this
    // browser (for example the owner testing a shop's link), sign them out first instead of mixing sessions.
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    if (auth.currentUser) await signOut(auth);

    let email = null;
    try { email = localStorage.getItem(EMAIL_KEY); } catch (e) { /* ignore */ }
    if (!email) email = await askEmail(false);
    if (!email) return "cancelled";

    for (let attempt = 0; ; attempt++) {
      try {
        await signInWithEmailLink(auth, email.trim(), location.href);
        try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* ignore */ }
        return null;
      } catch (e) {
        const code = e && e.code ? e.code : "unknown";
        if (code === "auth/invalid-email" && attempt === 0) {
          // The remembered address is not the one this link was sent to: let the person type the right one.
          try { localStorage.removeItem(EMAIL_KEY); } catch (err) { /* ignore */ }
          email = await askEmail(true);
          if (!email) return "cancelled";
          continue;
        }
        return code;
      }
    }
  } finally {
    history.replaceState({}, document.title, location.pathname); // drop the one-time code from the address bar
  }
}

export const emailKey = (email) => String(email || "").trim().toLowerCase();
