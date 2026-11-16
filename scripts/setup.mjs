// Mise en service de Bon'Assiette en une commande : node scripts/setup.mjs
// Lit les jetons dans .env.setup (fichier ignoré par git, à supprimer après), puis :
//   1. Supabase : crée le projet (ou utilise SUPABASE_PROJECT_REF), exécute supabase/schema.sql, règle l'authentification.
//   2. Stripe   : crée le produit Bon'Assiette+, son tarif, le webhook et la configuration du portail client.
//   3. Railway  : enregistre toutes les variables du service, ce qui redéploie le site.
// Le script est rejouable : il réutilise ce qui existe déjà. Il n'affiche jamais un secret.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.setup");
if (!fs.existsSync(ENV_FILE)) {
  console.error(`Fichier manquant : ${ENV_FILE}\nCrée-le avec les lignes suivantes (voir README) :\n` +
    "SUPABASE_ACCESS_TOKEN=sbp_...\nSTRIPE_SECRET_KEY=sk_live_... ou sk_test_...\nRAILWAY_TOKEN=...\nANTHROPIC_API_KEY=sk-ant-...\n" +
    "SITE_URL=https://www.bonassiette.fr\n# facultatif : SUPABASE_PROJECT_REF=..., SUPABASE_REGION=eu-west-3, RAILWAY_SERVICE=nom-du-service, PREMIUM_CENTS=299");
  process.exit(1);
}
const E = {};
for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) E[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const need = (k) => { if (!E[k]) { console.error(`Il manque ${k} dans .env.setup`); process.exit(1); } return E[k]; };
const SITE = (E.SITE_URL || "https://www.bonassiette.fr").replace(/\/+$/, "");
const HOST = new URL(SITE).host;
const PREMIUM_CENTS = Number(E.PREMIUM_CENTS) || 299;
const EMAIL_ONLY = process.argv.includes("--email");
const SB_TOKEN = need("SUPABASE_ACCESS_TOKEN");
const STRIPE_KEY = EMAIL_ONLY ? "" : need("STRIPE_SECRET_KEY"), RW_TOKEN = EMAIL_ONLY ? "" : need("RAILWAY_TOKEN");
if (EMAIL_ONLY) { need("SUPABASE_PROJECT_REF"); need("BREVO_SMTP_LOGIN"); need("BREVO_SMTP_KEY"); }
const ANTHROPIC_KEY = E.ANTHROPIC_API_KEY || "";
const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vars = {}; // variables finales pour Railway

async function api(url, { method = "GET", headers = {}, body, form } = {}) {
  const h = { ...headers };
  let payload;
  if (form) { h["content-type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(url, { method, headers: h, body: payload });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${method} ${url.replace(/\?.*/, "")} -> ${r.status} : ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// ---------- 1. Supabase ----------
const SBH = { authorization: `Bearer ${SB_TOKEN}` };
const sbApi = (p, o) => api(`https://api.supabase.com/v1${p}`, { ...o, headers: { ...SBH, ...(o?.headers || {}) } });
async function supabase() {
  log("\n[1/3] Supabase");
  let ref = E.SUPABASE_PROJECT_REF || "";
  if (!ref) {
    const projects = await sbApi("/projects");
    const found = projects.find(p => p.name === "bonassiette");
    if (found) { ref = found.id; log(`  Projet « bonassiette » déjà présent (${ref}).`); }
  }
  if (!ref) {
    const orgs = await sbApi("/organizations");
    if (!orgs.length) throw new Error("Aucune organisation Supabase sur ce compte.");
    const region = E.SUPABASE_REGION || "eu-west-3"; // Paris
    const dbPass = crypto.randomBytes(24).toString("base64url");
    const p = await sbApi("/projects", { method: "POST", body: { name: "bonassiette", organization_id: orgs[0].id, region, db_pass: dbPass } });
    ref = p.id;
    log(`  Projet créé (${ref}, région ${region}). Mot de passe base généré (non affiché, non nécessaire au site).`);
  }
  process.stdout.write("  Attente du démarrage du projet");
  for (let i = 0; i < 60; i++) {
    const p = await sbApi(`/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") break;
    process.stdout.write("."); await sleep(5000);
    if (i === 59) throw new Error("Le projet Supabase ne démarre pas. Réessaie dans quelques minutes.");
  }
  log(" prêt.");
  const schema = fs.readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");
  await sbApi(`/projects/${ref}/database/query`, { method: "POST", body: { query: schema } });
  log("  Schéma (tables user_data et subscriptions, RLS) appliqué.");
  await sbApi(`/projects/${ref}/config/auth`, { method: "PATCH", body: {
    site_url: SITE, uri_allow_list: `${SITE}/,${SITE}/*`, external_email_enabled: true, external_anonymous_users_enabled: false,
    mailer_autoconfirm: false, disable_signup: false, ...emailConfig()
  } });
  log("  Authentification réglée : lien par e-mail, adresse du site, redirections.");
  const keys = await sbApi(`/projects/${ref}/api-keys?reveal=true`);
  const pick = (...names) => keys.find(k => names.includes(k.name))?.api_key || "";
  const anon = pick("anon") || keys.find(k => k.type === "publishable")?.api_key || "";
  const service = pick("service_role") || keys.find(k => k.type === "secret")?.api_key || "";
  if (!anon || !service) throw new Error("Clés API Supabase introuvables (anon / service_role).");
  Object.assign(vars, { SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service });
  log("  Clés récupérées.");
}

// ---------- 2. Stripe ----------
const stripeApi = (p, o) => api(`https://api.stripe.com/v1${p}`, { ...o, headers: { authorization: `Bearer ${STRIPE_KEY}`, ...(o?.headers || {}) } });
async function stripeSetup() {
  log(`\n[2/3] Stripe (${STRIPE_KEY.startsWith("sk_live") ? "clés RÉELLES" : "mode test"})`);
  let product = (await stripeApi("/products?limit=100&active=true")).data.find(p => p.metadata?.app === "bonassiette");
  if (!product) {
    product = await stripeApi("/products", { method: "POST", form: {
      name: "Bon'Assiette+", description: "Analyse photo de tes repas (6 par jour) et aucune publicité. Sans engagement.",
      "metadata[app]": "bonassiette", statement_descriptor: "BONASSIETTE PLUS", url: SITE
    } });
    log("  Produit Bon'Assiette+ créé.");
  } else log("  Produit Bon'Assiette+ déjà présent.");
  let price = (await stripeApi(`/prices?product=${product.id}&active=true&limit=100`)).data
    .find(p => p.currency === "eur" && p.recurring?.interval === "month" && p.unit_amount === PREMIUM_CENTS);
  if (!price) {
    price = await stripeApi("/prices", { method: "POST", form: {
      product: product.id, currency: "eur", unit_amount: String(PREMIUM_CENTS), "recurring[interval]": "month", tax_behavior: "inclusive", nickname: "Mensuel"
    } });
    log(`  Tarif mensuel créé : ${(PREMIUM_CENTS / 100).toFixed(2).replace(".", ",")} € TTC.`);
  } else log("  Tarif mensuel déjà présent.");
  const whUrl = `${SITE}/api/stripe/webhook`;
  const events = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"];
  const existing = (await stripeApi("/webhook_endpoints?limit=100")).data.find(w => w.url === whUrl);
  if (existing) {
    // Le secret d'un webhook existant n'est jamais relisible : on le remplace par un neuf pour l'avoir.
    await stripeApi(`/webhook_endpoints/${existing.id}`, { method: "DELETE" });
    log("  Ancien webhook remplacé (son secret n'est pas relisible).");
  }
  const form = { url: whUrl, description: "Bon'Assiette+ abonnements" };
  events.forEach((e, i) => { form[`enabled_events[${i}]`] = e; });
  const wh = await stripeApi("/webhook_endpoints", { method: "POST", form });
  log("  Webhook créé.");
  let portal = (await stripeApi("/billing_portal/configurations?limit=100&active=true")).data.find(c => c.metadata?.app === "bonassiette");
  if (!portal) {
    portal = await stripeApi("/billing_portal/configurations", { method: "POST", form: {
      "business_profile[headline]": "Bon'Assiette+ : gère ton abonnement",
      "business_profile[privacy_policy_url]": `${SITE}/confidentialite`, "business_profile[terms_of_service_url]": `${SITE}/mentions-legales`,
      "features[subscription_cancel][enabled]": "true", "features[subscription_cancel][mode]": "at_period_end",
      "features[payment_method_update][enabled]": "true", "features[invoice_history][enabled]": "true",
      "features[customer_update][enabled]": "true", "features[customer_update][allowed_updates][0]": "email",
      default_return_url: `${SITE}/`, "metadata[app]": "bonassiette"
    } });
    log("  Portail client configuré (résiliation, carte, factures).");
  } else log("  Portail client déjà configuré.");
  Object.assign(vars, { STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: wh.secret, STRIPE_PRICE_ID: price.id, STRIPE_PORTAL_CONFIG_ID: portal.id });
}

// ---------- 3. Railway ----------
// Jeton de compte (Bearer) ou jeton de projet (en-tête Project-Access-Token) : les deux sont acceptés.
let rwHeaders = { authorization: `Bearer ${RW_TOKEN}` };
const rwApi = (query, variables) => api("https://backboard.railway.com/graphql/v2", { method: "POST", headers: rwHeaders, body: { query, variables } })
  .then(d => { if (d.errors) throw new Error("Railway : " + d.errors.map(e => e.message).join(" / ")); return d.data; });
async function railway() {
  log("\n[3/3] Railway");
  const Q = `{ id name environments { edges { node { id name } } } services { edges { node { id name } } } }`;
  let projects = [], scoped = null;
  try {
    rwHeaders = { "project-access-token": RW_TOKEN };
    scoped = (await rwApi(`query { projectToken { projectId environmentId } }`)).projectToken;
  } catch { rwHeaders = { authorization: `Bearer ${RW_TOKEN}` }; }
  if (scoped) projects = [(await rwApi(`query($id: String!) { project(id: $id) ${Q} }`, { id: scoped.projectId })).project];
  else try { projects = (await rwApi(`query { me { projects { edges { node ${Q} } } } }`)).me.projects.edges.map(e => e.node); }
  catch { projects = (await rwApi(`query { projects { edges { node ${Q} } } }`)).projects.edges.map(e => e.node); }
  const withServices = projects.filter(p => p.services.edges.length);
  if (!withServices.length) throw new Error("Aucun projet Railway avec un service sur ce compte.");
  const project = withServices.length === 1 ? withServices[0]
    : withServices.find(p => /bon|assiette|undercov|intrus|gamelle/i.test(p.name)) || withServices[0];
  const services = project.services.edges.map(e => e.node);
  const service = E.RAILWAY_SERVICE ? services.find(s => s.name === E.RAILWAY_SERVICE)
    : (services.length === 1 ? services[0] : services.find(s => /bon|assiette|undercov|intrus|gamelle|web/i.test(s.name)) || services[0]);
  if (!service) throw new Error(`Service Railway « ${E.RAILWAY_SERVICE} » introuvable. Services : ${services.map(s => s.name).join(", ")}`);
  const envs = project.environments.edges.map(e => e.node);
  const env = (scoped && envs.find(e => e.id === scoped.environmentId)) || envs.find(e => e.name === "production") || envs[0];
  log(`  Projet « ${project.name} », service « ${service.name} », environnement « ${env.name} ».`);
  if (ANTHROPIC_KEY) vars.ANTHROPIC_API_KEY = ANTHROPIC_KEY; else log("  (pas de clé Anthropic : l'analyse photo restera indisponible)");
  vars.CANONICAL_HOST = HOST;
  vars.NODE_ENV = "production";
  await rwApi(`mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
    { input: { projectId: project.id, environmentId: env.id, serviceId: service.id, variables: vars } });
  log(`  ${Object.keys(vars).length} variables enregistrées : ${Object.keys(vars).join(", ")}. Railway redéploie.`);
}

// E-mail de connexion : code à 6 chiffres, aux couleurs du site (supabase/email-code.html).
function emailConfig() {
  const html = fs.readFileSync(path.join(ROOT, "supabase", "email-code.html"), "utf8");
  const subject = "Ton code Bon'Assiette : {{ .Token }}";
  // Envoi par Brevo (SMTP) : obligatoire chez Supabase pour personnaliser l'e-mail, et bien moins limité.
  const smtp = E.BREVO_SMTP_LOGIN && E.BREVO_SMTP_KEY ? {
    smtp_host: "smtp-relay.brevo.com", smtp_port: "587", smtp_user: E.BREVO_SMTP_LOGIN, smtp_pass: E.BREVO_SMTP_KEY,
    smtp_admin_email: E.SENDER_EMAIL || "connexion@bonassiette.fr", smtp_sender_name: "Bon'Assiette", rate_limit_email_sent: 100
  } : {};
  return { ...smtp, mailer_otp_length: 6, mailer_otp_exp: 3600,
    mailer_subjects_magic_link: subject, mailer_templates_magic_link_content: html,
    mailer_subjects_confirmation: subject, mailer_templates_confirmation_content: html };
}

async function verify() {
  process.stdout.write("\nVérification du site");
  for (let i = 0; i < 24; i++) {
    await sleep(10_000); process.stdout.write(".");
    try {
      const s = await api(`${SITE}/api/status`);
      if (s.premium) { log(`\nEn ligne : analyse photo ${s.photo ? "activée" : "SANS clé Anthropic"}, abonnement ouvert. ${SITE}`); return; }
    } catch { /* redéploiement en cours */ }
  }
  log("\nLe site ne répond pas encore avec l'abonnement ouvert. Regarde les journaux Railway, puis ouvre " + SITE + "/api/status");
}

if (EMAIL_ONLY) {
  // Mise à jour du seul e-mail de connexion : il suffit de SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF.
  await sbApi(`/projects/${E.SUPABASE_PROJECT_REF}/config/auth`, { method: "PATCH", body: emailConfig() });
  log("E-mail de connexion mis à jour (code à 6 chiffres). Supprime maintenant le fichier .env.setup.");
  process.exit(0);
}
try {
  await supabase();
  await stripeSetup();
  await railway();
  await verify();
  log("\nTerminé. Supprime maintenant le fichier .env.setup.");
} catch (e) {
  console.error("\nArrêt : " + e.message);
  process.exit(1);
}
