// Construit nutrition/ciqual.json (table Ciqual réduite, utilisée par le serveur pour calculer calories et macros)
// à partir des fichiers XML officiels de l'ANSES (alim_*.xml et compo_*.xml, encodés en windows-1252).
// Usage : node scripts/build-ciqual.mjs <dossier des XML dézippés> <édition, ex. "Ciqual 2020">
// Source : ANSES, table Ciqual (licence ouverte / CC-BY 4.0). Les valeurs sont pour 100 g de partie comestible.
import fs from "node:fs";
import path from "node:path";

const [dir, edition = "Ciqual"] = process.argv.slice(2);
if (!dir) { console.error("Usage : node scripts/build-ciqual.mjs <dossier XML> <édition>"); process.exit(1); }
const find = (prefix) => {
  const f = fs.readdirSync(dir).find(n => n.startsWith(prefix) && n.endsWith(".xml"));
  if (!f) throw new Error(`Fichier ${prefix}*.xml introuvable dans ${dir}`);
  return new TextDecoder("windows-1252").decode(fs.readFileSync(path.join(dir, f)));
};
const tag = (block, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? m[1].trim() : "";
};
// Codes des constituants Ciqual : énergie (règlement UE, kcal), protéines (N x facteur de Jones), glucides, lipides.
const WANT = { 328: "kcal", 25000: "prot", 31000: "gluc", 40000: "lip" };
// Teneurs : « 12,5 », « traces », « < 0,5 », « - » (non mesuré).
const value = (t) => {
  const s = t.replace(",", ".").trim();
  if (/^traces$/i.test(s)) return 0;
  const m = /^<?\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return s.startsWith("<") ? Number(m[1]) / 2 : Number(m[1]);
};

const foods = new Map();
for (const b of find("alim_").split("<ALIM>").slice(1)) {
  const code = tag(b, "alim_code"), name = tag(b, "alim_nom_fr");
  if (code && name) foods.set(code, { c: code, n: name.replace(/\s+/g, " ") });
}
for (const b of find("compo_").split("<COMPO>").slice(1)) {
  const key = WANT[tag(b, "const_code")];
  if (!key) continue;
  const f = foods.get(tag(b, "alim_code"));
  const v = value(tag(b, "teneur"));
  if (f && v !== null) f[key] = Math.round(v * 10) / 10;
}
// On garde les aliments qui ont au moins l'énergie ; une macro manquante vaut 0 mais l'aliment est signalé (« i » : incomplet).
const out = [...foods.values()].filter(f => typeof f.kcal === "number").map(f => {
  const miss = ["prot", "gluc", "lip"].filter(k => typeof f[k] !== "number");
  return { c: f.c, n: f.n, kcal: f.kcal, prot: f.prot ?? 0, gluc: f.gluc ?? 0, lip: f.lip ?? 0, ...(miss.length ? { i: 1 } : {}) };
}).sort((a, b) => a.n.localeCompare(b.n, "fr"));
fs.writeFileSync(new URL("../nutrition/ciqual.json", import.meta.url), JSON.stringify({ edition, source: "ANSES, table de composition nutritionnelle Ciqual", foods: out }));
console.log(`${out.length} aliments écrits dans nutrition/ciqual.json (${edition}).`);
