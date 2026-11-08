// Interface text in English, French and Italian + formatting helpers.
// Product names stay as in the catalogue. Wording to be proofread by a native speaker before launch.

export const LANGS = ["en", "fr", "it"];

const S = {
  en: {
    portal: "Dealer portal", sign_out: "Sign out", loading: "Loading…",
    signin_title: "Dealer portal", signin_sub: "Stock, prices and documents for M's partner shops.",
    signin_h: "Sign in", signin_p: "Enter the email address your invitation was sent to. We will email you a one-time sign-in link.",
    email: "Email", email_ph: "you@yourshop.com", send_link: "Email me a sign-in link", sending: "Sending…",
    legal: "By invitation only. Prices and stock are confidential and for the use of M's partner shops.",
    sent_h: "Check your inbox", sent_p: "We sent a sign-in link to {email}. Open it on this device to continue. It can take a minute, and may land in your spam folder.",
    sent_other: "Use another email",
    confirm_h: "Confirm your email", confirm_p: "For your security, please type the email address this sign-in link was sent to.", confirm_btn: "Continue",
    denied_h: "No access yet", denied_p: "{email} is not on the list of invited shops. If you should have access, please contact M.",
    err_email: "Please enter a valid email address.", err_many: "Too many attempts. Please wait a few minutes and try again.",
    err_net: "Network problem. Check your connection and try again.", err_generic: "Something went wrong. Please try again.",
    err_link: "This sign-in link has expired or was already used. Please request a new one.",
    err_mismatch: "That address does not match this link. Please type the address the link was sent to.",
    asof: "Stock as of", pricenote: "Prices in {cur}, before tax.", pricenote_retail: "Retail prices in {cur}, before tax.",
    search_ph: "Search model, size or code", search_lbl: "Search", all_sizes: "All sizes", all_cond: "All conditions", all: "All",
    count_one: "{n} item", count_other: "{n} items", no_results: "No item matches your search.",
    all_brands: "All brands", no_brands: "No brand is enabled for your account yet. Please contact M.",
    none_published: "No stock has been published yet. Please check back soon.", load_err: "The stock could not be loaded. Please reload the page.",
    h_size: "Size", h_cond: "Condition", h_av: "Available", h_price: "Your price",
    price_on_request: "Price on request", est: "est.", est_tip: "Estimated price, not final", msrp: "MSRP",
    contact: "To order or ask a question, contact M:", contact_link: "email M",
    g_ski: "Skis", g_bind: "Bindings", g_skin: "Skins", g_pole: "Poles", g_helmet: "Helmets & goggles", g_pack: "Packs & bottles", g_cloth: "Clothing", g_acc: "Accessories", g_other: "Other",
    cat_Ski: "Skis", cat_Binding: "Bindings", cat_Skin: "Skins", cat_Pole: "Poles", cat_Helmet: "Helmets & goggles", cat_BackPack: "Packs & bottles",
    cat_Clothes: "Clothing", cat_SkinAcc: "Skin accessories", cat_BindingAcc: "Binding parts", cat_PoleAcc: "Pole accessories", cat_HeadLamp: "Headlamps", cat_Bag: "Bags",
    cond_New: "New", cond_Demo: "Demo", cond_Old_graphics: "Old graphics", cond_Defect: "Defect",
    u_pair_one: "pair", u_pair_other: "pairs", u_piece_one: "piece", u_piece_other: "pieces", u_m_one: "m", u_m_other: "m"
  },
  fr: {
    portal: "Portail partenaires", sign_out: "Se déconnecter", loading: "Chargement…",
    signin_title: "Portail partenaires", signin_sub: "Stock, prix et documents pour les magasins partenaires de M.",
    signin_h: "Connexion", signin_p: "Entrez l'adresse courriel utilisée pour votre invitation. Nous vous enverrons un lien de connexion à usage unique.",
    email: "Courriel", email_ph: "vous@votremagasin.com", send_link: "M'envoyer un lien de connexion", sending: "Envoi…",
    legal: "Sur invitation seulement. Les prix et le stock sont confidentiels et réservés aux magasins partenaires de M.",
    sent_h: "Vérifiez votre boîte de réception", sent_p: "Nous avons envoyé un lien de connexion à {email}. Ouvrez-le sur cet appareil pour continuer. Cela peut prendre une minute et le message peut se trouver dans vos courriels indésirables.",
    sent_other: "Utiliser un autre courriel",
    confirm_h: "Confirmez votre courriel", confirm_p: "Pour votre sécurité, veuillez saisir l'adresse courriel à laquelle ce lien de connexion a été envoyé.", confirm_btn: "Continuer",
    denied_h: "Pas encore d'accès", denied_p: "{email} ne figure pas sur la liste des magasins invités. Si vous devriez avoir accès, veuillez communiquer avec M.",
    err_email: "Veuillez entrer une adresse courriel valide.", err_many: "Trop de tentatives. Veuillez patienter quelques minutes et réessayer.",
    err_net: "Problème de réseau. Vérifiez votre connexion et réessayez.", err_generic: "Une erreur est survenue. Veuillez réessayer.",
    err_link: "Ce lien de connexion a expiré ou a déjà été utilisé. Veuillez en demander un nouveau.",
    err_mismatch: "Cette adresse ne correspond pas à ce lien. Veuillez saisir l'adresse à laquelle le lien a été envoyé.",
    asof: "Stock au", pricenote: "Prix en {cur}, avant taxes.", pricenote_retail: "Prix de détail en {cur}, avant taxes.",
    search_ph: "Rechercher un modèle, une taille ou un code", search_lbl: "Rechercher", all_sizes: "Toutes les tailles", all_cond: "Tous les états", all: "Tout",
    count_one: "{n} article", count_other: "{n} articles", no_results: "Aucun article ne correspond à votre recherche.",
    all_brands: "Toutes les marques", no_brands: "Aucune marque n'est encore activée pour votre compte. Veuillez communiquer avec M.",
    none_published: "Aucun stock n'a encore été publié. Revenez bientôt.", load_err: "Le stock n'a pas pu être chargé. Veuillez recharger la page.",
    h_size: "Taille", h_cond: "État", h_av: "Disponible", h_price: "Votre prix",
    price_on_request: "Prix sur demande", est: "est.", est_tip: "Prix estimé, non définitif", msrp: "PDSF",
    contact: "Pour commander ou poser une question, communiquez avec M :", contact_link: "écrire à M",
    g_ski: "Skis", g_bind: "Fixations", g_skin: "Peaux", g_pole: "Bâtons", g_helmet: "Casques et lunettes", g_pack: "Sacs et gourdes", g_cloth: "Vêtements", g_acc: "Accessoires", g_other: "Autres",
    cat_Ski: "Skis", cat_Binding: "Fixations", cat_Skin: "Peaux", cat_Pole: "Bâtons", cat_Helmet: "Casques et lunettes", cat_BackPack: "Sacs et gourdes",
    cat_Clothes: "Vêtements", cat_SkinAcc: "Accessoires de peaux", cat_BindingAcc: "Pièces de fixations", cat_PoleAcc: "Accessoires de bâtons", cat_HeadLamp: "Lampes frontales", cat_Bag: "Sacs",
    cond_New: "Neuf", cond_Demo: "Démo", cond_Old_graphics: "Anciens graphismes", cond_Defect: "Défaut",
    u_pair_one: "paire", u_pair_other: "paires", u_piece_one: "pièce", u_piece_other: "pièces", u_m_one: "m", u_m_other: "m"
  },
  it: {
    portal: "Portale rivenditori", sign_out: "Esci", loading: "Caricamento…",
    signin_title: "Portale rivenditori", signin_sub: "Disponibilità, prezzi e documenti per i negozi partner di M.",
    signin_h: "Accedi", signin_p: "Inserisci l'indirizzo email al quale è stato inviato l'invito. Ti invieremo un link di accesso monouso.",
    email: "Email", email_ph: "tu@tuonegozio.com", send_link: "Inviami un link di accesso", sending: "Invio in corso…",
    legal: "Solo su invito. Prezzi e disponibilità sono riservati ai negozi partner di M.",
    sent_h: "Controlla la posta in arrivo", sent_p: "Abbiamo inviato un link di accesso a {email}. Aprilo su questo dispositivo per continuare. Può volerci un minuto e il messaggio potrebbe finire nella cartella dello spam.",
    sent_other: "Usa un'altra email",
    confirm_h: "Conferma la tua email", confirm_p: "Per sicurezza, digita l'indirizzo email al quale è stato inviato questo link di accesso.", confirm_btn: "Continua",
    denied_h: "Accesso non ancora abilitato", denied_p: "{email} non è nell'elenco dei negozi invitati. Se dovresti avere accesso, contatta M.",
    err_email: "Inserisci un indirizzo email valido.", err_many: "Troppi tentativi. Attendi qualche minuto e riprova.",
    err_net: "Problema di rete. Controlla la connessione e riprova.", err_generic: "Qualcosa è andato storto. Riprova.",
    err_link: "Questo link di accesso è scaduto o è già stato utilizzato. Richiedine uno nuovo.",
    err_mismatch: "Questo indirizzo non corrisponde al link. Digita l'indirizzo al quale è stato inviato il link.",
    asof: "Disponibilità al", pricenote: "Prezzi in {cur}, IVA esclusa.", pricenote_retail: "Prezzi al pubblico in {cur}, IVA esclusa.",
    search_ph: "Cerca modello, misura o codice", search_lbl: "Cerca", all_sizes: "Tutte le misure", all_cond: "Tutte le condizioni", all: "Tutto",
    count_one: "{n} articolo", count_other: "{n} articoli", no_results: "Nessun articolo corrisponde alla ricerca.",
    all_brands: "Tutte le marche", no_brands: "Nessuna marca è ancora abilitata per il tuo account. Contatta M.",
    none_published: "Non è ancora stata pubblicata alcuna disponibilità. Riprova presto.", load_err: "Impossibile caricare la disponibilità. Ricarica la pagina.",
    h_size: "Misura", h_cond: "Condizione", h_av: "Disponibile", h_price: "Il tuo prezzo",
    price_on_request: "Prezzo su richiesta", est: "stim.", est_tip: "Prezzo stimato, non definitivo", msrp: "Listino",
    contact: "Per ordinare o fare domande, contatta M:", contact_link: "scrivi a M",
    g_ski: "Sci", g_bind: "Attacchi", g_skin: "Pelli", g_pole: "Bastoncini", g_helmet: "Caschi e maschere", g_pack: "Zaini e borracce", g_cloth: "Abbigliamento", g_acc: "Accessori", g_other: "Altro",
    cat_Ski: "Sci", cat_Binding: "Attacchi", cat_Skin: "Pelli", cat_Pole: "Bastoncini", cat_Helmet: "Caschi e maschere", cat_BackPack: "Zaini e borracce",
    cat_Clothes: "Abbigliamento", cat_SkinAcc: "Accessori per pelli", cat_BindingAcc: "Ricambi per attacchi", cat_PoleAcc: "Accessori per bastoncini", cat_HeadLamp: "Lampade frontali", cat_Bag: "Borse",
    cond_New: "Nuovo", cond_Demo: "Demo", cond_Old_graphics: "Vecchia grafica", cond_Defect: "Difetto",
    u_pair_one: "paio", u_pair_other: "paia", u_piece_one: "pezzo", u_piece_other: "pezzi", u_m_one: "m", u_m_other: "m"
  }
};

let lang = "en";
export const getLang = () => lang;
export function setLang(l) {
  lang = LANGS.includes(l) ? l : "en";
  document.documentElement.lang = lang;
  return lang;
}
export function detectLang() {
  try { const s = localStorage.getItem("lang"); if (LANGS.includes(s)) return s; } catch (e) { /* ignore */ }
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return LANGS.includes(n) ? n : "en";
}
export function rememberLang(l) { try { localStorage.setItem("lang", l); } catch (e) { /* ignore */ } }

export function t(key, params) {
  let s = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
  if (params) for (const k in params) s = s.split("{" + k + "}").join(params[k]);
  return s;
}
const plural = (key, n) => t(key + (new Intl.PluralRules(lang).select(n) === "one" ? "_one" : "_other"));
export const countLabel = (n) => plural("count", n).replace("{n}", n);
export const unitLabel = (unit, n) => plural("u_" + unit, n);
export const conditionLabel = (c) => t("cond_" + String(c).replace(/\s+/g, "_"));
export const categoryLabel = (c) => t("cat_" + String(c).replace(/\s+/g, ""));

const GROUPS = { Ski: "g_ski", Binding: "g_bind", Skin: "g_skin", Pole: "g_pole", Helmet: "g_helmet", BackPack: "g_pack", Clothes: "g_cloth",
  "Skin Acc": "g_acc", "Binding Acc": "g_acc", "Pole Acc": "g_acc", HeadLamp: "g_acc", Bag: "g_acc" };
export const groupKey = (category) => GROUPS[category] || "g_other";

/** Locale used for numbers and money, chosen from the interface language and the shop currency. */
function numLocale(currency) {
  if (lang === "fr") return currency === "EUR" ? "fr-FR" : "fr-CA";
  if (lang === "it") return "it-IT";
  return currency === "CAD" ? "en-CA" : currency === "USD" ? "en-US" : "en-IE";
}
export function money(value, currency) {
  return new Intl.NumberFormat(numLocale(currency), {
    style: "currency", currency, currencyDisplay: lang === "it" ? "code" : "symbol"
  }).format(value);
}
export const qtyFormat = (n) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);
export function dateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(d);
}
