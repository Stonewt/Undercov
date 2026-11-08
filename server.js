// Gamelle : serveur minimal. Il ne fait qu'envoyer des fichiers publics.
// Pas de base de données, pas de compte, pas de formulaire : rien à voler ni à injecter.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 8080;
const IS_PROD = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

const app = express();
app.disable("x-powered-by");
app.disable("etag"); // les en-têtes de cache ci-dessous suffisent
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
  if (IS_PROD && !req.secure) {
    return res.redirect(308, `https://${req.hostname}${req.originalUrl}`);
  }
  next();
});

// 4. En-têtes de sécurité stricts : seuls nos propres fichiers peuvent s'exécuter.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "font-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
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
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: { policy: "require-corp" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    xFrameOptions: { action: "deny" }
  })
);
app.use((req, res, next) => {
  res.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), interest-cohort=(), browsing-topics=()"
  );
  next();
});

// 5. Limite de requêtes par visiteur (freine les robots et les attaques par saturation).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Trop de requêtes. Réessaie dans une minute."
  })
);

// 6. Anciennes adresses : /gamelle/ renvoie vers l'accueil.
app.get(["/gamelle", "/gamelle/{*rest}"], (req, res) => res.redirect(301, "/"));

// 7. Pages légales sans extension.
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get("/mentions-legales", page("mentions-legales.html"));
app.get("/confidentialite", page("confidentialite.html"));

// 8. Fichiers publics. Les fichiers cachés (.env, .git…) ne sont jamais servis.
app.use(
  express.static(PUBLIC_DIR, {
    dotfiles: "deny",
    index: "index.html",
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name.endsWith(".woff2")) {
        res.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (name === "sw.js") {
        res.set("Cache-Control", "no-cache");
        res.set("Service-Worker-Allowed", "/");
      } else {
        res.set("Cache-Control", "public, max-age=0, must-revalidate");
      }
    }
  })
);

// 9. Page introuvable.
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html")));

// 10. Erreur : aucun détail technique n'est montré au visiteur.
app.use((err, req, res, _next) => {
  console.error(err?.message || err);
  if (res.headersSent) return;
  res.status(err?.status === 403 ? 403 : 500).type("text/plain").send("Erreur");
});

const server = app.listen(PORT, () => console.log(`Gamelle en ligne sur le port ${PORT}`));

// 11. Délais courts contre les connexions laissées ouvertes exprès (attaque « slowloris »).
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
