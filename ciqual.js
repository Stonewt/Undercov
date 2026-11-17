// Calories et macros calculées avec la table Ciqual de l'ANSES (nutrition/ciqual.json, construit par scripts/build-ciqual.mjs),
// plutôt que de laisser l'IA les donner de mémoire. L'IA ne fournit que l'aliment et ses grammes ;
// le serveur cherche les entrées Ciqual les plus proches, l'IA choisit la bonne parmi elles, et le serveur calcule.
import fs from "node:fs";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CIQUAL_MODEL || process.env.ANALYSE_MODEL || "claude-haiku-5-5";

let TABLE = { edition: "", foods: [] };
try { TABLE = JSON.parse(fs.readFileSync(new URL("./nutrition/ciqual.json", import.meta.url), "utf8")); }
catch (e) { console.error("Table Ciqual absente : les valeurs resteront estimées par l'IA.", e?.message); }
export const CIQUAL_EDITION = TABLE.edition || "";
export const ciqualReady = () => TABLE.foods.length > 0;

// ---------- Recherche plein texte ----------
const STOP = new Set(["de", "du", "des", "la", "le", "les", "a", "au", "aux", "et", "en", "ou", "l", "d", "un", "une", "avec", "ex", "type", "pour", "sur", "par", "a", "the", "with"]);
// Racine simple : « lentilles », « lentille » → « lentill » ; « pâtes », « pâte » → « pat ».
const stem = (w) => (w.length > 4 ? w.replace(/(es|s|x)$/, "").replace(/e$/, "") : w);
const tokens = (s) => String(s || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
const INDEX = TABLE.foods.map(f => { const t = tokens(f.n); return { f, t, set: new Set(t), head: t[0] }; });
const DF = new Map();
for (const e of INDEX) for (const w of e.set) DF.set(w, (DF.get(w) || 0) + 1);
const idf = (w) => Math.log(1 + INDEX.length / (1 + (DF.get(w) || 0)));
// Mots (après racine) qui disent qu'un aliment est cuit, et préparations à ne choisir que si elles sont demandées.
const COOKED = new Set(["cuit", "cuite", "grill", "grille", "poel", "poele", "roti", "rotie", "four", "saut", "saute", "frit", "frite", "vapeur",
  "bouilli", "bouillie", "brais", "braise", "mijot", "mijote", "plat", "dur", "poch", "poche", "brouill", "brouille", "rechauff", "rechauffe", "confit"].map(w => stem(w)));
const SPECIAL = new Set(["fum", "fume", "appertis", "appertise", "preemball", "preemballe", "seche", "deshydrat", "deshydrate", "poudr", "poudre", "surgel", "surgele"].map(w => stem(w)));

export function search(query, k = 8) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const total = q.reduce((a, w) => a + idf(w), 0);
  const qCooked = q.some(w => COOKED.has(w)), qRaw = q.includes("cru");
  const scored = [];
  for (const e of INDEX) {
    let s = 0;
    for (const w of q) {
      if (e.set.has(w)) s += idf(w);
      else if (w.length >= 4 && e.t.some(x => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) s += 0.6 * idf(w);
    }
    if (!s) continue;
    if (e.head === q[0]) s += 0.4 * idf(q[0]); // le premier mot (l'aliment principal) compte double
    s -= 0.03 * Math.max(0, e.t.length - q.length); // à score égal, l'entrée la plus simple
    // État de l'aliment : un magret « cuit » ne doit pas tomber sur « cru » ni « fumé » (jusqu'à +50 % de calories).
    const cooked = e.t.some(w => COOKED.has(w)), raw = e.set.has("cru"), special = e.t.some(w => SPECIAL.has(w));
    if (qCooked && raw && !qRaw) s -= 0.5 * total;
    if (qRaw && cooked && !qCooked) s -= 0.5 * total;
    if (qCooked && cooked) s += 0.15 * total;
    if (special && !q.some(w => SPECIAL.has(w))) s -= 0.25 * total;
    scored.push({ f: e.f, score: s / total });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

// ---------- Choix de la bonne entrée par l'IA (texte seul, peu coûteux) ----------
const PICK_TOOL = {
  name: "choix_ciqual",
  description: "Pour chaque aliment, l'entrée de la table Ciqual qui lui correspond le mieux.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false, required: ["choix"],
    properties: {
      choix: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["aliment", "entree"],
          properties: {
            aliment: { type: "integer", description: "Numéro de l'aliment" },
            entree: { type: "integer", description: "Numéro de l'entrée Ciqual choisie, ou -1 si aucune ne correspond vraiment" }
          }
        }
      }
    }
  }
};

async function pickWithAI(items, cands, signal) {
  const lines = items.map((it, i) => `Aliment ${i} : « ${it.query} »${it.hint ? ` (${it.hint})` : ""}\n` +
    (cands[i].length ? cands[i].map((c, j) => `  ${j}. ${c.f.n}`).join("\n") : "  (aucune entrée)")).join("\n\n");
  const r = await fetch(API_URL, {
    method: "POST", signal,
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 600, tools: [PICK_TOOL], tool_choice: { type: "tool", name: PICK_TOOL.name },
      messages: [{ role: "user", content:
        "Pour chaque aliment, choisis dans sa liste l'entrée de la table Ciqual qui correspond le mieux, " +
        "en respectant l'état (cuit ou cru, avec ou sans sauce, frit, etc.). Pour un aliment cuit, préfère une entrée cuite. " +
        "Une viande, un poisson ou un œuf servi dans une assiette est cuit (ex. magret de canard → « Canard, magret, grillé/poêlé »). " +
        "Ne choisis une entrée fumée, crue, appertisée, séchée ou préemballée que si l'aliment l'est clairement. " +
        "Si aucune entrée ne correspond vraiment, réponds -1.\n\n" + lines }]
    })
  });
  if (!r.ok) throw new Error(`choix Ciqual : ${r.status}`);
  const out = (await r.json()).content?.find(b => b.type === "tool_use")?.input;
  const map = new Map();
  for (const c of out?.choix || []) if (Number.isInteger(c.aliment) && Number.isInteger(c.entree)) map.set(c.aliment, c.entree);
  return map;
}

// items : [{ query, grams, hint?, fallback: { kcal, prot, gluc, lip } }] → valeurs pour les grammes indiqués,
// avec la source Ciqual quand une entrée correspond, sinon l'estimation de l'IA (source null).
export async function ground(items, { signal } = {}) {
  const cands = items.map(it => (ciqualReady() ? search(it.query, 8) : []));
  let picks = null;
  if (ciqualReady() && process.env.ANTHROPIC_API_KEY && cands.some(c => c.length)) {
    try { picks = await pickWithAI(items, cands, signal); }
    catch (e) { console.error("ciqual:", e?.message); }
  }
  return items.map((it, i) => {
    let entry = null;
    if (picks) { const j = picks.get(i); if (Number.isInteger(j) && j >= 0 && cands[i][j]) entry = cands[i][j].f; }
    else if (cands[i][0] && cands[i][0].score >= 0.85) entry = cands[i][0].f; // sans l'IA : seulement une correspondance nette
    const g = Math.max(0, Number(it.grams) || 0);
    if (entry) {
      const k = g / 100, r1 = (v) => Math.round(v * k * 10) / 10;
      return { kcal: Math.round(entry.kcal * k), prot: r1(entry.prot), gluc: r1(entry.gluc), lip: r1(entry.lip),
        source: { code: entry.c, nom: entry.n, edition: CIQUAL_EDITION } };
    }
    const fb = it.fallback || {};
    return { kcal: Math.round(Number(fb.kcal) || 0), prot: Number(fb.prot) || 0, gluc: Number(fb.gluc) || 0, lip: Number(fb.lip) || 0, source: null };
  });
}

// Recherche pour l'utilisateur (corriger un aliment de l'analyse photo) : valeurs pour 100 g, sans appel à l'IA.
export function lookup(query, k = 8) {
  if (!ciqualReady()) return [];
  return search(String(query || "").slice(0, 80), k)
    .map(x => ({ code: x.f.c, nom: x.f.n, kcal: x.f.kcal, prot: x.f.prot, gluc: x.f.gluc, lip: x.f.lip }));
}
