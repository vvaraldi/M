// Public Firebase web configuration. These values are NOT secrets: they only tell the browser
// which Firebase project to talk to. Access is protected by sign-in and by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDR2-WT0UABYJYVeO6IFB4ZJBz2LKHsF4k",
  authDomain: "m-dealer-portal.firebaseapp.com",
  projectId: "m-dealer-portal",
  storageBucket: "m-dealer-portal.firebasestorage.app",
  messagingSenderId: "897934453865",
  appId: "1:897934453865:web:8127638c898ac872d346f8"
};

// The Firestore database is NAMED (not "(default)").
export const DATABASE_ID = "m-dealer-db";

// Used only to decide whether to show the admin page; the real check is in firestore.rules.
export const ADMIN_EMAIL = "vincent.varaldi@gmail.com";
