// Gamelle : serveur minimal. Il ne fait qu'envoyer des fichiers publics.
// Pas de base de données, pas de compte, pas de formulaire : rien à voler ni à injecter.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CONFIG from "./config.js";

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

// La page d'accueil est lue une fois ; un code unique (nonce) y est inséré à chaque affichage.
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

const app = express();
app.disable("x-powered-by");
app.disable("etag");
app.set("trust proxy", 1); // Railway place un proxy devant : on lit la vraie IP du visiteur

// 1. Le site ne fait que lire : toute autre méthode HTTP est refusée.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  res.set("Allow", "GET, HEAD").status(405).end();
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
        "connect-src": ["'self'", ...THIRD],
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

// 7. Page d'accueil avec son code unique.
const PUBLIC_CONFIG = JSON.stringify({
  adsClient: ADS_ON ? CONFIG.adsClient : "", adSlots: ADS_ON ? CONFIG.adSlots : {}, gaId: GA_ON ? CONFIG.gaId : ""
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

const server = app.listen(PORT, () => console.log(`Gamelle en ligne sur le port ${PORT}`));

// 13. Délais courts contre les connexions laissées ouvertes exprès (attaque « slowloris »).
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
