// Propositions de repas par les utilisateurs : les valeurs manquantes sont estimées, puis tout attend la validation
// d'un administrateur (statut « pending » dans la table meal_suggestions de Supabase).
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.SUGGEST_MODEL || "claude-haiku-5-5";
const DAILY_CAP = Number(process.env.SUGGEST_DAILY_CAP) || 400;

let day = "", countToday = 0;
function takeSlot() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; countToday = 0; }
  if (countToday >= DAILY_CAP) return false;
  countToday++;
  return true;
}

const num = (v, max) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").slice(0, max).trim();
const FIELDS = { portion_g: 3000, kcal: 4000, prot: 300, gluc: 500, lip: 300, price: 100 };

const TOOL = {
  name: "estimation_repas",
  description: "Valeurs nutritionnelles et prix estimés d'une portion du repas décrit.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["est_un_repas", "portion_g", "kcal", "prot", "gluc", "lip", "price"],
    properties: {
      est_un_repas: { type: "boolean", description: "false si le texte ne décrit pas un aliment ou un repas" },
      portion_g: { type: "number", description: "Poids d'une portion habituelle en grammes" },
      kcal: { type: "number", description: "Calories pour cette portion" },
      prot: { type: "number", description: "Protéines en grammes pour cette portion" },
      gluc: { type: "number", description: "Glucides en grammes pour cette portion" },
      lip: { type: "number", description: "Lipides en grammes pour cette portion" },
      price: { type: "number", description: "Prix moyen en euros en France pour cette portion (fait maison si c'est un plat maison, sinon prix de vente courant)" }
    }
  }
};

async function estimate(name, given) {
  if (!process.env.ANTHROPIC_API_KEY || !takeSlot()) return null;
  const known = Object.entries(given).filter(([, v]) => v !== null).map(([k, v]) => `${k} = ${v}`).join(", ") || "aucune";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(API_URL, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 400, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content:
          `Repas proposé par un utilisateur d'une appli française de nutrition : « ${name} ».\n` +
          `Valeurs déjà données (portion_g en grammes, price en euros) : ${known}.\n` +
          `Estime toutes les valeurs pour une portion, en restant cohérent avec celles déjà données (même portion). ` +
          `Base-toi sur la table Ciqual de l'ANSES et les prix courants en France.` }]
      })
    });
    if (!r.ok) { console.error("suggestion: réponse API", r.status); return null; }
    const out = (await r.json()).content?.find(c => c.type === "tool_use")?.input;
    if (!out) return null;
    const e = { est_un_repas: Boolean(out.est_un_repas) };
    for (const [k, max] of Object.entries(FIELDS)) e[k] = num(out[k], max);
    return e;
  } catch (err) { console.error("suggestion:", err?.message); return null; }
  finally { clearTimeout(timer); }
}

// Corps attendu : { name, portion_g?, kcal?, prot?, gluc?, lip?, price? }. Réponse : valeurs complétées + champs estimés.
export function suggestHandler({ sbUrl, sbAdmin }) {
  return async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 80);
    if (name.length < 3) return res.status(400).json({ error: "Donne un nom au repas (3 caractères minimum)." });
    const given = {};
    for (const [k, max] of Object.entries(FIELDS)) {
      given[k] = num(b[k], max);
      if (b[k] !== undefined && b[k] !== null && b[k] !== "" && given[k] === null) return res.status(400).json({ error: "Une des valeurs n'est pas valide." });
    }
    const est = await estimate(name, given);
    if (est && !est.est_un_repas) return res.status(400).json({ error: "Ça ne ressemble pas à un repas. Vérifie le nom." });
    const values = {}, estimated = [];
    for (const k of Object.keys(FIELDS)) {
      values[k] = given[k] ?? est?.[k] ?? null;
      if (given[k] === null && values[k] !== null) estimated.push(k);
    }
    const row = { user_id: req.user.id, name, ...values, estimated, ai_estimate: est, status: "pending" };
    try {
      const r = await fetch(`${sbUrl}/rest/v1/meal_suggestions`, {
        method: "POST", headers: { ...sbAdmin, prefer: "return=minimal" }, body: JSON.stringify(row)
      });
      if (!r.ok) throw new Error(`meal_suggestions: ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      console.error("suggestion:", e?.message);
      return res.status(502).json({ error: "La proposition n'a pas pu être enregistrée. Réessaie plus tard." });
    }
    res.set("Cache-Control", "no-store").json({ name, ...values, estimated });
  };
}
