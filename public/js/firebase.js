// Inicialização do Firebase (SDK modular via CDN — sem build).
const V = "12.3.0";
const base = `https://www.gstatic.com/firebasejs/${V}`;

const appMod = await import(`${base}/firebase-app.js`);
const authMod = await import(`${base}/firebase-auth.js`);
const fsMod = await import(`${base}/firebase-firestore.js`);
const fnMod = await import(`${base}/firebase-functions.js`);

import { firebaseConfig as realConfig, functionsRegion, useEmulators } from "./firebase-config.js";

// Nos emuladores o projeto é "demo-mistureba" (dados locais, nunca toca o projeto real)
const firebaseConfig = useEmulators ? { ...realConfig, apiKey: "demo-key", projectId: "demo-mistureba", authDomain: "demo-mistureba.firebaseapp.com" } : realConfig;
export const isEmulator = useEmulators;

export const app = appMod.initializeApp(firebaseConfig);
export const auth = authMod.getAuth(app);

// Cache offline persistente: o PDV continua vendendo se a internet cair,
// e tudo sincroniza sozinho quando a conexão volta.
let db;
try {
  db = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
  });
} catch {
  db = fsMod.getFirestore(app);
}
export { db };
export const functions = fnMod.getFunctions(app, functionsRegion);

if (isEmulator) {
  const host = location.hostname || "127.0.0.1";
  authMod.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, host, 8080);
  fnMod.connectFunctionsEmulator(functions, host, 5001);
}

export const fb = { ...authMod, ...fsMod, ...fnMod, initializeApp: appMod.initializeApp, deleteApp: appMod.deleteApp };
export { firebaseConfig };
