// Configuração do projeto Firebase (Console > Configurações do projeto > Seus apps > Web).
// Não é segredo: vai junto com o site. Quem protege os dados é o firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCiUoqaCre2eLewGDfDULi0ywnF7jbEjUk",
  authDomain: "mistureba-27832.firebaseapp.com",
  projectId: "mistureba-27832",
  storageBucket: "mistureba-27832.firebasestorage.app",
  messagingSenderId: "269249622557",
  appId: "1:269249622557:web:160e619f8acdaebb828cf4",
};

// Região das Cloud Functions (São Paulo)
export const functionsRegion = "southamerica-east1";

// Rodando em localhost (npm run dev) o app usa os emuladores, com dados de teste
// separados do projeto real. Pra apontar o localhost pro projeto real: ?prod
export const useEmulators =
  ["localhost", "127.0.0.1"].includes(location.hostname) && !new URLSearchParams(location.search).has("prod");
