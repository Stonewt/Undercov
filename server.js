// Bon'Assiette : serveur minimal. Il envoie des fichiers publics et expose quatre adresses d'API :
// l'analyse photo (abonnés), la suppression de compte, et le paiement de l'abonnement (Stripe).
// Aucune donnée n'est stockée ici : les comptes sont chez Supabase, les paiements chez Stripe.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import CONFIG from "./config.js";
import { analyseHandler, photoEnabled } from "./analyse.js";
import { suggestHandler } from "./suggest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 8080;
const IS_PROD = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

// Réglages publics (identifiants AdSense et Analytics) : voir config.js.
const ADS_ON = CONFIG.adsEnabled && /^ca-pub-\d{10,20}$/.test(CONFIG.adsClient);
const GA_ON = /^G-[A-Z0-9]{6,12}$/.test(CONFIG.gaId);
const ADS_SOURCES = [
  "https://pagead2.googlesyndication.com", "https://*.googlesyndication.com", "https://*.doubleclick.net",
  "https://*.google.com", "https://*.gstatic.com", "https://*.googleadservices.com",
  "https://*.adtrafficquality.google", "https://fundingchoicesmessages.google.com"
];
const GA_SOURCES = ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"];
const THIRD = [...(ADS_ON ? ADS_SOURCES : []), ...(GA_ON ? GA_SOURCES : [])];

// Comptes utilisateurs (Supabase) : actifs seulement si les variables Railway sont réglées.
// SUPABASE_URL et SUPABASE_ANON_KEY sont publiques ; SUPABASE_SERVICE_ROLE_KEY est secrète et ne quitte jamais le serveur.
const SB_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(process.env.SUPABASE_URL || "") ? process.env.SUPABASE_URL : "";
const SB_ANON = /^[A-Za-z0-9._-]{20,500}$/.test(process.env.SUPABASE_ANON_KEY || "") ? process.env.SUPABASE_ANON_KEY : "";
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ACCOUNTS_ON = Boolean(SB_URL && SB_ANON);

// Abonnement Bon'Assiette+ (Stripe) : actif seulement si les comptes le sont et si les trois variables Railway
// STRIPE_SECRET_KEY (secrète), STRIPE_WEBHOOK_SECRET (secrète) et STRIPE_PRICE_ID (identifiant du tarif) sont réglées.
const STRIPE_KEY = /^sk_(live|test)_[A-Za-z0-9]{10,}$/.test(process.env.STRIPE_SECRET_KEY || "") ? process.env.STRIPE_SECRET_KEY : "";
const STRIPE_WH = /^whsec_[A-Za-z0-9]{10,}$/.test(process.env.STRIPE_WEBHOOK_SECRET || "") ? process.env.STRIPE_WEBHOOK_SECRET : "";
const STRIPE_PRICE = /^price_[A-Za-z0-9]{10,}$/.test(process.env.STRIPE_PRICE_ID || "") ? process.env.STRIPE_PRICE_ID : "";
// Facultatif : configuration du portail client créée par scripts/setup.mjs (sinon, celle par défaut du tableau de bord Stripe).
const STRIPE_PORTAL = /^bpc_[A-Za-z0-9]{10,}$/.test(process.env.STRIPE_PORTAL_CONFIG_ID || "") ? process.env.STRIPE_PORTAL_CONFIG_ID : "";
const PREMIUM_ON = Boolean(ACCOUNTS_ON && SB_SERVICE && STRIPE_KEY && STRIPE_WH && STRIPE_PRICE);
// En mode test uniquement, la cause exacte d'un échec est affichée pour pouvoir la corriger (jamais en mode réel).
const testDetail = (e) => (STRIPE_KEY.startsWith("sk_test_") ? ` [test : ${String(e?.message || e).slice(0, 220)}]` : "");
const stripe = PREMIUM_ON ? new Stripe(STRIPE_KEY, { timeout: 15_000, maxNetworkRetries: 1 }) : null;
if (ACCOUNTS_ON && !PREMIUM_ON) console.log("Abonnement Bon'Assiette+ inactif : variables Stripe ou SUPABASE_SERVICE_ROLE_KEY manquantes.");

// Qui est connecté ? Le navigateur envoie son jeton Supabase ; on le fait vérifier par Supabase.
async function userFromRequest(req) {
  const m = /^Bearer ([A-Za-z0-9._-]{20,4000})$/.exec(req.get("authorization") || "");
  if (!m) return null;
  const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${m[1]}` } });
  if (!who.ok) return null;
  const { id, email } = await who.json();
  return /^[0-9a-f-]{36}$/.test(id || "") ? { id, email: typeof email === "string" ? email : "" } : null;
}
// Lecture et écriture de la table subscriptions avec la clé secrète (les utilisateurs ne peuvent que la lire).
// Nouvelles clés secrètes (sb_secret_…) : seulement dans l'en-tête apikey. Anciennes clés JWT (eyJ…) : aussi en Authorization.
const sbKeyHeaders = (key) => (key.startsWith("eyJ") ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });
const sbAdmin = { ...sbKeyHeaders(SB_SERVICE), "content-type": "application/json" };
async function subscriptionOf(userId) {
  const r = await fetch(`${SB_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=status,current_period_end,provider_ref`, { headers: sbAdmin });
  if (!r.ok) throw new Error(`subscriptions: ${r.status}`);
  return (await r.json())[0] || null;
}
async function saveSubscription(row) {
  const r = await fetch(`${SB_URL}/rest/v1/subscriptions`, {
    method: "POST", headers: { ...sbAdmin, prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`subscriptions: ${r.status}`);
}
// Abonné = statut actif (ou paiement en retard, avec 3 jours de tolérance avant la coupure).
const isActive = (s) => Boolean(s) && (s.status === "active" || s.status === "past_due")
  && (!s.current_period_end || Date.parse(s.current_period_end) + 3 * 86_400_000 > Date.now());
// Statut Stripe -> statut Bon'Assiette.
const mapStatus = (st) => (st === "active" || st === "trialing") ? "active" : st === "past_due" ? "past_due"
  : (st === "canceled" || st === "unpaid" || st === "incomplete_expired") ? "canceled" : "inactive";
const periodEnd = (sub) => {
  const t = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
};

// La page d'accueil est lue une fois ; un code unique (nonce) y est inséré à chaque affichage.
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

const app = express();
app.disable("x-powered-by");
app.disable("etag");
app.set("trust proxy", 1); // Railway place un proxy devant : on lit la vraie IP du visiteur

// 1. Le site ne fait que lire : toute autre méthode HTTP est refusée, sauf les quelques envois (POST) de l'API.
const POST_PATHS = new Set(["/api/analyse", "/api/account/delete", "/api/checkout", "/api/portal", "/api/stripe/webhook", "/api/suggest", "/api/contact"]);
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.method === "POST" && POST_PATHS.has(req.path)) return next();
  res.set("Allow", "GET, HEAD").status(405).end();
});

// 1 bis. Adresse officielle : si CANONICAL_HOST est réglé (ex. www.bonassiette.fr),
//        les anciennes adresses (intrusonline.fr, *.up.railway.app) y renvoient définitivement.
const CANONICAL_HOST = (process.env.CANONICAL_HOST || "").toLowerCase();
app.use((req, res, next) => {
  if (!CANONICAL_HOST || !IS_PROD) return next();
  const host = (req.hostname || "").toLowerCase();
  if (host === CANONICAL_HOST || req.method !== "GET" && req.method !== "HEAD") return next();
  res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
});

// 2. Refus des adresses anormalement longues (sondes et attaques par saturation).
app.use((req, res, next) => {
  if (req.originalUrl.length > 512) return res.status(414).end();
  next();
});

// 3. HTTPS obligatoire en production.
app.use((req, res, next) => {
  if (IS_PROD && !req.secure) return res.redirect(308, `https://${req.hostname}${req.originalUrl}`);
  next();
});

// 4. Code unique par réponse : seuls les scripts portant ce code peuvent s'exécuter.
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(18).toString("base64");
  next();
});

// 5. En-têtes de sécurité stricts.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "script-src": [(req, res) => `'nonce-${res.locals.nonce}'`, "'strict-dynamic'", "'self'", ...THIRD],
        "style-src": ["'self'", ...(ADS_ON ? ["'unsafe-inline'"] : [])],
        "font-src": ["'self'"],
        "img-src": ["'self'", "data:", ...(THIRD.length ? ["https:"] : [])],
        "connect-src": ["'self'", ...THIRD, ...(ACCOUNTS_ON ? [SB_URL] : [])],
        "frame-src": ADS_ON ? ADS_SOURCES : ["'none'"],
        "manifest-src": ["'self'"],
        "worker-src": ["'self'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": []
      }
    },
    strictTransportSecurity: IS_PROD ? { maxAge: 63072000, includeSubDomains: true } : false,
    referrerPolicy: { policy: THIRD.length ? "strict-origin-when-cross-origin" : "no-referrer" },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: ADS_ON ? "same-origin-allow-popups" : "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    xFrameOptions: { action: "deny" }
  })
);
app.use((req, res, next) => {
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()");
  next();
});

// 6. Limite de requêtes par visiteur (freine les robots et les attaques par saturation).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Trop de requêtes. Réessaie dans une minute."
  })
);

app.get("/api/status", (req, res) => res.set("Cache-Control", "no-store").json({ photo: photoEnabled(), premium: PREMIUM_ON }));
// Les envois (POST) ne sont acceptés que s'ils viennent du site lui-même.
const sameOrigin = (req, res, next) => {
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  if ((origin && origin !== `${req.protocol}://${req.get("host")}`) || (site && site !== "same-origin")) {
    return res.status(403).json({ error: "Requête refusée." });
  }
  next();
};
// Connexion obligatoire : met l'utilisateur dans req.user.
const requireUser = async (req, res, next) => {
  if (!ACCOUNTS_ON || !SB_SERVICE) return res.status(503).json({ error: "Les comptes ne sont pas encore activés." });
  if (!req.get("authorization")) return res.status(401).json({ error: "Connexion requise." });
  try {
    req.user = await userFromRequest(req);
    if (!req.user) return res.status(401).json({ error: "Connexion expirée. Reconnecte-toi." });
    next();
  } catch (e) { console.error("auth:", e?.message); res.status(502).json({ error: "Vérification impossible. Réessaie." }); }
};
// Abonnement obligatoire : met l'abonnement dans req.subscription.
const requireSubscriber = async (req, res, next) => {
  if (!PREMIUM_ON) return res.status(503).json({ error: "L'abonnement Bon'Assiette+ n'est pas encore ouvert." });
  try {
    req.subscription = await subscriptionOf(req.user.id);
    if (!isActive(req.subscription)) return res.status(402).json({ error: "L'analyse photo est réservée aux abonnés Bon'Assiette+." });
    next();
  } catch (e) { console.error("abonnement:", e?.message); res.status(502).json({ error: "Vérification impossible. Réessaie." }); }
};

// Analyse photo : abonnés connectés uniquement, 6 par jour et par compte, photo de 1,5 Mo max.
app.post(
  "/api/analyse",
  sameOrigin,
  (req, res, next) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "Format refusé." });
    next();
  },
  requireUser,
  requireSubscriber,
  rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 6,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: "Tu as utilisé tes 6 analyses photo du jour. Reviens demain, ou ajoute ton repas à la main." })
  }),
  express.json({ limit: "2.1mb", strict: true }),
  analyseHandler
);

// Proposition d'un repas par un utilisateur connecté : 10 par jour et par compte, validée ensuite à la main.
app.post(
  "/api/suggest",
  sameOrigin,
  (req, res, next) => (req.is("application/json") ? next() : res.status(415).json({ error: "Format refusé." })),
  requireUser,
  rateLimit({
    windowMs: 24 * 60 * 60 * 1000, limit: 10, keyGenerator: (req) => req.user.id, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: "Merci pour tes 10 propositions du jour ! Reviens demain pour en ajouter d'autres." })
  }),
  express.json({ limit: "4kb", strict: true }),
  suggestHandler({ sbUrl: SB_URL, sbAdmin })
);

// Page Contact : message libre (idée, bug, abonnement…), enregistré dans la table feedback de Supabase.
// Sans compte, 5 messages par heure et par adresse IP ; le champ « website » invisible piège les robots.
const KINDS = new Set(["idee", "probleme", "abonnement", "compte", "autre"]);
app.post(
  "/api/contact",
  sameOrigin,
  (req, res, next) => (req.is("application/json") ? next() : res.status(415).json({ error: "Format refusé." })),
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: "Tu as déjà envoyé plusieurs messages. Réessaie dans une heure." }) }),
  express.json({ limit: "8kb", strict: true }),
  async (req, res) => {
    if (!SB_URL || !SB_SERVICE) return res.status(503).json({ error: "Le formulaire n'est pas encore activé. Écris à gamelle.support@gmail.com." });
    const b = req.body || {};
    if (typeof b.website === "string" && b.website.trim()) return res.json({ ok: true }); // robot : on fait semblant
    const kind = KINDS.has(b.kind) ? b.kind : "autre";
    const message = String(b.message ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 2000);
    const email = String(b.email ?? "").trim().slice(0, 254);
    if (message.length < 10) return res.status(400).json({ error: "Ton message est un peu court : dis-nous en un peu plus." });
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) return res.status(400).json({ error: "Cette adresse e-mail ne semble pas valide." });
    try {
      const r = await fetch(`${SB_URL}/rest/v1/feedback`, {
        method: "POST", headers: { ...sbAdmin, prefer: "return=minimal" },
        body: JSON.stringify({ kind, message, email: email || null, page: "contact" })
      });
      if (!r.ok) throw new Error(`feedback: ${r.status}`);
      res.set("Cache-Control", "no-store").json({ ok: true });
    } catch (e) {
      console.error("contact:", e?.message);
      res.status(502).json({ error: "L'envoi a échoué. Réessaie plus tard, ou écris à gamelle.support@gmail.com." });
    }
  }
);

// Abonnement : le navigateur demande une page de paiement Stripe, puis y est envoyé.
const siteUrl = (req) => (CANONICAL_HOST && IS_PROD ? `https://${CANONICAL_HOST}` : `${req.protocol}://${req.get("host")}`);
const payLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: "Trop de tentatives. Réessaie dans une heure." }) });
app.post("/api/checkout", sameOrigin, payLimit, requireUser, async (req, res) => {
  if (!PREMIUM_ON) return res.status(503).json({ error: "L'abonnement Bon'Assiette+ n'est pas encore ouvert." });
  try {
    const current = await subscriptionOf(req.user.id);
    if (isActive(current)) return res.status(409).json({ error: "Tu es déjà abonné." });
    // Même client Stripe si la personne s'est déjà abonnée par le passé, sinon Stripe en crée un avec son e-mail.
    // Un client qui n'existe plus (ex. créé en mode test) est ignoré.
    let customer = current?.provider_ref || "";
    if (customer) { try { const c = await stripe.customers.retrieve(customer); if (c.deleted) customer = ""; } catch { customer = ""; } }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE, quantity: 1 }],
      client_reference_id: req.user.id,
      ...(customer ? { customer } : { customer_email: req.user.email || undefined }),
      subscription_data: { metadata: { user_id: req.user.id } },
      locale: "fr",
      success_url: `${siteUrl(req)}/?abonnement=ok`,
      cancel_url: `${siteUrl(req)}/?abonnement=annule`
    });
    res.set("Cache-Control", "no-store").json({ url: session.url });
  } catch (e) {
    console.error("checkout:", e?.message);
    res.status(502).json({ error: "Le paiement n'a pas pu démarrer. Réessaie dans un moment." + testDetail(e) });
  }
});
// Gestion de l'abonnement (changer de carte, résilier) : page sécurisée de Stripe.
app.post("/api/portal", sameOrigin, payLimit, requireUser, async (req, res) => {
  if (!PREMIUM_ON) return res.status(503).json({ error: "L'abonnement Bon'Assiette+ n'est pas encore ouvert." });
  try {
    const current = await subscriptionOf(req.user.id);
    if (!current?.provider_ref) return res.status(404).json({ error: "Aucun abonnement trouvé pour ce compte." });
    const portal = await stripe.billingPortal.sessions.create({
      customer: current.provider_ref, return_url: `${siteUrl(req)}/`, ...(STRIPE_PORTAL ? { configuration: STRIPE_PORTAL } : {})
    });
    res.set("Cache-Control", "no-store").json({ url: portal.url });
  } catch (e) {
    console.error("portail:", e?.message);
    res.status(502).json({ error: "La page de gestion n'a pas pu s'ouvrir. Réessaie dans un moment." + testDetail(e) });
  }
});
// Stripe prévient le serveur de chaque paiement, renouvellement ou résiliation : c'est la seule source de vérité.
// Chaque message est signé avec STRIPE_WEBHOOK_SECRET ; un message mal signé est refusé.
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!PREMIUM_ON) return res.status(503).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature") || "", STRIPE_WH); }
  catch (e) { console.error("webhook: signature refusée", e?.message); return res.status(400).end(); }
  try {
    const obj = event.data.object;
    if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const sub = await stripe.subscriptions.retrieve(obj.subscription);
      const userId = obj.client_reference_id || sub.metadata?.user_id;
      if (/^[0-9a-f-]{36}$/.test(userId || "")) {
        await saveSubscription({ user_id: userId, status: mapStatus(sub.status), current_period_end: periodEnd(sub),
          provider_ref: String(sub.customer), updated_at: new Date().toISOString() });
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      // État relu chez Stripe : les événements peuvent arriver dans le désordre, seul l'état actuel compte.
      const sub = event.type.endsWith("deleted") ? obj : await stripe.subscriptions.retrieve(obj.id);
      const userId = sub.metadata?.user_id;
      // Un ancien abonnement résilié ne doit pas couper un abonnement plus récent du même client.
      const other = event.type.endsWith("deleted")
        ? (await stripe.subscriptions.list({ customer: String(sub.customer), status: "active", limit: 1 })).data.length > 0 : false;
      if (!other && /^[0-9a-f-]{36}$/.test(userId || "")) {
        await saveSubscription({ user_id: userId, status: event.type.endsWith("deleted") ? "canceled" : mapStatus(sub.status),
          current_period_end: periodEnd(sub), provider_ref: String(sub.customer), updated_at: new Date().toISOString() });
      }
    }
    res.status(200).end();
  } catch (e) {
    console.error("webhook:", event.type, e?.message);
    res.status(500).end(); // Stripe réessaiera plus tard
  }
});

// Suppression de compte (droit à l'effacement, RGPD) : le visiteur prouve qui il est avec son jeton de connexion,
// puis le serveur supprime le compte avec la clé secrète. Ses données sauvegardées partent avec (ON DELETE CASCADE).
app.post(
  "/api/account/delete",
  sameOrigin,
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: "Trop de tentatives. Réessaie dans une heure." }) }),
  requireUser,
  async (req, res) => {
    const { id } = req.user;
    try {
      // Un abonnement en cours est résilié chez Stripe avant la suppression du compte.
      if (PREMIUM_ON) {
        const current = await subscriptionOf(id).catch(() => null);
        if (current?.provider_ref) {
          const list = await stripe.subscriptions.list({ customer: current.provider_ref, status: "all", limit: 10 });
          for (const s of list.data) if (s.status !== "canceled") await stripe.subscriptions.cancel(s.id);
        }
      }
      const del = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
        method: "DELETE", headers: sbKeyHeaders(SB_SERVICE)
      });
      if (!del.ok) { console.error("suppression compte:", del.status); return res.status(502).json({ error: "La suppression a échoué. Réessaie plus tard." }); }
      res.set("Cache-Control", "no-store").json({ ok: true });
    } catch (e) {
      console.error("suppression compte:", e?.message);
      res.status(502).json({ error: "La suppression a échoué. Réessaie plus tard." });
    }
  }
);

// 7. Page d'accueil avec son code unique.
const PUBLIC_CONFIG = JSON.stringify({
  adsClient: ADS_ON ? CONFIG.adsClient : "", adSlots: ADS_ON ? CONFIG.adSlots : {}, gaId: GA_ON ? CONFIG.gaId : "",
  supabase: ACCOUNTS_ON ? { url: SB_URL, key: SB_ANON } : null,
  premium: PREMIUM_ON ? { price: String(CONFIG.premiumPrice || "") } : null
}).replace(/</g, "\\u003c");
const HEAD_EXTRA = /^ca-pub-\d{10,20}$/.test(CONFIG.adsClient)
  ? `<meta name="google-adsense-account" content="${CONFIG.adsClient}">` : "";
const sendIndex = (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.type("html").send(
    INDEX_HTML.replaceAll("__NONCE__", res.locals.nonce)
      .replace("<!--HEAD_EXTRA-->", HEAD_EXTRA)
      .replace("__CONFIG__", PUBLIC_CONFIG)
  );
};
app.get(["/", "/index.html"], sendIndex);
// Page Contact : son script porte aussi le code unique.
const CONTACT_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "contact.html"), "utf8");
app.get(["/contact", "/contact.html"], (req, res) => {
  res.set("Cache-Control", "no-cache").type("html").send(CONTACT_HTML.replaceAll("__NONCE__", res.locals.nonce));
});

// ads.txt : déclare qui a le droit de vendre la publicité du site.
app.get("/ads.txt", (req, res) => {
  const m = /^ca-pub-(\d{10,20})$/.exec(CONFIG.adsClient);
  res.type("text/plain").set("Cache-Control", "public, max-age=3600");
  res.send(m ? `google.com, pub-${m[1]}, DIRECT, f08c47fec0942fa0\n` : "");
});

// 8. Anciennes adresses : /gamelle/ renvoie vers l'accueil.
app.get(["/gamelle", "/gamelle/{*rest}"], (req, res) => res.redirect(301, "/"));

// 9. Pages légales sans extension.
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get("/mentions-legales", page("mentions-legales.html"));
app.get("/confidentialite", page("confidentialite.html"));

// 10. Fichiers publics. Les fichiers cachés (.env, .git…) ne sont jamais servis.
app.use(
  express.static(PUBLIC_DIR, {
    dotfiles: "deny",
    index: false,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name.endsWith(".woff2")) res.set("Cache-Control", "public, max-age=31536000, immutable");
      else if (name === "sw.js") res.set("Cache-Control", "no-cache");
      else res.set("Cache-Control", "public, max-age=0, must-revalidate");
    }
  })
);

// 11. Page introuvable.
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html")));

// 12. Erreur : aucun détail technique n'est montré au visiteur.
app.use((err, req, res, _next) => {
  console.error(err?.message || err);
  if (res.headersSent) return;
  res.status(err?.status === 403 ? 403 : 500).type("text/plain").send("Erreur");
});

const server = app.listen(PORT, () => console.log(`Bon'Assiette en ligne sur le port ${PORT}`));

// 13. Délais courts contre les connexions laissées ouvertes exprès (attaque « slowloris »).
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
