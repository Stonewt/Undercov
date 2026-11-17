// Engagement : coffre du jour (avec, rarement, une analyse photo offerte), ligues de la semaine et rappels de série.
// Tout ce qui a de la valeur (analyse offerte, classement) est décidé ici, côté serveur, jamais par le navigateur.
import crypto from "node:crypto";
import webpush from "web-push";

// ---------- Dates à l'heure de Paris ----------
const parisParts = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
};
const dayKey = (p) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
export const parisDay = (d = new Date()) => dayKey(parisParts(d));
const shiftDay = (key, n) => { const t = new Date(key + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// Semaine ISO (lundi → dimanche), ex. « 2026-W47 ».
export function weekOf(key) {
  const t = new Date(key + "T12:00:00Z");
  const dow = (t.getUTCDay() + 6) % 7; // lundi = 0
  t.setUTCDate(t.getUTCDate() - dow + 3); // jeudi de la semaine
  const y = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
const dayOfWeek = (key) => (new Date(key + "T12:00:00Z").getUTCDay() + 6) % 7 + 1; // lundi = 1 … dimanche = 7

export const TIERS = ["Bronze", "Argent", "Or", "Saphir", "Diamant"];
const GROUP_SIZE = 30, MOVE = 5;
const XP_PER_DAY_CAP = 160; // 120 points de la journée + bonus du coffre
// Pseudos refusés : mots entiers (pour ne pas bloquer « Monique » ou « Computer »), mots longs même collés, et liens.
const BANNED_WORDS = /(^|[^\p{L}])(conne|pute|putain|bite|chatte|pd|fdp|ntm|tg|merde|nique|niquer|salope|nazi|hitler)([^\p{L}]|$)/iu;
const BANNED_GLUED = /(connard|salope|encul|niquetamere|tamere|negre|negro|n[eé]gro|bougnoul|youpin|hitler|nazi|http|www)/i;
const BANNED_LINK = /(www\.|https?:|\.(com|fr|net|org|io|gg|xyz)\b)/i;
const unleet = (p) => p.toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
const BANNED = { test: (p) => BANNED_WORDS.test(p) || BANNED_WORDS.test(unleet(p)) || BANNED_LINK.test(p) || BANNED_GLUED.test(unleet(p).replace(/[\s_.\-0-9]/g, "")) };

export function createEngage({ sbUrl, sbAdmin, rpc, subscriptionOf, isActive, config, secret }) {
  const rest = async (pathAndQuery, opts = {}) => {
    const r = await fetch(`${sbUrl}/rest/v1/${pathAndQuery}`, { ...opts, headers: { ...sbAdmin, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${pathAndQuery.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const CHANCE = Math.min(0.5, Math.max(0, Number(config.chestPhotoChance ?? 0.03)));
  const COOLDOWN = Math.max(1, Number(config.chestPhotoCooldownDays ?? 30));
  const MIN_AGE = Math.max(0, Number(config.chestMinAccountDays ?? 3));

  // ---------- Coffre du jour ----------
  // Un tirage par compte et par jour. L'analyse offerte : compte d'au moins 3 jours, non abonné, pas déjà gagnée
  // dans les 30 derniers jours, puis 3 % de chance. En moyenne : moins d'une analyse offerte par mois et par joueur assidu.
  async function chest(req, res) {
    try {
      const day = parisDay();
      const ins = await rest("chest_rolls", {
        method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ user_id: req.user.id, day })
      });
      if (!ins?.length) return res.json({ already: true, photo: false });
      let photo = false;
      const ageDays = req.user.created_at ? (Date.now() - Date.parse(req.user.created_at)) / 86400000 : 0;
      if (CHANCE > 0 && ageDays >= MIN_AGE) {
        const sub = await subscriptionOf(req.user.id).catch(() => null);
        if (!isActive(sub)) {
          const since = shiftDay(day, -COOLDOWN);
          const won = await rest(`chest_rolls?user_id=eq.${req.user.id}&won=eq.true&day=gt.${since}&select=day&limit=1`);
          if (!won.length && crypto.randomInt(1_000_000) < CHANCE * 1_000_000) {
            await rpc("add_credits", { uid: req.user.id, n: 1 });
            await rest(`chest_rolls?user_id=eq.${req.user.id}&day=eq.${day}`, { method: "PATCH", body: JSON.stringify({ won: true }) });
            photo = true;
          }
        }
      }
      res.set("Cache-Control", "no-store").json({ already: false, photo });
    } catch (e) { console.error("coffre:", e?.message); res.status(502).json({ error: "Le coffre est coincé. Réessaie dans un moment." }); }
  }

  // ---------- Ligues ----------
  const cleanPseudo = (v) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const validPseudo = (p) => /^[\p{L}\p{N}_.\- ]{3,20}$/u.test(p) && !BANNED.test(p) && !BANNED.test(p.replace(/[\s_.\-0-9]/g, ""));

  async function join(req, res) {
    const pseudo = cleanPseudo(req.body?.pseudo);
    if (!validPseudo(pseudo)) return res.status(400).json({ error: "Pseudo de 3 à 20 caractères : lettres, chiffres, espace, tiret ou point. Rien d'insultant." });
    try {
      await rest("league_players", {
        method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: req.user.id, pseudo, updated_at: new Date().toISOString() })
      });
      res.json({ ok: true });
    } catch (e) { console.error("ligue:", e?.message); res.status(502).json({ error: "Impossible de rejoindre la ligue. Réessaie." }); }
  }

  async function quit(req, res) {
    try {
      await rest(`league_entries?user_id=eq.${req.user.id}&week=eq.${weekOf(parisDay())}`, { method: "DELETE" });
      await rest(`league_players?user_id=eq.${req.user.id}`, { method: "DELETE" });
      res.json({ ok: true });
    } catch (e) { console.error("ligue:", e?.message); res.status(502).json({ error: "Réessaie dans un moment." }); }
  }

  // Inscription à la semaine en cours : la ligue dépend du classement de la semaine précédente
  // (5 premiers : on monte, 5 derniers : on descend), puis on rejoint un groupe de 30 de la même ligue.
  async function entryFor(userId, player) {
    const week = weekOf(parisDay());
    const cur = await rest(`league_entries?week=eq.${week}&user_id=eq.${userId}&select=week,tier,grp,xp`);
    if (cur.length) return cur[0];
    let tier = Math.min(TIERS.length, Math.max(1, player.tier || 1));
    const prevWeek = weekOf(shiftDay(parisDay(), -7));
    const prev = await rest(`league_entries?week=eq.${prevWeek}&user_id=eq.${userId}&select=tier,grp,xp`);
    if (prev.length) {
      const p = prev[0];
      const group = await rest(`league_entries?week=eq.${prevWeek}&tier=eq.${p.tier}&grp=eq.${p.grp}&select=user_id,xp&order=xp.desc,updated_at.asc`);
      const rank = group.findIndex(g => g.user_id === userId) + 1;
      tier = p.tier;
      if (rank && rank <= MOVE && p.xp > 0) tier = Math.min(TIERS.length, tier + 1);
      else if (group.length >= 10 && rank > group.length - MOVE) tier = Math.max(1, tier - 1);
    }
    const counts = await rest(`league_entries?week=eq.${week}&tier=eq.${tier}&select=grp`);
    const per = new Map(); for (const c of counts) per.set(c.grp, (per.get(c.grp) || 0) + 1);
    let grp = [...per.entries()].filter(([, n]) => n < GROUP_SIZE).sort((a, b) => a[0] - b[0])[0]?.[0];
    if (grp === undefined) grp = per.size ? Math.max(...per.keys()) + 1 : 1;
    await rest("league_entries", {
      method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ week, user_id: userId, tier, grp, xp: 0, updated_at: new Date().toISOString() })
    });
    if (tier !== player.tier) await rest(`league_players?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ tier }) });
    return (await rest(`league_entries?week=eq.${week}&user_id=eq.${userId}&select=week,tier,grp,xp`))[0];
  }

  // Points de la semaine envoyés par l'appli : ne peuvent que monter, et plafonnés au maximum possible à ce jour.
  async function score(req, res) {
    const xp = Math.round(Number(req.body?.xp));
    if (!Number.isFinite(xp) || xp < 0) return res.status(400).json({ error: "Valeur invalide." });
    try {
      const player = (await rest(`league_players?user_id=eq.${req.user.id}&select=pseudo,tier`))[0];
      if (!player) return res.json({ ok: false });
      const entry = await entryFor(req.user.id, player);
      const cap = XP_PER_DAY_CAP * dayOfWeek(parisDay());
      const next = Math.min(cap, xp);
      if (next > entry.xp) {
        await rest(`league_entries?week=eq.${entry.week}&user_id=eq.${req.user.id}`, {
          method: "PATCH", body: JSON.stringify({ xp: next, updated_at: new Date().toISOString() })
        });
      }
      res.json({ ok: true });
    } catch (e) { console.error("ligue score:", e?.message); res.status(502).json({ error: "Réessaie dans un moment." }); }
  }

  async function board(req, res) {
    try {
      const player = (await rest(`league_players?user_id=eq.${req.user.id}&select=pseudo,tier`))[0];
      if (!player) return res.set("Cache-Control", "no-store").json({ joined: false });
      const entry = await entryFor(req.user.id, player);
      const rows = await rest(`league_entries?week=eq.${entry.week}&tier=eq.${entry.tier}&grp=eq.${entry.grp}&select=user_id,xp&order=xp.desc,updated_at.asc&limit=${GROUP_SIZE}`);
      const ids = rows.map(r => r.user_id);
      const names = ids.length ? await rest(`league_players?user_id=in.(${ids.join(",")})&select=user_id,pseudo`) : [];
      const pseudo = new Map(names.map(n => [n.user_id, n.pseudo]));
      const today = parisDay();
      res.set("Cache-Control", "no-store").json({
        joined: true, pseudo: player.pseudo, tier: entry.tier, tierName: TIERS[entry.tier - 1], tiers: TIERS, move: MOVE,
        daysLeft: 8 - dayOfWeek(today),
        members: rows.map((r, i) => ({ rank: i + 1, pseudo: pseudo.get(r.user_id) || "Joueur", xp: r.xp, me: r.user_id === req.user.id }))
      });
    } catch (e) { console.error("ligue:", e?.message); res.status(502).json({ error: "Le classement n'a pas pu se charger." }); }
  }

  // ---------- Rappels de série (notifications) ----------
  // Clés VAPID : variables VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si elles existent, sinon dérivées de la clé secrète
  // du serveur (stables tant qu'elle ne change pas). Elles ne servent qu'à signer les notifications.
  let vapidPublic = process.env.VAPID_PUBLIC_KEY || "", vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";
  if ((!vapidPublic || !vapidPrivate) && secret) {
    const priv = crypto.createHmac("sha256", secret).update("bonassiette-vapid-v1").digest();
    const ecdh = crypto.createECDH("prime256v1"); ecdh.setPrivateKey(priv);
    vapidPrivate = priv.toString("base64url"); vapidPublic = ecdh.getPublicKey().toString("base64url");
  }
  const PUSH_ON = Boolean(vapidPublic && vapidPrivate);
  if (PUSH_ON) webpush.setVapidDetails(`mailto:${config.supportEmail || "gamelle.support@gmail.com"}`, vapidPublic, vapidPrivate);

  const okEndpoint = (u) => { try { const x = new URL(u); return x.protocol === "https:" && u.length < 1000; } catch { return false; } };
  const okKey = (k, min, max) => typeof k === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(k) && k.length >= min && k.length <= max;
  const okDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

  function pushKey(req, res) { res.set("Cache-Control", "public, max-age=3600").json({ key: PUSH_ON ? vapidPublic : "" }); }

  async function pushSave(req, res) {
    if (!PUSH_ON) return res.status(503).json({ error: "Rappels indisponibles." });
    const s = req.body?.subscription || {}, last = req.body?.lastMealDay, streak = Math.max(0, Math.min(5000, Math.round(Number(req.body?.streak) || 0)));
    if (!okEndpoint(s.endpoint) || !okKey(s.keys?.p256dh, 40, 120) || !okKey(s.keys?.auth, 10, 40)) return res.status(400).json({ error: "Abonnement invalide." });
    try {
      await rest("push_subs", {
        method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, last_meal_day: okDay(last) ? last : null, streak, updated_at: new Date().toISOString() })
      });
      res.json({ ok: true });
    } catch (e) { console.error("rappel:", e?.message); res.status(502).json({ error: "Réessaie dans un moment." }); }
  }

  async function pushState(req, res) {
    const endpoint = req.body?.endpoint, last = req.body?.lastMealDay, streak = Math.max(0, Math.min(5000, Math.round(Number(req.body?.streak) || 0)));
    if (!okEndpoint(endpoint) || !okDay(last)) return res.status(400).json({ error: "Requête invalide." });
    try {
      await rest(`push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: "PATCH", body: JSON.stringify({ last_meal_day: last, streak, updated_at: new Date().toISOString() })
      });
      res.json({ ok: true });
    } catch (e) { console.error("rappel:", e?.message); res.status(502).json({ error: "Réessaie dans un moment." }); }
  }

  async function pushDelete(req, res) {
    const endpoint = req.body?.endpoint;
    if (!okEndpoint(endpoint)) return res.status(400).json({ error: "Requête invalide." });
    try { await rest(`push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE" }); res.json({ ok: true }); }
    catch (e) { console.error("rappel:", e?.message); res.status(502).json({ error: "Réessaie dans un moment." }); }
  }

  // Chaque soir entre 20 h et 20 h 30 (Paris) : ceux qui ont noté un repas hier mais pas encore aujourd'hui
  // reçoivent un rappel, une seule fois par jour.
  let running = false;
  async function sendReminders() {
    const p = parisParts();
    if (!PUSH_ON || running || p.h !== 20 || p.min >= 30) return;
    running = true;
    try {
      const today = dayKey(p), yesterday = shiftDay(today, -1);
      const subs = await rest(`push_subs?last_meal_day=eq.${yesterday}&streak=gte.1&or=(last_sent_day.is.null,last_sent_day.neq.${today})&select=endpoint,p256dh,auth,streak&limit=2000`);
      for (const s of subs) {
        await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", body: JSON.stringify({ last_sent_day: today }) }).catch(() => {});
        const n = s.streak;
        const payload = JSON.stringify({
          title: `🔥 Ta série de ${n} jour${n > 1 ? "s" : ""} est en danger`,
          body: "Note un repas avant minuit pour la garder. Ça prend 5 secondes.",
          tag: "serie", url: "/"
        });
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 4 * 3600, urgency: "normal" }); }
        catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
          else console.error("rappel envoi:", e?.statusCode || e?.message);
        }
      }
      if (subs.length) console.log(`Rappels de série envoyés : ${subs.length}`);
    } catch (e) { console.error("rappels:", e?.message); }
    finally { running = false; }
  }
  if (PUSH_ON) { const t = setInterval(sendReminders, 5 * 60 * 1000); t.unref?.(); }

  return { chest, join, quit, score, board, pushKey, pushSave, pushState, pushDelete, PUSH_ON };
}
