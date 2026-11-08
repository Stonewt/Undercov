// Analyse d'une photo de repas par Claude (API Anthropic).
// La clé reste sur le serveur (variable ANTHROPIC_API_KEY dans Railway), jamais dans le navigateur.
// La photo n'est ni enregistrée ni journalisée : elle est transmise pour l'analyse puis oubliée.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANALYSE_MODEL || "claude-haiku-5-5";
const DAILY_GLOBAL_CAP = Number(process.env.ANALYSE_DAILY_CAP) || 300; // plafond de coût pour tout le site
const MAX_IMAGE_BYTES = 1_500_000;

export const photoEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Fonction réservée aux abonnés Bon'Assiette+. Tant que le paiement n'existe pas, personne n'y a accès :
// aucune analyse n'est payée par le site pour un visiteur non abonné.
const isSubscriber = (_req) => false;

let day = "", countToday = 0;
function takeGlobalSlot() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; countToday = 0; }
  if (countToday >= DAILY_GLOBAL_CAP) return false;
  countToday++;
  return true;
}

const TOOL = {
  name: "repas_analyse",
  description: "Décrit le repas visible sur la photo, aliment par aliment, avec les quantités estimées et les valeurs nutritionnelles de chaque aliment pour cette quantité.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["est_un_repas", "nom", "aliments", "confiance", "remarque"],
    properties: {
      est_un_repas: { type: "boolean", description: "false si la photo ne montre pas de nourriture" },
      nom: { type: "string", description: "Nom court du plat, en français" },
      aliments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nom", "grammes", "kcal", "proteines", "glucides", "lipides"],
          properties: {
            nom: { type: "string", description: "Aliment, en français, ex. « pâtes cuites », « sauce béchamel »" },
            grammes: { type: "number", description: "Quantité estimée en grammes" },
            kcal: { type: "number", description: "Calories pour cette quantité" },
            proteines: { type: "number", description: "Protéines en grammes pour cette quantité" },
            glucides: { type: "number", description: "Glucides en grammes pour cette quantité" },
            lipides: { type: "number", description: "Lipides en grammes pour cette quantité" }
          }
        }
      },
      confiance: { type: "string", enum: ["faible", "moyenne", "bonne"] },
      remarque: { type: "string", description: "Une phrase utile et bienveillante, sans jugement ni conseil de régime" }
    }
  }
};

const PROMPT = `Tu analyses la photo d'un repas pour une appli française de suivi nutritionnel.
Identifie chaque aliment séparément (par exemple : pâtes cuites, sauce béchamel, fromage râpé), estime sa quantité en grammes de façon réaliste d'après la taille de l'assiette et des couverts, puis donne ses calories, protéines, glucides et lipides pour cette quantité.
Base-toi sur des valeurs de référence courantes en France (table Ciqual de l'ANSES quand tu les connais). Les quantités sont pour ce qui est visible sur la photo.
Si la photo ne montre pas de nourriture, mets est_un_repas à false et une liste vide.
Réponds uniquement en appelant l'outil repas_analyse.`;

const num = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) * 10) / 10 || 0));
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, max).trim();

function clean(input) {
  const aliments = (Array.isArray(input?.aliments) ? input.aliments : []).slice(0, 12).map(a => ({
    nom: str(a.nom, 60) || "Aliment",
    grammes: num(a.grammes, 2000),
    kcal: num(a.kcal, 3000),
    proteines: num(a.proteines, 300),
    glucides: num(a.glucides, 500),
    lipides: num(a.lipides, 300)
  })).filter(a => a.grammes > 0);
  return {
    est_un_repas: Boolean(input?.est_un_repas) && aliments.length > 0,
    nom: str(input?.nom, 80) || "Repas",
    aliments,
    confiance: ["faible", "moyenne", "bonne"].includes(input?.confiance) ? input.confiance : "moyenne",
    remarque: str(input?.remarque, 200)
  };
}

export async function analyseHandler(req, res) {
  if (!isSubscriber(req)) return res.status(402).json({ error: "L'analyse photo est réservée aux abonnés Bon'Assiette+." });
  if (!photoEnabled()) return res.status(503).json({ error: "L'analyse photo n'est pas encore activée." });
  const { image, mime } = req.body || {};
  if (typeof image !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    return res.status(400).json({ error: "Photo invalide." });
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length * 0.75 > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: "Photo trop lourde ou illisible." });
  }
  if (!takeGlobalSlot()) {
    return res.status(429).json({ error: "Trop d'analyses aujourd'hui sur Bon'Assiette. Réessaie demain ou ajoute ton repas à la main." });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        tools: [TOOL],
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: image } },
            { type: "text", text: PROMPT }
          ]
        }]
      })
    });
    if (!r.ok) {
      console.error("analyse: réponse API", r.status);
      return res.status(502).json({ error: "L'analyse n'a pas abouti. Réessaie dans un moment." });
    }
    const data = await r.json();
    const call = (data.content || []).find(b => b.type === "tool_use" && b.name === TOOL.name);
    if (!call) return res.status(502).json({ error: "L'analyse n'a pas abouti. Réessaie avec une autre photo." });
    res.set("Cache-Control", "no-store").json(clean(call.input));
  } catch (e) {
    console.error("analyse:", e?.name === "AbortError" ? "délai dépassé" : e?.message);
    res.status(504).json({ error: "L'analyse a pris trop de temps. Réessaie." });
  } finally {
    clearTimeout(timer);
  }
}
