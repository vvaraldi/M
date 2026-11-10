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
    nav_stock: "Stock", nav_request: "My request", nav_history: "History",
    qty: "Quantity", qty_for: "Quantity for {name}", less: "Less", more: "More", reserved_badge: "Reserved",
    cartbar_one: "{n} item in your request", cartbar_other: "{n} items in your request", cartbar_tbd: "+ items priced on request", cartbar_review: "Review request",
    r_title: "My request", r_empty: "Your request is empty. Add quantities on the Stock page.", r_back: "Back to stock",
    r_remove: "Remove", r_total: "Total", r_sub: "Subtotal (before tax)", r_tbd: "to be confirmed",
    r_tbd_note: "Items marked \"to be confirmed\" will be priced by M on the invoice.",
    r_shipto: "Ship to", r_noaddr: "No delivery address on file: please give it in the notes.", r_po: "Your PO number (optional)",
    r_date: "Requested ship date (optional)", r_notes: "Notes (optional)", r_hold: "Items will be held for you until {date}.",
    r_send: "Send request and reserve", r_sending: "Sending…",
    r_ok_h: "Request sent", r_ok_p: "Request {num} is saved. The items are held for you until {date}. A confirmation was emailed to {email}.",
    r_ok_nomail: "Request {num} is saved. The items are held for you until {date}. The confirmation email could not be sent, but M has your request.",
    r_ok_btn: "View my requests", r_ok_more: "Back to stock",
    r_err_stock: "Not enough stock for {name}: {n} available right now. Please adjust the quantity.",
    r_err_gone: "An item in your request is no longer in stock. Please review it.", r_err_denied: "You cannot send requests with this account.",
    r_err_generic: "The request could not be sent. Please try again.", r_err_auth: "Please sign in again.",
    h_title: "My requests", h_empty: "You have not sent any request yet.", h_until: "Held until {date}", h_sent: "Sent {date}",
    h_cancel: "Cancel request", h_cancel_ask: "Cancel request {num} and release the items?", h_cancelled_ok: "Request {num} cancelled.",
    h_lines_one: "{n} line", h_lines_other: "{n} lines", h_plus_tbd: "+ items to price", h_refresh: "Refresh", h_err: "Your requests could not be loaded.",
    st_reserved: "Reserved", st_expired: "Expired", st_cancelled: "Cancelled", st_released: "Released", st_invoiced: "Invoiced",
    u_pair_one: "pair", u_pair_other: "pairs", u_piece_one: "piece", u_piece_other: "pieces", u_m_one: "m", u_m_other: "m",
    nav_docs: "Documents", d_title: "Catalogs and price lists", d_catalogs: "Catalogs", d_pricelists: "Price lists",
    d_open: "Open catalog", d_download: "Download", d_season: "Season {season}",
    d_empty: "No document is available for your brands yet. Please check back soon.", d_err: "The documents could not be loaded. Please reload the page.",
    d_preparing: "Preparing…", d_dl_err: "The file could not be downloaded. Please try again."
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
    nav_stock: "Stock", nav_request: "Ma demande", nav_history: "Historique",
    qty: "Quantité", qty_for: "Quantité pour {name}", less: "Moins", more: "Plus", reserved_badge: "Réservé",
    cartbar_one: "{n} article dans votre demande", cartbar_other: "{n} articles dans votre demande", cartbar_tbd: "+ articles sur demande", cartbar_review: "Voir la demande",
    r_title: "Ma demande", r_empty: "Votre demande est vide. Ajoutez des quantités sur la page Stock.", r_back: "Retour au stock",
    r_remove: "Retirer", r_total: "Total", r_sub: "Sous-total (avant taxes)", r_tbd: "à confirmer",
    r_tbd_note: "Les articles « à confirmer » seront tarifés par M sur la facture.",
    r_shipto: "Livrer à", r_noaddr: "Aucune adresse de livraison enregistrée : veuillez l'indiquer dans les remarques.", r_po: "Votre numéro de bon de commande (facultatif)",
    r_date: "Date d'expédition souhaitée (facultatif)", r_notes: "Remarques (facultatif)", r_hold: "Les articles vous seront réservés jusqu'au {date}.",
    r_send: "Envoyer la demande et réserver", r_sending: "Envoi…",
    r_ok_h: "Demande envoyée", r_ok_p: "La demande {num} est enregistrée. Les articles vous sont réservés jusqu'au {date}. Une confirmation a été envoyée à {email}.",
    r_ok_nomail: "La demande {num} est enregistrée. Les articles vous sont réservés jusqu'au {date}. Le courriel de confirmation n'a pas pu être envoyé, mais M a bien reçu votre demande.",
    r_ok_btn: "Voir mes demandes", r_ok_more: "Retour au stock",
    r_err_stock: "Stock insuffisant pour {name} : {n} disponible(s) actuellement. Veuillez ajuster la quantité.",
    r_err_gone: "Un article de votre demande n'est plus en stock. Veuillez la vérifier.", r_err_denied: "Vous ne pouvez pas envoyer de demande avec ce compte.",
    r_err_generic: "La demande n'a pas pu être envoyée. Veuillez réessayer.", r_err_auth: "Veuillez vous reconnecter.",
    h_title: "Mes demandes", h_empty: "Vous n'avez encore envoyé aucune demande.", h_until: "Réservé jusqu'au {date}", h_sent: "Envoyée le {date}",
    h_cancel: "Annuler la demande", h_cancel_ask: "Annuler la demande {num} et libérer les articles ?", h_cancelled_ok: "Demande {num} annulée.",
    h_lines_one: "{n} ligne", h_lines_other: "{n} lignes", h_plus_tbd: "+ articles à tarifer", h_refresh: "Actualiser", h_err: "Vos demandes n'ont pas pu être chargées.",
    st_reserved: "Réservée", st_expired: "Expirée", st_cancelled: "Annulée", st_released: "Libérée", st_invoiced: "Facturée",
    u_pair_one: "paire", u_pair_other: "paires", u_piece_one: "pièce", u_piece_other: "pièces", u_m_one: "m", u_m_other: "m",
    nav_docs: "Documents", d_title: "Catalogues et listes de prix", d_catalogs: "Catalogues", d_pricelists: "Listes de prix",
    d_open: "Ouvrir le catalogue", d_download: "Télécharger", d_season: "Saison {season}",
    d_empty: "Aucun document n'est encore disponible pour vos marques. Revenez bientôt.", d_err: "Les documents n'ont pas pu être chargés. Veuillez recharger la page.",
    d_preparing: "Préparation…", d_dl_err: "Le fichier n'a pas pu être téléchargé. Veuillez réessayer."
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
    nav_stock: "Magazzino", nav_request: "La mia richiesta", nav_history: "Cronologia",
    qty: "Quantità", qty_for: "Quantità per {name}", less: "Meno", more: "Più", reserved_badge: "Riservato",
    cartbar_one: "{n} articolo nella tua richiesta", cartbar_other: "{n} articoli nella tua richiesta", cartbar_tbd: "+ articoli su richiesta", cartbar_review: "Vedi la richiesta",
    r_title: "La mia richiesta", r_empty: "La tua richiesta è vuota. Aggiungi le quantità nella pagina Magazzino.", r_back: "Torna al magazzino",
    r_remove: "Rimuovi", r_total: "Totale", r_sub: "Subtotale (IVA esclusa)", r_tbd: "da confermare",
    r_tbd_note: "Gli articoli «da confermare» saranno quotati da M in fattura.",
    r_shipto: "Spedisci a", r_noaddr: "Nessun indirizzo di consegna registrato: indicalo nelle note.", r_po: "Il tuo numero d'ordine (facoltativo)",
    r_date: "Data di spedizione richiesta (facoltativo)", r_notes: "Note (facoltativo)", r_hold: "Gli articoli saranno riservati per te fino al {date}.",
    r_send: "Invia la richiesta e riserva", r_sending: "Invio in corso…",
    r_ok_h: "Richiesta inviata", r_ok_p: "La richiesta {num} è stata registrata. Gli articoli sono riservati per te fino al {date}. Una conferma è stata inviata a {email}.",
    r_ok_nomail: "La richiesta {num} è stata registrata. Gli articoli sono riservati per te fino al {date}. Non è stato possibile inviare l'email di conferma, ma M ha ricevuto la tua richiesta.",
    r_ok_btn: "Vedi le mie richieste", r_ok_more: "Torna al magazzino",
    r_err_stock: "Disponibilità insufficiente per {name}: {n} disponibile/i ora. Modifica la quantità.",
    r_err_gone: "Un articolo della tua richiesta non è più disponibile. Controlla la richiesta.", r_err_denied: "Non puoi inviare richieste con questo account.",
    r_err_generic: "Non è stato possibile inviare la richiesta. Riprova.", r_err_auth: "Accedi di nuovo.",
    h_title: "Le mie richieste", h_empty: "Non hai ancora inviato nessuna richiesta.", h_until: "Riservato fino al {date}", h_sent: "Inviata il {date}",
    h_cancel: "Annulla la richiesta", h_cancel_ask: "Annullare la richiesta {num} e rilasciare gli articoli?", h_cancelled_ok: "Richiesta {num} annullata.",
    h_lines_one: "{n} riga", h_lines_other: "{n} righe", h_plus_tbd: "+ articoli da quotare", h_refresh: "Aggiorna", h_err: "Impossibile caricare le tue richieste.",
    st_reserved: "Riservata", st_expired: "Scaduta", st_cancelled: "Annullata", st_released: "Rilasciata", st_invoiced: "Fatturata",
    u_pair_one: "paio", u_pair_other: "paia", u_piece_one: "pezzo", u_piece_other: "pezzi", u_m_one: "m", u_m_other: "m",
    nav_docs: "Documenti", d_title: "Cataloghi e listini", d_catalogs: "Cataloghi", d_pricelists: "Listini prezzi",
    d_open: "Apri il catalogo", d_download: "Scarica", d_season: "Stagione {season}",
    d_empty: "Nessun documento è ancora disponibile per le tue marche. Riprova presto.", d_err: "Impossibile caricare i documenti. Ricarica la pagina.",
    d_preparing: "Preparazione…", d_dl_err: "Impossibile scaricare il file. Riprova."
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
