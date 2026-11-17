(() => {
  "use strict";

  // ---------- Réglages ----------
  // Réglages envoyés par le serveur (voir config.js). Vides = publicité et mesure désactivées.
  let CFG = {};
  try { CFG = JSON.parse(document.getElementById("cfg")?.textContent || "{}"); } catch { CFG = {}; }
  const ADS = { client: CFG.adsClient || "", slots: CFG.adSlots || {} };
  const GA_ID = /^G-[A-Z0-9]{6,12}$/.test(CFG.gaId || "") ? CFG.gaId : "";
  const NONCE = document.querySelector("script[nonce]")?.nonce || "";
  // Abonnement Bon'Assiette+ : l'état vient de la base (table subscriptions) après connexion.
  // Le serveur revérifie de son côté à chaque analyse photo ; ici, ça ne sert qu'à l'affichage.
  const PREMIUM = CFG.premium && typeof CFG.premium.price === "string" ? CFG.premium : null;
  let subActive = false, credits = 0; // credits : utilisations restantes d'un pack (achat unique)
  const isSubscriber = () => subActive;
  const hasAccess = () => subActive || credits > 0;

  const DATA = window.GAMELLE_DATA || { foods: [], recipes: [] };
  const FOODS = DATA.foods, RECIPES = DATA.recipes;

  // ---------- Outils ----------
  const $ = (id) => document.getElementById(id);
  // Icône du jeu dessiné (symboles #i-… en haut de la page).
  const IC = (n, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const r0 = (n) => Math.round(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const euro = (n) => n.toFixed(2).replace(".", ",") + " €";
  const nb = (n) => r0(n).toLocaleString("fr-FR");
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const ciqUrl = (code) => `https://ciqual.anses.fr/#/aliments/${encodeURIComponent(code)}`;
  const today = new Date(); const TODAY = keyOf(today);

  let onLSSet = null; // branché par le module Compte pour sauvegarder en ligne
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } onLSSet?.(k); },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith("g-")).forEach(k => localStorage.removeItem(k)); } catch { /* rien */ } }
  };

  // ---------- État ----------
  const DEFAULT_PROFILE = { sex: "h", age: 21, weight: 70, height: 175, activity: 1.55, goal: "maintien" };
  let profile = LS.get("g-profile", null);
  let days = LS.get("g-days", {});
  let badges = LS.get("g-badges", {});
  let frozen = LS.get("g-frozen", []);        // jours couverts par une protection de série
  let freezes = LS.get("g-freezes", 0);       // protections disponibles (2 au maximum)
  let xp = LS.get("g-xp", 0);
  let xpDay = LS.get("g-xpday", {});          // points gagnés par jour (plafond quotidien)
  let miles = LS.get("g-miles", []);          // paliers de série déjà célébrés
  let measures = LS.get("g-measures", []);    // [{d: "AAAA-MM-JJ", w: kg, waist: cm|null}]
  const kitchen = new Set(["plaques", "micro", "bouilloire"]);
  const meals = () => days[TODAY] || [];
  const saveDays = () => LS.set("g-days", days);
  const P = () => ({ ...DEFAULT_PROFILE, ...(profile || {}) });

  // ---------- Objectifs ----------
  // Mifflin-St Jeor × activité ; lipides 35 % (repère ANSES 35-40 %) ; glucides = reste.
  function targets(p) {
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "h" ? 5 : -161);
    let kcal = bmr * Number(p.activity);
    if (p.goal === "muscle") kcal *= 1.10;
    if (p.goal === "perte") kcal *= 0.85;
    kcal = Math.max(kcal, p.sex === "h" ? 1800 : 1500);
    // Au-delà d'un IMC de 30, les protéines se calculent sur le poids d'un IMC de 25 (sinon le besoin est surestimé).
    const h2 = (p.height / 100) ** 2, refW = p.weight / h2 >= 30 ? 25 * h2 : p.weight;
    const prot = refW * (p.goal === "muscle" ? 1.8 : p.goal === "perte" ? 1.6 : 1.2);
    const lip = kcal * 0.35 / 9;
    const gluc = Math.max(0, (kcal - prot * 4 - lip * 9) / 4);
    return { kcal: r0(kcal), prot: r0(prot), gluc: r0(gluc), lip: r0(lip), bmr: r0(bmr) };
  }
  const sum = (list) => list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, prot: a.prot + m.prot, gluc: a.gluc + m.gluc, lip: a.lip + m.lip }), { kcal: 0, prot: 0, gluc: 0, lip: 0 });
  const GOALS = { maintien: "Garder la forme", muscle: "Prendre du muscle", perte: "Perdre un peu" };

  // ---------- Formulaire de profil (partagé accueil / profil) ----------
  function profileFormHTML(prefix) {
    return `<div class="pform">
      <div class="grid2">
        <label class="f" for="${prefix}sex">Sexe<select id="${prefix}sex"><option value="h">Homme</option><option value="f">Femme</option></select></label>
        <label class="f" for="${prefix}age">Âge<input type="number" id="${prefix}age" min="18" max="99" inputmode="numeric"></label>
        <label class="f" for="${prefix}weight">Poids (kg)<input type="number" id="${prefix}weight" min="35" max="250" inputmode="decimal"></label>
        <label class="f" for="${prefix}height">Taille (cm)<input type="number" id="${prefix}height" min="130" max="230" inputmode="numeric"></label>
      </div>
      <label class="f" for="${prefix}activity">Activité
        <select id="${prefix}activity">
          <option value="1.375">Peu active : cours assis, un peu de marche</option>
          <option value="1.55">Moyenne : sport 2 à 3 fois par semaine</option>
          <option value="1.725">Élevée : sport presque tous les jours</option>
        </select>
      </label>
      <div class="fieldset">Objectif
        <div class="seg" id="${prefix}goal" role="group" aria-label="Objectif">
          ${Object.entries(GOALS).map(([k, v]) => `<button type="button" data-g="${k}" aria-pressed="false">${v}</button>`).join("")}
        </div>
      </div>
      <p class="small muted" id="${prefix}target" aria-live="polite"></p>
    </div>`;
  }
  function mountProfileForm(container, prefix) {
    container.innerHTML = profileFormHTML(prefix);
    const p = P();
    $(prefix + "sex").value = p.sex; $(prefix + "age").value = p.age; $(prefix + "weight").value = p.weight;
    $(prefix + "height").value = p.height; $(prefix + "activity").value = String(p.activity);
    const goalBtns = container.querySelectorAll(`#${prefix}goal button`);
    goalBtns.forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.g === p.goal));
      b.addEventListener("click", () => { goalBtns.forEach(x => x.setAttribute("aria-pressed", String(x === b))); line(); });
    });
    const line = () => { const t = targets(readProfile(prefix)); $(prefix + "target").textContent = `Objectif : ${nb(t.kcal)} kcal · ${t.prot} g de protéines · ${t.gluc} g de glucides · ${t.lip} g de lipides par jour.`; };
    ["sex", "age", "weight", "height", "activity"].forEach(id => $(prefix + id).addEventListener("input", line));
    line();
  }
  function readProfile(prefix) {
    const c = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) && v ? Math.min(b, Math.max(a, v)) : d; };
    return {
      sex: $(prefix + "sex").value === "f" ? "f" : "h",
      age: c($(prefix + "age").value, 18, 99, 21), weight: c($(prefix + "weight").value, 35, 250, 70),
      height: c($(prefix + "height").value, 130, 230, 175),
      activity: [1.375, 1.55, 1.725].includes(Number($(prefix + "activity").value)) ? Number($(prefix + "activity").value) : 1.55,
      goal: document.querySelector(`#${prefix}goal button[aria-pressed="true"]`)?.dataset.g || "maintien"
    };
  }

  // ---------- Accueil guidé ----------
  function openOnboarding(step = 1) {
    mountProfileForm($("onbForm"), "o-");
    showStep(step);
    $("onb").hidden = false;
  }
  function showStep(n) {
    document.querySelectorAll(".onb-step").forEach(s => s.hidden = s.dataset.step !== String(n));
    $("onb").scrollTop = 0;
    const first = document.querySelector(`.onb-step[data-step="${n}"] button, .onb-step[data-step="${n}"] input`);
    first?.focus({ preventScroll: true });
  }
  $("onb").addEventListener("click", (e) => { const b = e.target.closest("[data-next]"); if (b) showStep(b.dataset.next); });
  $("onbCalc").addEventListener("click", () => {
    const p = readProfile("o-"), t = targets(p);
    $("onbResult").innerHTML = `
      <div class="line tot"><span>Calories</span><span>${nb(t.kcal)} kcal</span></div>
      <div class="line"><span><i class="dot d-p"></i>Protéines</span><span>${t.prot} g</span></div>
      <div class="line"><span><i class="dot d-g"></i>Glucides</span><span>${t.gluc} g</span></div>
      <div class="line"><span><i class="dot d-l"></i>Lipides</span><span>${t.lip} g</span></div>`;
    $("onbExplain").textContent = `Au repos, ton corps dépense environ ${nb(t.bmr)} kcal par jour (formule de Mifflin-St Jeor). On ajuste selon ton activité et ton objectif « ${GOALS[p.goal].toLowerCase()} ». Tu pourras tout modifier dans Profil.`;
    showStep(3);
  });
  $("onbDone").addEventListener("click", () => {
    profile = readProfile("o-"); LS.set("g-profile", profile);
    $("onb").hidden = true;
    track("onboarding_termine", { objectif: profile.goal });
    renderAll(); toast("Objectif enregistré");
  });

  // ---------- Défis et badges ----------
  const DEFIS = [
    { txt: "Atteindre ton objectif de protéines", test: (s, t) => s.prot >= t.prot },
    { txt: "Noter 3 repas ou collations aujourd'hui", test: (s, t, m) => m.length >= 3 },
    { txt: "Manger un fruit", test: (s, t, m) => m.some(x => /banane|pomme|fruit/i.test(x.name)) },
    { txt: "Cuisiner un repas pas cher", test: (s, t, m) => m.some(x => x.recipe) },
    { txt: "Un repas d'au moins 30 g de protéines", test: (s, t, m) => m.some(x => x.prot >= 30) },
    { txt: "Rester entre 90 et 110 % de ton objectif de calories", test: (s, t) => s.kcal >= t.kcal * 0.9 && s.kcal <= t.kcal * 1.1 },
    { txt: "Noter ton petit-déjeuner", test: (s, t, m) => m.some(x => Number(String(x.time).slice(0, 2)) < 11) }
  ];
  const defiToday = () => DEFIS[Number(TODAY.replaceAll("-", "")) % DEFIS.length];
  const logged = (k) => (days[k] || []).length > 0;
  const active = (k) => logged(k) || frozen.includes(k);
  function streak() {
    let n = 0; const d = new Date(today);
    if (!active(keyOf(d))) d.setDate(d.getDate() - 1);
    while (active(keyOf(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  // Au démarrage : si des jours ont été manqués depuis le dernier repas noté,
  // les protections de série les couvrent (une protection par jour manqué).
  function applyFreezes() {
    const loggedKeys = Object.keys(days).filter(logged).sort();
    if (!loggedKeys.length || !freezes) return;
    const last = loggedKeys[loggedKeys.length - 1];
    const gap = []; const d = new Date(today); d.setDate(d.getDate() - 1);
    while (keyOf(d) > last && !active(keyOf(d))) { gap.push(keyOf(d)); d.setDate(d.getDate() - 1); }
    if (gap.length && gap.length <= freezes) {
      frozen = [...frozen, ...gap]; freezes -= gap.length;
      LS.set("g-frozen", frozen); LS.set("g-freezes", freezes);
      setTimeout(() => toast(gap.length > 1 ? `${gap.length} protections ont sauvé ta série` : "Une protection a sauvé ta série"), 600);
    }
  }

  // ---------- Points et niveaux ----------
  const LEVELS = [
    // Grades de la brigade de cuisine. La Toque d'or demande au moins 250 jours au plafond de points.
    [0, "Plongeur"], [100, "Commis"], [300, "Apprenti"], [700, "Cuistot"], [1300, "Cuisinier"],
    [2200, "Chef de partie"], [3500, "Sous-chef"], [5500, "Chef de cuisine"], [9000, "Chef étoilé"], [15000, "Grand chef"], [30000, "Toque d'or"]
  ];
  function levelOf(x) {
    let i = 0; while (i + 1 < LEVELS.length && x >= LEVELS[i + 1][0]) i++;
    const next = LEVELS[i + 1];
    return { n: i + 1, name: LEVELS[i][1], from: LEVELS[i][0], to: next ? next[0] : null };
  }
  const XP_DAY_MAX = 120;
  function gainXP(amount) {
    const already = xpDay[TODAY] || 0;
    const add = Math.max(0, Math.min(amount, XP_DAY_MAX - already));
    if (!add) return 0;
    const before = levelOf(xp).n;
    xp += add; xpDay = { [TODAY]: already + add }; // on ne garde que le jour en cours
    LS.set("g-xp", xp); LS.set("g-xpday", xpDay);
    bumpWeek(add);
    const after = levelOf(xp);
    if (after.n > before) setTimeout(() => celebrate(`Nouveau grade\u00a0: ${after.name}`, `Tu passes au grade ${after.n}. Ta rigueur paie, continue comme ça.`), 400);
    return add;
  }

  // ---------- Paliers de série ----------
  const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
  function checkMilestone() {
    const n = streak();
    if (n && n % 7 === 0 && !LS.get("g-freeze-at", []).includes(n)) {
      LS.set("g-freeze-at", [...LS.get("g-freeze-at", []), n]);
      if (freezes < 2) { freezes++; LS.set("g-freezes", freezes); }
    }
    if (MILESTONES.includes(n) && !miles.includes(n)) {
      miles = [...miles, n]; LS.set("g-miles", miles);
      gainXP(n >= 30 ? 50 : 25);
      celebrate(`${n} jours d'affilée`, n % 7 === 0
        ? "Bravo ! Tu gagnes une protection de série : si tu oublies un jour, ta série est sauvée."
        : "Bravo, tu tiens ta série. Reviens demain pour la faire grimper.");
         renderDay();
    }
  }
  function celebrate(title, text, icon = "flame") {
    $("celTitle").textContent = title; $("celText").textContent = text; $("celIcon").innerHTML = IC(icon, "ic-xl");
    $("celebrate").hidden = false; $("celOk").focus();
  }
  $("celOk").addEventListener("click", () => { $("celebrate").hidden = true; });
  const BADGES = [
    { id: "first", t: "Premier repas", d: "Noter ton premier repas", test: () => Object.values(days).some(l => l.length) },
    { id: "s3", t: "3 jours d'affilée", d: "Une série de 3 jours", test: () => streak() >= 3 },
    { id: "s7", t: "Une semaine pleine", d: "Une série de 7 jours", test: () => streak() >= 7 },
    { id: "s30", t: "Un mois de régularité", d: "Une série de 30 jours", test: () => streak() >= 30 },
    { id: "chef", t: "Chef malin", d: "Cuisiner 5 recettes pas chères", test: () => Object.values(days).flat().filter(m => m.recipe).length >= 5 },
    { id: "prot3", t: "Protéines au rendez-vous", d: "Objectif de protéines atteint 3 jours", test: () => Object.values(days).filter(l => sum(l).prot >= targets(P()).prot).length >= 3 },
    { id: "defi5", t: "Défis relevés", d: "Réussir 5 défis du jour", test: () => LS.get("g-defis", []).length >= 5 },
    { id: "eau5", t: "Bien hydraté", d: "Objectif d'eau atteint 5 jours", test: () => Object.values(water).filter(n => n >= waterGoal()).length >= 5 },
    { id: "sport1", t: "Première séance", d: "Noter une séance d'entraînement", test: () => Object.keys(trains).length >= 1 },
    { id: "sport3", t: "Rigueur", d: "3 séances en 7 jours", test: () => trainsWeek() >= 3 },
    { id: "sport20", t: "Increvable", d: "Noter 20 séances", test: () => Object.keys(trains).length >= 20 }
  ];
  function checkBadges() {
    let fresh = null;
    for (const b of BADGES) if (!badges[b.id] && b.test()) { badges[b.id] = TODAY; fresh = b; }
    LS.set("g-badges", badges);
    if (fresh) toast(`Badge débloqué : ${fresh.t}`);
  }

  // ---------- Vue Aujourd'hui ----------
  function renderDay() {
    const p = P(), t = targets(p), list = meals(), s = sum(list);
    const left = t.kcal - s.kcal;
    $("kcalLeft").textContent = nb(Math.abs(left));
    $("kcalLbl").textContent = left >= 0 ? "kcal restantes" : "kcal en plus";
    $("ringArc").style.strokeDashoffset = (326.7 * (1 - Math.min(1, s.kcal / t.kcal))).toFixed(1);
    $("ringArc").classList.toggle("over", left < 0);
    const bar = (k, b, n) => { $(b).style.width = Math.min(100, s[k] / Math.max(1, t[k]) * 100) + "%"; $(n).textContent = `${r0(s[k])} / ${t[k]} g`; };
    bar("prot", "barP", "numP"); bar("gluc", "barG", "numG"); bar("lip", "barL", "numL");
    $("goalLine").textContent = `${GOALS[p.goal]} : ${nb(t.kcal)} kcal et ${t.prot} g de protéines par jour`;
    const st = streak();
    $("streakN").textContent = st;
    const lv = levelOf(xp);
    $("lvName").textContent = `Grade ${lv.n} · ${lv.name}`;
    $("lvXp").textContent = lv.to ? `${nb(xp - lv.from)} / ${nb(lv.to - lv.from)} XP` : `${nb(xp)} XP`;
    $("lvBar").style.width = (lv.to ? Math.min(100, (xp - lv.from) / (lv.to - lv.from) * 100) : 100) + "%";
    $("lvFreeze").innerHTML = IC("snow") + (freezes ? ` ${freezes} protection${freezes > 1 ? "s" : ""} de série` : " Une protection tous les 7 jours de série");
    $("lvFreeze").classList.add("lvfreeze");
    const hour = new Date().getHours();
    const risk = !logged(TODAY) && st > 0;
    $("streakAlert").hidden = !risk;
    if (risk) $("streakAlert").innerHTML = hour >= 17
      ? `<strong>${IC("flame")} Série de ${st} jour${st > 1 ? "s" : ""} :</strong> note un repas avant minuit.`
      : `<strong>${IC("flame")} Série de ${st} jour${st > 1 ? "s" : ""}.</strong> Note un repas pour la prolonger.`;

    const d = defiToday(), ok = d.test(s, t, list);
    $("defiTxt").textContent = d.txt;
    $("defi").classList.toggle("done", ok);
    $("defiIco").innerHTML = IC(ok ? "check" : "target");
    $("defiState").textContent = ok ? "Réussi" : "";
    if (ok) { const done = LS.get("g-defis", []); if (!done.includes(TODAY)) { done.push(TODAY); LS.set("g-defis", done); const g = gainXP(20); toast(g ? `Défi du jour réussi · +${g} XP` : "Défi du jour réussi"); } }

    $("mealCount").textContent = list.length ? `${list.length} repas` : "";
    $("meals").innerHTML = list.length ? list.map((m, i) => `
      <div class="meal"><span class="t">${esc(m.name)}${m.grams ? ` <span class="muted">${nb(m.grams)} g</span>` : m.qty && m.qty !== 1 ? ` <span class="muted">× ${esc(String(m.qty).replace(".", ","))}</span>` : ""}</span><span class="k">${nb(m.kcal)} kcal</span>
      <div class="sub"><span>${esc(m.time)}</span><span>P ${r0(m.prot)} g</span><span>G ${r0(m.gluc)} g</span><span>L ${r0(m.lip)} g</span>
      <button class="del" type="button" data-i="${i}">Retirer</button></div></div>`).join("")
      : `<div class="empty"><h3>Rien de noté pour l'instant</h3><p class="small muted">Cherche ce que tu as mangé dans « Ajouter un repas » : un geste suffit, et ta série démarre.</p></div>`;

    renderRecent();
    renderWater();
    renderTrain();
    renderChest();
    renderPhotoHero();
    renderRemind();
    checkBadges();
  }

  function renderRecent() {
    const seen = new Map();
    Object.keys(days).sort().reverse().forEach(k => (days[k] || []).slice().reverse().forEach(m => {
      const key = m.name + "|" + (m.grams ? m.grams + "g" : (m.qty || 1));
      if (!seen.has(key)) seen.set(key, { ...m, n: 0 });
      seen.get(key).n++;
    }));
    const top = [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    $("recentWrap").hidden = !top.length;
    $("recent").innerHTML = top.map((m, i) => `<button class="chip" type="button" data-r="${i}">${esc(m.name)}<b>${nb(m.kcal)}</b></button>`).join("");
    $("recent").onclick = (e) => { const b = e.target.closest("[data-r]"); if (b) addMeal(top[Number(b.dataset.r)]); };
  }

  function addMeal(m) {
    const d = new Date();
    const item = {
      name: String(m.name).slice(0, 80), kcal: r0(m.kcal), prot: r0(m.prot), gluc: r0(m.gluc), lip: r0(m.lip),
      time: `${pad(d.getHours())}h${pad(d.getMinutes())}`, qty: m.qty || 1, ...(m.grams > 0 ? { grams: r0(m.grams) } : {}), ...(m.recipe ? { recipe: true } : {})
    };
    days[TODAY] = [...meals(), item];
    saveDays();
    track(item.recipe ? "recette_mangee" : "repas_ajoute", { nb_jour: days[TODAY].length, serie: streak() });
    const before = Number($("streakN").textContent);
    const g = gainXP(item.recipe ? 15 : 10);
    renderDay();
    const after = streak();
    toast(after > before && after > 1 ? `Série : ${after} jours d'affilée` : `${item.name} ajouté${g ? ` · +${g} XP` : ""}`);
    checkMilestone();
    pushSync();
    if (days[TODAY].length === CHEST_MEALS) setTimeout(() => { if (LS.get("g-chest", "") !== TODAY) toast("Ton coffre du jour est prêt"); }, 1600);
  }

  // Catégories et recherche
  const CATS = ["Tout", ...new Set(FOODS.map(f => f.cat))];
  let cat = "Tout";
  $("cats").innerHTML = CATS.map(c => `<button class="chip" type="button" data-c="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join("");
  $("cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    cat = cat === b.dataset.c ? "Tout" : b.dataset.c;
    $("cats").querySelectorAll("[data-c]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.c === cat)));
    renderResults();
  });
  function renderResults() {
    const q = norm($("search").value.trim());
    if (!q && cat === "Tout") { $("results").innerHTML = ""; return; }
    // Une recherche tapée parcourt tout le catalogue ; la catégorie sert à parcourir sans taper.
    const hits = FOODS.filter(f => q ? norm(f.name + " " + f.tags + " " + f.cat).includes(q) : f.cat === cat).slice(0, 30);
    $("results").innerHTML = hits.length ? hits.map(f => `
      <button class="res" type="button" data-f="${FOODS.indexOf(f)}"><span>${esc(f.name)}</span><span class="k">${nb(f.kcal)} kcal</span>
      <span class="sub">${esc(f.portion)} · P ${f.prot} g · G ${f.gluc} g · L ${f.lip} g</span></button>`).join("")
      : `<p class="small muted pad6">Pas trouvé. Saisis-le à la main, ou propose-le plus bas pour tout le monde.</p>`;
  }
  $("search").addEventListener("input", () => {
    if ($("search").value.trim() && cat !== "Tout") {
      cat = "Tout";
      $("cats").querySelectorAll("[data-c]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.c === cat)));
    }
    renderResults();
  });
  $("results").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) openSheet(FOODS[Number(b.dataset.f)]); });

  // ---------- Feuille de portion ----------
  // Poids de la portion de référence (somme des ingrédients Ciqual) : sert à passer des grammes aux macros.
  let sheetFood = null, sheetQty = 1, sheetGrams = 0, lastFocus = null;
  const portionG = (f) => f.src.reduce((a, s) => a + (Number(s[1]) || 0), 0);
  function openSheet(f) {
    sheetFood = f; sheetQty = 1; sheetGrams = 0; lastFocus = document.activeElement;
    $("sheetGrams").value = "";
    $("sheetTitle").textContent = f.name;
    $("sheetPortion").textContent = "Portion de référence : " + f.portion;
    $("sheetSrc").innerHTML = f.community ? `<p>Repas proposé par un utilisateur, vérifié par Bon'Assiette. Valeurs approximatives pour une portion${f.price ? ` · environ ${euro(f.price)}` : ""}.</p>` : `<p>Table Ciqual 2025, ANSES. Valeurs calculées pour la portion :</p><ul>${f.src.map(([code, g, nm]) => `<li>${esc(nm)} — ${g} g <span class="mono">(code ${esc(code)})</span></li>`).join("")}</ul><p class="mono">${esc(ciqUrl(f.src[0][0]).replace("https://", ""))}</p>`;
    setQty(1);
    $("sheetBg").hidden = false; $("sheet").hidden = false;
    $("sheetAdd").focus();
  }
  function setQty(q, grams = 0) {
    sheetQty = q; sheetGrams = grams;
    $("sheetQty").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(!grams && Number(b.dataset.q) === q)));
    if (!grams) { const pg = portionG(sheetFood); $("sheetGrams").placeholder = pg ? `ex. ${r0(pg * q)}` : "ex. 180"; }
    const f = sheetFood;
    $("sheetVals").innerHTML = `
      <div class="line tot"><span>Calories${grams ? ` pour ${nb(grams)} g` : ""}</span><span>${nb(f.kcal * q)} kcal</span></div>
      <div class="line"><span><i class="dot d-p"></i>Protéines</span><span>${r0(f.prot * q)} g</span></div>
      <div class="line"><span><i class="dot d-g"></i>Glucides</span><span>${r0(f.gluc * q)} g</span></div>
      <div class="line"><span><i class="dot d-l"></i>Lipides</span><span>${r0(f.lip * q)} g</span></div>`;
  }
  function closeSheet() { $("sheetBg").hidden = true; $("sheet").hidden = true; sheetFood = null; lastFocus?.focus?.(); }
  $("sheetQty").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) { $("sheetGrams").value = ""; setQty(Number(b.dataset.q)); } });
  // Saisie au gramme : 180 g de pâtes = 180 / poids de la portion de référence.
  $("sheetGrams").addEventListener("input", () => {
    const g = Math.min(3000, Math.max(0, Number($("sheetGrams").value) || 0)), pg = portionG(sheetFood);
    if (g > 0 && pg > 0) setQty(g / pg, g); else setQty(1);
  });
  $("sheetGrams").addEventListener("keydown", (e) => { if (e.key === "Enter") $("sheetAdd").click(); });
  $("sheetCancel").addEventListener("click", closeSheet);
  $("sheetBg").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
  $("sheetAdd").addEventListener("click", () => {
    const f = sheetFood, q = sheetQty; if (!f || !(q > 0)) return;
    addMeal({ name: f.name, kcal: f.kcal * q, prot: f.prot * q, gluc: f.gluc * q, lip: f.lip * q, qty: sheetGrams ? 1 : q, grams: sheetGrams });
    closeSheet(); $("search").value = ""; renderResults();
  });

  // Saisie manuelle
  $("customBtn").addEventListener("click", () => { $("customBox").hidden = !$("customBox").hidden; if (!$("customBox").hidden) $("cName").focus(); });
  $("cAdd").addEventListener("click", () => {
    const name = $("cName").value.trim(), kcal = Number($("cK").value);
    if (!name || !(kcal > 0 && kcal <= 3000)) { toast("Indique au moins un nom et des calories"); return; }
    const v = (id, max) => Math.min(max, Math.max(0, Number($(id).value) || 0));
    addMeal({ name, kcal, prot: v("cP", 300), gluc: v("cG", 500), lip: v("cL", 300) });
    ["cName", "cK", "cP", "cG", "cL"].forEach(id => $(id).value = "");
    $("customBox").hidden = true;
  });

  // Proposition d'un repas pour tout le monde : envoyé au serveur, qui estime les valeurs manquantes.
  let sugLast = null;
  $("sugBtn").addEventListener("click", () => {
    $("sugBox").hidden = !$("sugBox").hidden;
    if ($("sugBox").hidden) return;
    $("sMsg").textContent = sbUser ? "" : "Connecte-toi dans Profil pour proposer un repas (gratuit, sans mot de passe).";
    $("sName").value = $("sName").value || $("search").value.trim(); $("sName").focus();
  });
  $("sSend").addEventListener("click", async () => {
    if (!sb || !sbUser) { $("sMsg").textContent = "Connecte-toi dans Profil pour proposer un repas."; return; }
    const name = $("sName").value.trim();
    if (name.length < 3) { $("sMsg").textContent = "Donne un nom au repas."; return; }
    const body = { name };
    for (const [id, k] of [["sPortion", "portion_g"], ["sK", "kcal"], ["sP", "prot"], ["sG", "gluc"], ["sL", "lip"], ["sPrice", "price"]]) {
      const v = $(id).value.trim(); if (v !== "") body[k] = Number(v.replace(",", "."));
    }
    $("sSend").disabled = true; $("sMsg").textContent = "Envoi et estimation…"; $("sResult").hidden = true;
    const r = await apiPost("/api/suggest", body);
    $("sSend").disabled = false;
    if (r?.error) { $("sMsg").textContent = r.error; return; }
    sugLast = r; track("repas_propose");
    const est = new Set(r.estimated || []);
    const row = (label, k, unit) => r[k] == null ? "" : `<div class="line"><span>${label}</span><span>${est.has(k) ? "≈ " : ""}${k === "price" ? euro(r[k]) : nb(r[k]) + unit}</span></div>`;
    $("sVals").innerHTML = `<div class="head">${esc(r.name)}</div>` + row("Portion", "portion_g", " g") + row("Calories", "kcal", " kcal")
      + row("Protéines", "prot", " g") + row("Glucides", "gluc", " g") + row("Lipides", "lip", " g") + row("Prix", "price", "");
    $("sMsg").textContent = est.size ? "Merci ! Proposition envoyée. Les valeurs avec ≈ sont estimées : on les vérifie avant publication." : "Merci ! Proposition envoyée, on la vérifie avant publication.";
    $("sAddDay").hidden = !(r.kcal > 0);
    $("sResult").hidden = false;
    ["sName", "sPortion", "sK", "sP", "sG", "sL", "sPrice"].forEach(id => $(id).value = "");
  });
  $("sAddDay").addEventListener("click", () => {
    const r = sugLast; if (!r || !(r.kcal > 0)) return;
    addMeal({ name: r.name, kcal: r.kcal, prot: r.prot || 0, gluc: r.gluc || 0, lip: r.lip || 0 });
    $("sAddDay").hidden = true;
  });

  $("meals").addEventListener("click", (e) => {
    const b = e.target.closest(".del"); if (!b) return;
    days[TODAY] = meals().filter((_, i) => i !== Number(b.dataset.i));
    if (!days[TODAY].length) delete days[TODAY];
    saveDays(); renderDay();
  });

  // ---------- Eau ----------
  // Repère EFSA : environ 1,6 L de boissons par jour pour une femme, 2 L pour un homme.
  const GLASS_ML = 250;
  let water = LS.get("g-water", {});            // {"AAAA-MM-JJ": nombre de verres}
  const waterGoal = () => (P().sex === "f" ? 7 : 8);
  const liters = (ml) => (ml / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " L";
  const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - i); return keyOf(d); });
  const waterWeek = () => lastDays(7).filter(k => (water[k] || 0) >= waterGoal()).length;
  function renderWater() {
    const n = water[TODAY] || 0, goal = waterGoal();
    $("glasses").innerHTML = Array.from({ length: Math.max(goal, n) }, (_, i) =>
      `<button type="button" class="glass ${i < n ? "on" : ""}" data-w="${i}" aria-pressed="${i < n}" aria-label="${i + 1} verre${i ? "s" : ""}"></button>`).join("");
    $("waterNum").textContent = `${liters(n * GLASS_ML)} / ${liters(goal * GLASS_ML)}`;
    $("waterLine").textContent = n >= goal ? "Objectif atteint" : `Encore ${goal - n} verre${goal - n > 1 ? "s" : ""} de 25 cl`;
    $("waterMinus").disabled = !n;
  }
  function setWater(n) {
    n = Math.max(0, Math.min(20, n));
    water = { ...water, [TODAY]: n };
    if (!n) delete water[TODAY];
    LS.set("g-water", water);
    if (n >= waterGoal() && LS.get("g-water-xp", "") !== TODAY) {
      LS.set("g-water-xp", TODAY);
      const g = gainXP(10);
      track("objectif_eau");
      renderDay(); toast(`Objectif d'eau atteint${g ? ` · +${g} XP` : ""}`);
      return;
    }
    renderWater();
  }
  $("glasses").addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]"); if (!b) return;
    const i = Number(b.dataset.w), n = water[TODAY] || 0;
    setWater(i === n - 1 ? n - 1 : i + 1);
  });
  $("waterPlus").addEventListener("click", () => setWater((water[TODAY] || 0) + 1));
  $("waterMinus").addEventListener("click", () => setWater((water[TODAY] || 0) - 1));

  // ---------- Entraînement ----------
  const SPORTS = ["Muscu", "Course", "Foot", "Vélo", "Natation", "Autre"];
  const DURS = [30, 45, 60, 90];
  let trains = LS.get("g-train", {});           // {"AAAA-MM-JJ": {t: sport, min: durée}}
  const pick = { t: "Muscu", min: 60 };
  const trainsWeek = () => lastDays(7).filter(k => trains[k]).length;
  const segHTML = (vals, cur, fmt) => vals.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(fmt(v))}</button>`).join("");
  function renderTrain() {
    const s = trains[TODAY], open = !$("trainForm").hidden;
    $("trainNum").textContent = `${trainsWeek()} sur 7 jours`;
    $("trainBtn").hidden = Boolean(s) || open;
    $("trainDone").hidden = !s;
    if (s) { $("trainForm").hidden = true; $("trainTxt").textContent = `Séance notée : ${s.t}, ${s.min} min`; }
  }
  function mountTrainForm() {
    $("trainType").innerHTML = segHTML(SPORTS, pick.t, v => v);
    $("trainDur").innerHTML = segHTML(DURS, pick.min, v => (v === 90 ? "1 h 30+" : v === 60 ? "1 h" : `${v} min`));
  }
  $("trainBtn").addEventListener("click", () => { mountTrainForm(); $("trainForm").hidden = false; renderTrain(); });
  $("trainCancel").addEventListener("click", () => { $("trainForm").hidden = true; renderTrain(); });
  $("trainType").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { pick.t = b.dataset.v; mountTrainForm(); } });
  $("trainDur").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { pick.min = Number(b.dataset.v); mountTrainForm(); } });
  $("trainOk").addEventListener("click", () => {
    trains = { ...trains, [TODAY]: { t: pick.t, min: pick.min } };
    LS.set("g-train", trains);
    $("trainForm").hidden = true;
    let g = 0;
    if (LS.get("g-train-xp", "") !== TODAY) { LS.set("g-train-xp", TODAY); g = gainXP(20); } // une seule fois par jour
    track("seance_notee", { sport: pick.t, minutes: pick.min });
    renderDay(); toast(`Séance notée${g ? ` · +${g} XP` : ""}`);
  });
  $("trainUndo").addEventListener("click", () => {
    const { [TODAY]: _, ...rest } = trains; trains = rest;
    LS.set("g-train", trains); renderTrain();
  });

  // ---------- Photo de l'assiette ----------
  // La photo est réduite sur le téléphone, envoyée au serveur Bon'Assiette qui la fait analyser, puis oubliée.
  let wantPlus = false, photo = null, photoRun = 0, photoFocus = null, photoReady = false;
  // Réservé aux abonnés Bon'Assiette+ : les autres voient ce que fait la fonction et peuvent s'abonner.
  $("photoBtn").addEventListener("click", () => {
    if (hasAccess()) {
      if (photoReady) $("photoIn").click(); else toast("L'analyse photo est momentanément indisponible. Réessaie plus tard.");
      return;
    }
    if (!sbUser && SB && CFG.engage?.welcome) { toast(`Crée ton compte gratuit : ${CFG.engage.welcome} analyses photo offertes`); show("profil"); $("accEmail")?.focus(); return; }
    openPrem("photo");
  });
  function openPrem(fonction) {
    track("premium_interet", { fonction });
    photoFocus = document.activeElement;
    renderPremSheet();
    $("premBg").hidden = false; $("premSheet").hidden = false; ($("premSub").hidden ? $("premOk") : $("premSub")).focus();
  }
  // Contenu de la fenêtre selon la situation : abonnement pas encore ouvert, pas connecté, ou prêt à payer.
  function renderPremSheet() {
    const ready = Boolean(PREMIUM && sb);
    $("premSub").hidden = !ready; $("premPack").hidden = true;
    if (!ready) {
      $("premNote").textContent = "L'abonnement Bon'Assiette+ arrive bientôt. En attendant, tout le reste de l'appli reste gratuit.";
      $("premOk").textContent = "J'ai compris";
      return;
    }
    $("premSub").textContent = sbUser ? `S'abonner · ${PREMIUM.price}` : "Se connecter pour s'abonner";
    $("premNote").textContent = sbUser
      ? `${PREMIUM.price}, sans engagement : tu résilies quand tu veux depuis Profil. Paiement sécurisé par Stripe. Le reste de l'appli reste gratuit.`
      : `${PREMIUM.price}, sans engagement. Connecte-toi d'abord (ou crée ton compte gratuit, sans mot de passe) pour retrouver ton abonnement sur tous tes appareils.`;
    $("premOk").textContent = "Plus tard";
    const pack = PREMIUM.pack;
    $("premPack").hidden = !pack;
    if (pack) $("premPack").textContent = sbUser ? `Ou ${pack.credits} utilisations pour ${pack.price}, sans abonnement` : `Ou un pack de ${pack.credits} utilisations · ${pack.price}`;
  }
  const closePrem = () => { $("premBg").hidden = true; $("premSheet").hidden = true; photoFocus?.focus?.(); };
  $("premOk").addEventListener("click", closePrem);
  // Pack d'utilisations : achat unique, pour qui ne veut pas s'abonner.
  async function buyPack(btn) {
    if (!sbUser) { wantPlus = true; closePrem(); show("profil"); $("accEmail")?.focus(); return; }
    btn.disabled = true;
    const r = await apiPost("/api/checkout", { pack: true });
    btn.disabled = false;
    if (r?.url) { track("pack_debut"); location.assign(r.url); } else toast(r?.error || "Le paiement n'a pas pu démarrer. Réessaie.");
  }
  $("premPack").addEventListener("click", () => buyPack($("premPack")));
  $("accBuyPack").addEventListener("click", () => buyPack($("accBuyPack")));
  // Une utilisation du pack vient d'être consommée (le serveur la décompte ; ici on met l'affichage à jour).
  function creditUsed() {
    if (subActive || credits <= 0) return;
    credits--; renderPremium();
    try { localStorage.setItem("g-credits", String(credits)); } catch { /* stockage indisponible */ }
    toast(credits > 0 ? `Il te reste ${credits} analyse${credits > 1 ? "s" : ""}` : "C'était ta dernière analyse. Le coffre du jour peut t'en offrir une, ou passe à Bon'Assiette+.");
  }
  $("premBg").addEventListener("click", closePrem);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("premSheet").hidden) closePrem(); });
  $("premSub").addEventListener("click", async () => {
    if (!sbUser) { wantPlus = true; closePrem(); show("profil"); $("accEmail")?.focus(); return; }
    $("premSub").disabled = true;
    const r = await apiPost("/api/checkout");
    $("premSub").disabled = false;
    if (r?.url) { track("abonnement_debut"); location.assign(r.url); } else toast(r?.error || "Le paiement n'a pas pu démarrer. Réessaie.");
  });
  // Appel d'une adresse de l'API avec le jeton de connexion.
  async function apiPost(url, body) {
    const { data } = await sb.auth.getSession().catch(() => ({ data: null }));
    const token = data?.session?.access_token;
    if (!token) return { error: "Reconnecte-toi d'abord." };
    const headers = { authorization: `Bearer ${token}` };
    if (body) headers["content-type"] = "application/json";
    const r = await fetch(url, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r) return { error: navigator.onLine === false ? "Pas de connexion internet." : "Le serveur ne répond pas. Réessaie." };
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || "Ça n'a pas marché. Réessaie.", status: r.status };
  }
  fetch("/api/status", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(s => { photoReady = Boolean(s?.photo); })
    .catch(() => {});
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("lecture"));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("format"));
        img.onload = () => {
          const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function photoState(msg, mode) {
    const el = $("photoState");
    el.textContent = msg;
    el.className = "small " + (mode === "wait" ? "muted wait" : mode === "err" ? "err" : "muted");
  }
  function openPhoto() {
    photoFocus = document.activeElement;
    $("photoTitle").textContent = "Analyse de ta photo";
    $("photoImg").hidden = true; $("photoImg").removeAttribute("src");
    $("photoBody").hidden = true; $("photoAdd").disabled = true; $("photoCancel").textContent = "Annuler";
    $("photoBg").hidden = false; $("photoSheet").hidden = false;
  }
  function closePhoto() {
    photoRun++; photo = null;
    $("photoBg").hidden = true; $("photoSheet").hidden = true;
    photoFocus?.focus?.();
  }
  const scaled = (a) => { const k = a.g0 > 0 ? a.g / a.g0 : 0; return { kcal: a.kcal * k, prot: a.proteines * k, gluc: a.glucides * k, lip: a.lipides * k }; };
  const macroLine = (v) => `${nb(v.kcal)} kcal · P ${r0(v.prot)} g · G ${r0(v.gluc)} g · L ${r0(v.lip)} g`;
  const CONF = {
    faible: "Estimation peu sûre : vérifie bien chaque quantité.",
    moyenne: "Estimation faite à partir de la photo : corrige les grammes si besoin.",
    bonne: "Estimation plutôt fiable, mais jette un œil aux grammes."
  };
  function renderPhoto() {
    $("photoTitle").textContent = photo.nom;
    photoState("Voici ce qu'on voit dans ton assiette. Modifie les grammes : tout se recalcule.");
    $("photoItems").innerHTML = photo.items.length ? photo.items.map((a, i) => `
      <div class="pitem" data-i="${i}">
        <span class="pn">${esc(a.nom)}</span>
        <label class="pg"><input type="number" inputmode="numeric" min="0" max="2000" step="5" value="${r0(a.g)}" aria-label="Quantité de ${esc(a.nom)} en grammes"><span>g</span></label>
        <button class="del" type="button" data-x="${i}" aria-label="Retirer ${esc(a.nom)}">Retirer</button>
        <span class="sub" data-sub="${i}">${macroLine(scaled(a))}</span>
        <span class="psrc">${a.source ? `${esc(a.source.edition || "Ciqual")} : ${esc(a.source.nom)}` : "Valeurs estimées par l'IA (aliment absent de la table Ciqual)"}</span>
      </div>`).join("") : `<p class="small muted">Plus aucun aliment dans la liste.</p>`;
    const nCiq = photo.items.filter(a => a.source).length;
    const srcNote = nCiq ? `Calories et macros calculées avec la table ${photo.edition || "Ciqual"} de l'ANSES pour ${nCiq === photo.items.length ? "tous les aliments" : `${nCiq} aliment${nCiq > 1 ? "s" : ""} sur ${photo.items.length}`}. Les quantités restent estimées d'après la photo.` : "";
    $("photoNote").textContent = [CONF[photo.conf] || CONF.moyenne, srcNote, photo.rem].filter(Boolean).join(" ");
    $("photoBody").hidden = false;
    updatePhotoTotal();
  }
  function updatePhotoTotal() {
    const t = sum(photo.items.map(scaled));
    $("photoTot").innerHTML = `
      <div class="line tot"><span>Total</span><span>${nb(t.kcal)} kcal</span></div>
      <div class="line"><span><i class="dot d-p"></i>Protéines</span><span>${r0(t.prot)} g</span></div>
      <div class="line"><span><i class="dot d-g"></i>Glucides</span><span>${r0(t.gluc)} g</span></div>
      <div class="line"><span><i class="dot d-l"></i>Lipides</span><span>${r0(t.lip)} g</span></div>`;
    $("photoAdd").disabled = !(t.kcal > 0);
  }
  $("photoIn").addEventListener("change", async () => {
    const file = $("photoIn").files?.[0];
    $("photoIn").value = "";
    if (!file) return;
    const run = ++photoRun;
    openPhoto();
    photoState("Préparation de la photo…", "wait");
    let dataUrl;
    try { dataUrl = await resizeImage(file); } catch {
      if (run === photoRun) photoState("Cette photo n'a pas pu être lue. Réessaie avec une photo au format JPEG.", "err");
      return;
    }
    if (run !== photoRun) return;
    $("photoImg").src = dataUrl; $("photoImg").hidden = false;
    photoState("Analyse en cours… quelques secondes", "wait");
    try {
      const plate = LS.get("g-plate", "");
      const res = await apiPost("/api/analyse", { image: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/jpeg", ...(plate ? { assiette: plate } : {}) });
      if (res && !res.error) creditUsed();
      if (run !== photoRun) return;
      if (res.error) {
        if (res.status === 402) { subActive = false; renderPremium(); }
        throw new Error(res.error);
      }
      if (!res.est_un_repas || !Array.isArray(res.aliments)) throw new Error("On ne voit pas de repas sur cette photo. Cadre bien ton assiette et réessaie.");
      photo = { nom: res.nom, conf: res.confiance, rem: res.remarque, edition: res.edition || "", items: res.aliments.map(a => ({ ...a, g0: a.grammes, g: a.grammes })) };
      track("photo_analysee", { aliments: photo.items.length, confiance: photo.conf, ciqual: photo.items.filter(a => a.source).length, assiette: plate || "non" });
      renderPhoto();
    } catch (e) {
      if (run !== photoRun) return;
      photoState(navigator.onLine === false ? "Pas de connexion internet. Réessaie quand tu es connecté." : e.message, "err");
      $("photoCancel").textContent = "Fermer";
    }
  });
  $("photoItems").addEventListener("input", (e) => {
    const row = e.target.closest(".pitem"); if (!row || !photo) return;
    const a = photo.items[Number(row.dataset.i)];
    a.g = Math.min(2000, Math.max(0, Number(e.target.value) || 0));
    row.querySelector("[data-sub]").textContent = macroLine(scaled(a));
    updatePhotoTotal();
  });
  $("photoItems").addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]"); if (!b || !photo) return;
    photo.items.splice(Number(b.dataset.x), 1); renderPhoto();
  });
  $("photoCancel").addEventListener("click", closePhoto);
  $("photoBg").addEventListener("click", closePhoto);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("photoSheet").hidden) closePhoto(); });
  $("photoAdd").addEventListener("click", () => {
    if (!photo) return;
    const t = sum(photo.items.map(scaled));
    if (!(t.kcal > 0)) return;
    addMeal({ name: photo.nom, ...t });
    closePhoto();
  });

  // ---------- Compte (Supabase) : facultatif, actif seulement si le serveur l'a configuré ----------
  // Connexion sans mot de passe (lien par e-mail). Sauvegarde : repas, points, série, badges, eau, séances.
  // Le profil (poids, taille, âge) et les mesures du corps ne quittent jamais l'appareil.
  const SB = CFG.supabase && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(CFG.supabase.url || "") ? CFG.supabase : null;
  // Repas proposés par les utilisateurs et validés : ajoutés à la recherche, dans la catégorie « Communauté ».
  (async () => {
    if (!SB) return;
    try {
      const r = await fetch(`${SB.url}/rest/v1/meal_suggestions?status=eq.approved&select=id,name,portion_g,kcal,prot,gluc,lip,price&order=name&limit=2000`,
        { headers: { apikey: SB.key, authorization: `Bearer ${SB.key}` } });
      if (!r.ok) return;
      const rows = (await r.json()).filter(m => m && typeof m.name === "string" && Number(m.kcal) > 0);
      if (!rows.length) return;
      const has = new Set(FOODS.map(f => norm(f.name)));
      for (const m of rows) {
        if (has.has(norm(m.name))) continue;
        const g = Number(m.portion_g) || 0;
        FOODS.push({ name: m.name.slice(0, 80), cat: "Communauté", portion: g ? `1 portion, ${r0(g)} g` : "1 portion", tags: "communaute",
          src: [["communaute", g, m.name]], kcal: Number(m.kcal), prot: Number(m.prot) || 0, gluc: Number(m.gluc) || 0, lip: Number(m.lip) || 0,
          price: Number(m.price) || 0, community: true });
      }
      if (!$("cats").querySelector('[data-c="Communauté"]'))
        $("cats").insertAdjacentHTML("beforeend", `<button class="chip" type="button" data-c="Communauté" aria-pressed="false">Communauté</button>`);
      renderResults();
    } catch { /* hors ligne : la recherche garde la table Ciqual */ }
  })();
  const SYNC_KEYS = ["g-days", "g-badges", "g-frozen", "g-freezes", "g-xp", "g-xpday", "g-miles", "g-defis",
    "g-freeze-at", "g-water", "g-water-xp", "g-train", "g-train-xp", "g-chest"];
  let sb = null, sbUser = null, pushTimer = null, applyingRemote = false;
  const accMsg = (t) => { $("accMsg").textContent = t; };
  const syncLabel = (t) => { $("accSync").textContent = t; };
  function loadSupabase() {
    return new Promise((ok, ko) => {
      if (window.supabase?.createClient) return ok();
      const s = document.createElement("script");
      s.src = "/vendor/supabase-2.118.0.js"; s.nonce = NONCE; s.onload = ok; s.onerror = ko;
      document.head.appendChild(s);
    });
  }
  const snapshot = () => { const o = {}; SYNC_KEYS.forEach(k => { const v = LS.get(k, undefined); if (v !== undefined) o[k] = v; }); return o; };
  // Fusion prudente entre ce téléphone et la sauvegarde : on ne perd jamais un repas ni un badge.
  function mergeVal(a, b) {
    if (a === undefined) return b;
    if (b === undefined) return a;
    if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
    if (typeof a === "string" && typeof b === "string") return a > b ? a : b;
    if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    if (a && b && typeof a === "object" && typeof b === "object") {
      const out = {};
      for (const d of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const x = a[d], y = b[d];
        if (x === undefined) out[d] = y;
        else if (y === undefined) out[d] = x;
        else if (Array.isArray(x) && Array.isArray(y)) out[d] = x.length >= y.length ? x : y;
        else if (typeof x === "number" && typeof y === "number") out[d] = Math.max(x, y);
        else if (typeof x === "string" && typeof y === "string") out[d] = x < y ? x : y;
        else out[d] = x;
      }
      return out;
    }
    return a;
  }
  function reloadState() {
    days = LS.get("g-days", {}); badges = LS.get("g-badges", {}); frozen = LS.get("g-frozen", []);
    freezes = LS.get("g-freezes", 0); xp = LS.get("g-xp", 0); xpDay = LS.get("g-xpday", {});
    miles = LS.get("g-miles", []); water = LS.get("g-water", {}); trains = LS.get("g-train", {});
  }
  async function pushNow() {
    clearTimeout(pushTimer);
    if (!sb || !sbUser) return;
    const { error } = await sb.from("user_data").upsert({ user_id: sbUser.id, data: snapshot(), updated_at: new Date().toISOString() });
    syncLabel(error ? "Échec de sauvegarde" : "Sauvegardé");
  }
  async function syncAll() {
    syncLabel("SYNCHRO…");
    try {
      const { data, error } = await sb.from("user_data").select("data").eq("user_id", sbUser.id).maybeSingle();
      if (error) throw error;
      const remote = data?.data || {}, local = snapshot();
      applyingRemote = true;
      for (const k of SYNC_KEYS) { const v = mergeVal(local[k], remote[k]); if (v !== undefined) LS.set(k, v); }
      applyingRemote = false;
      reloadState(); renderAll();
      await pushNow();
    } catch { applyingRemote = false; syncLabel("Échec de synchro"); }
  }
  function renderAccount() {
    $("accOut").hidden = Boolean(sbUser); $("accIn").hidden = !sbUser;
    $("accDelConfirm").hidden = true;
    if (sbUser) $("accWho").textContent = sbUser.email || "ton e-mail"; else syncLabel("");
    renderPremium();
  }
  // ---------- Abonnement Bon'Assiette+ : lecture de l'état et affichage ----------
  function renderPremium() {
    $("accSub").hidden = !(sbUser && subActive);
    $("accGoPlus").hidden = !(sbUser && PREMIUM && !subActive);
    const pack = PREMIUM?.pack;
    $("accCredits").hidden = !(sbUser && !subActive);
    $("accCreditsTxt").textContent = credits > 0
      ? `Il te reste ${credits} analyse${credits > 1 ? "s" : ""} (photo ou idée frigo), sans date limite.`
      : "Plus d'analyse disponible. Le coffre du jour peut t'en offrir, ou prends un pack (achat unique, sans abonnement).";
    $("accBuyPack").hidden = !pack;
    if (pack) $("accBuyPack").textContent = `${credits > 0 ? "Reprendre" : "Prendre"} ${pack.credits} utilisations · ${pack.price}`;
    renderPhotoHero();
    document.querySelectorAll(".plus-tag").forEach(t => { t.hidden = subActive; });
    if (subActive) document.querySelectorAll("[id^='ad-']").forEach(b => { b.hidden = true; });
  }
  async function refreshSub() {
    if (!sb || !sbUser) { subActive = false; credits = 0; renderPremium(); return false; }
    if (PREMIUM) {
      const { data } = await sb.from("subscriptions").select("status,current_period_end").eq("user_id", sbUser.id).maybeSingle();
      const end = data?.current_period_end ? Date.parse(data.current_period_end) + 3 * 86400000 : Infinity;
      subActive = Boolean(data) && (data.status === "active" || data.status === "past_due") && end > Date.now();
    } else subActive = false;
    const c = await sb.from("credits").select("balance").eq("user_id", sbUser.id).maybeSingle();
    credits = Math.max(0, Math.round(Number(c.data?.balance)) || 0);
    try { localStorage.setItem("g-credits", String(credits)); } catch { /* stockage indisponible */ }
    renderPremium();
    return subActive;
  }
  // Retour de la page de paiement : l'abonnement peut mettre quelques secondes à être confirmé par Stripe.
  const backFromPay = new URLSearchParams(location.search).get("abonnement");
  const backFromPack = new URLSearchParams(location.search).get("achat");
  if (backFromPay || backFromPack) history.replaceState(null, "", "/");
  async function afterPayment() {
    if (backFromPack) {
      if (backFromPack !== "ok") { if (backFromPack === "annule") toast("Achat annulé. Rien n'a été débité."); return; }
      let before = 0; try { before = Number(localStorage.getItem("g-credits")) || 0; } catch { /* stockage indisponible */ }
      for (let i = 0; i < 8; i++) {
        await refreshSub();
        if (credits > before) { toast(`Merci ! ${credits - before} utilisations ajoutées`); track("pack_achete"); show("jour"); return; }
        await new Promise(r => setTimeout(r, 2000));
      }
      toast("Paiement reçu. L'activation prend parfois une minute : appuie sur Synchroniser dans Profil.");
      return;
    }
    if (backFromPay !== "ok") { if (backFromPay === "annule") toast("Paiement annulé. Rien n'a été débité."); return; }
    for (let i = 0; i < 6; i++) {
      if (await refreshSub()) { toast("Merci ! Bon'Assiette+ est activé"); track("abonnement_actif"); show("jour"); return; }
      await new Promise(r => setTimeout(r, 2000));
    }
    toast("Paiement reçu. L'activation prend parfois une minute : appuie sur Synchroniser dans Profil.");
  }
  $("accPortal").addEventListener("click", async () => {
    $("accPortal").disabled = true;
    const r = await apiPost("/api/portal");
    $("accPortal").disabled = false;
    if (r?.url) location.assign(r.url); else toast(r?.error || "La page de gestion n'a pas pu s'ouvrir.");
  });
  async function initAccount() {
    if (!SB) return;
    $("accountPanel").hidden = false;
    try { await loadSupabase(); } catch { $("accountPanel").hidden = true; return; }
    sb = window.supabase.createClient(SB.url, SB.key, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "g-auth" }
    });
    onLSSet = (k) => {
      if (!sbUser || applyingRemote || !SYNC_KEYS.includes(k)) return;
      clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 2500);
    };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && pushTimer) pushNow(); });
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(async () => {
        const before = sbUser?.id;
        sbUser = session?.user || null;
        renderAccount();
        if (/[?&]code=/.test(location.search)) history.replaceState(null, "", "/");
        if (sbUser && sbUser.id !== before) {
          if (event === "SIGNED_IN") { track("connexion_compte"); toast("Connecté · tes données sont sauvegardées"); }
          await syncAll();
          if (backFromPay || backFromPack) await afterPayment(); else await refreshSub();
          await claimWelcome();
          renderDay();
        } else if (!sbUser && before) { subActive = false; renderPremium(); }
      }, 0);
    });
  }
  $("accSyncNow").addEventListener("click", () => { if (sbUser) refreshSub(); });
  $("accSend").addEventListener("click", async () => {
    const email = $("accEmail").value.trim();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) { accMsg("Cette adresse e-mail ne semble pas valide."); return; }
    if (!sb) return;
    $("accSend").disabled = true; accMsg("Envoi…");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/", shouldCreateUser: true } });
    $("accSend").disabled = false;
    accMsg(error
      ? (error.status === 429 ? "Trop de demandes. Réessaie dans quelques minutes." : "L'envoi a échoué. Vérifie l'adresse et réessaie.")
      : "C'est envoyé ! Tape le code reçu par e-mail (pense à regarder dans les spams).");
    if (!error) { track("demande_lien_connexion"); $("accCodeBox").hidden = false; $("accCode").value = ""; $("accCode").focus(); }
  });
  // Connexion par code à 6 chiffres : marche même si l'e-mail est ouvert sur un autre appareil ou navigateur.
  async function verifyCode() {
    const email = $("accEmail").value.trim(), token = $("accCode").value.replace(/\D/g, "");
    if (token.length < 6) { accMsg("Tape les chiffres du code reçu par e-mail."); return; }
    if (!sb) return;
    $("accVerify").disabled = true; accMsg("Vérification…");
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    $("accVerify").disabled = false;
    if (error) { accMsg(error.status === 429 ? "Trop d'essais. Réessaie dans quelques minutes." : "Code incorrect ou expiré. Vérifie-le, ou redemande un code."); return; }
    accMsg(""); $("accCodeBox").hidden = true;
    if (wantPlus) { wantPlus = false; setTimeout(() => { if (!subActive) openPrem("connexion"); }, 1500); }
  }
  $("accVerify").addEventListener("click", verifyCode);
  $("accCode").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyCode(); });
  $("accCode").addEventListener("input", () => { if ($("accCode").value.replace(/\D/g, "").length === 6) verifyCode(); });
  $("accGoPlus").addEventListener("click", () => $("photoBtn").click());
  $("accSyncNow").addEventListener("click", () => { if (sbUser) syncAll(); });
  $("accLogout").addEventListener("click", async () => { await sb?.auth.signOut({ scope: "local" }); sbUser = null; renderAccount(); toast("Déconnecté. Tes données restent sur ce téléphone."); });
  $("accDelete").addEventListener("click", () => { $("accDelConfirm").hidden = false; });
  $("accDelNo").addEventListener("click", () => { $("accDelConfirm").hidden = true; });
  $("accDelYes").addEventListener("click", async () => {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) { toast("Reconnecte-toi d'abord."); return; }
    $("accDelYes").disabled = true;
    const r = await fetch("/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    $("accDelYes").disabled = false;
    if (r?.ok) {
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      sbUser = null; renderAccount(); track("compte_supprime"); toast("Compte supprimé.");
    } else {
      const j = await r?.json().catch(() => ({}));
      toast(j?.error || "La suppression a échoué. Réessaie plus tard.");
    }
  });

  // ---------- Bon'Assiette+ : un repas avec ce qu'il y a dans le frigo ----------
  // Objectif du repas : une part de ce qu'il reste aujourd'hui (jamais toute une journée d'un coup), ou un repas / en-cas type.
  function frigoTarget() {
    const t = targets(P()), s = sum(meals()), mode = $("frigoFor").value;
    const rest = { kcal: t.kcal - s.kcal, prot: t.prot - s.prot, gluc: t.gluc - s.gluc, lip: t.lip - s.lip };
    let share = mode === "encas" ? 0.12 : mode === "repas" ? 0.33 : null, base = t;
    if (share === null) {
      if (rest.kcal < 250) { share = 0.12; }
      else { base = rest; share = Math.min(1, (t.kcal * 0.35) / rest.kcal); }
    }
    const c = (v) => Math.max(0, r0(v * share));
    return { kcal: Math.max(150, c(base.kcal)), prot: c(base.prot), gluc: c(base.gluc), lip: c(base.lip) };
  }
  function renderFrigoTarget() {
    const c = frigoTarget();
    $("frigoTarget").textContent = `Objectif : environ ${nb(c.kcal)} kcal et ${c.prot} g de protéines`;
  }
  $("frigoFor").addEventListener("change", renderFrigoTarget);
  let frigoLast = null;
  async function frigoAsk() {
    if (!hasAccess()) { openPrem("frigo"); return; }
    const ingredients = $("frigoIn").value.trim();
    if (ingredients.length < 3) { $("frigoMsg").textContent = "Écris au moins un ingrédient."; $("frigoIn").focus(); return; }
    const cible = frigoTarget();
    $("frigoGo").disabled = true; $("frigoAgain").disabled = true;
    $("frigoMsg").textContent = "Le chef réfléchit… (10 secondes environ)";
    const r = await apiPost("/api/frigo", { ingredients, cible, cuisine: [...kitchen], temps: Number($("time").value) || 30 });
    $("frigoGo").disabled = false; $("frigoAgain").disabled = false;
    if (!r || r.error) { $("frigoMsg").textContent = r?.error || "Ça n'a pas marché. Réessaie."; return; }
    creditUsed();
    frigoLast = r; track("frigo_idee");
    $("frigoMsg").textContent = "";
    $("frigoOut").innerHTML = `
      <div class="head">${esc(r.nom)}</div>
      <div class="line"><span>${r0(r.temps_min)} min</span><span>${nb(r.kcal)} kcal <span class="vs">/ ${nb(cible.kcal)}</span></span></div>
      <div class="line"><span>P ${r0(r.prot)} g <span class="vs">/ ${cible.prot}</span></span><span>G ${r0(r.gluc)} g · L ${r0(r.lip)} g</span></div>
      <div class="rule"></div>
      <ul>${r.ingredients.map(i => `<li>${esc(i.nom)} — ${nb(i.grammes)} g${i.du_frigo ? "" : ` <span class="vs">(placard)</span>`}${i.source === null ? ` <span class="vs est">(valeurs estimées)</span>` : ""}</li>`).join("")}</ul>
      <div class="rule"></div>
      <ol>${r.etapes.map(e => `<li>${esc(e)}</li>`).join("")}</ol>
      ${r.conseil ? `<p class="small muted">${esc(r.conseil)}</p>` : ""}
      <p class="small muted">${r.edition ? `Calories et macros calculées ingrédient par ingrédient avec la table ${esc(r.edition)} de l'ANSES, quantités ajustées à ton objectif.` : "Valeurs estimées par l'IA : vérifie les quantités si tu suis tes macros au gramme près."}</p>`;
    $("frigoOut").hidden = false; $("frigoActs").hidden = false;
  }
  $("frigoGo").addEventListener("click", frigoAsk);
  $("frigoAgain").addEventListener("click", frigoAsk);
  $("frigoAdd").addEventListener("click", () => {
    const r = frigoLast; if (!r) return;
    addMeal({ name: r.nom, kcal: r.kcal, prot: r.prot, gluc: r.gluc, lip: r.lip });
    $("frigoActs").hidden = true;
  });

  // ---------- Coffre du jour ----------
  // Comptes connectés, gratuit, un par jour, après une journée remplie (3 repas). Le serveur vérifie la journée
  // et tire la récompense : 10 % une analyse photo, sinon des points.
  const CHEST_MEALS = CFG.engage?.chestMeals || 3;
  function renderChest() {
    const on = Boolean(CFG.engage && SB);
    $("chest").hidden = !on;
    if (!on) return;
    const n = meals().length, opened = LS.get("g-chest", "") === TODAY, ready = Boolean(sbUser) && n >= CHEST_MEALS && !opened;
    $("chestTxt").textContent = !sbUser ? "Connecte-toi pour l'ouvrir chaque jour"
      : opened ? "Ouvert. À demain !"
      : ready ? "Prêt, ouvre-le !"
      : `Encore ${CHEST_MEALS - n} repas`;
    $("chestBar").style.width = (opened ? 100 : Math.min(n, CHEST_MEALS) / CHEST_MEALS * 100) + "%";
    $("chestOpen").hidden = !(ready || !sbUser);
    $("chestOpen").textContent = sbUser ? "Ouvrir" : "Me connecter";
    $("chest").classList.toggle("ready", ready);
    $("chest").classList.toggle("done", opened);
    $("chestIco").innerHTML = IC(opened ? "check" : "gift");
  }
  $("chestOpen").addEventListener("click", async () => {
    if (!sbUser) { show("profil"); $("accEmail")?.focus(); return; }
    if (LS.get("g-chest", "") === TODAY || meals().length < CHEST_MEALS) return;
    $("chestOpen").disabled = true; $("chestIco").classList.add("shake");
    await pushNow(); // le serveur vérifie les repas du jour dans la sauvegarde du compte
    const [r] = await Promise.all([apiPost("/api/coffre"), new Promise(ok => setTimeout(ok, 1100))]);
    $("chestIco").classList.remove("shake"); $("chestOpen").disabled = false;
    if (!r || r.error) { toast(r?.error || "Le coffre est coincé. Réessaie dans un moment."); return; }
    LS.set("g-chest", TODAY);
    if (r.already) { toast("Tu as déjà ouvert ton coffre aujourd'hui."); renderDay(); return; }
    let title, text, icon;
    if (r.photo) {
      await refreshSub();
      title = "Une analyse photo !"; icon = "camera";
      text = "Prends ton prochain repas en photo : chaque aliment est reconnu et pesé, avec ses calories et ses macros.";
    } else {
      bonusXP(Math.max(0, Math.min(60, Math.round(Number(r.xp) || 0))));
      title = `+${r.xp} XP`; icon = "sparkles"; text = "Bonus du coffre. Demain, peut-être une analyse photo !";
    }
    track("coffre_ouvert", { gain: r.photo ? "photo" : "xp" });
    renderDay();
    celebrate(title, text, icon);
  });

  // Bouton Photo de l'accueil : analyses restantes, et Bon'Assiette+ quand il n'y en a plus.
  function renderPhotoHero() {
    const left = $("photoLeft"), plus = $("photoPlus");
    const welcome = CFG.engage?.welcome || 0;
    plus.hidden = true;
    if (subActive) { left.textContent = "Bon'Assiette+ : jusqu'à 6 analyses par jour"; return; }
    if (!sbUser) {
      left.textContent = SB && welcome ? `${welcome} analyses offertes en créant ton compte gratuit` : "";
      return;
    }
    if (credits > 0) { left.textContent = `${credits} analyse${credits > 1 ? "s" : ""} restante${credits > 1 ? "s" : ""}`; return; }
    left.textContent = "Plus d'analyse disponible";
    plus.hidden = !PREMIUM;
  }
  $("photoPlus").addEventListener("click", () => openPrem("plus_vide"));
  const renderPlate = () => {
    const p = LS.get("g-plate", "");
    $("plate").querySelectorAll("[data-p]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.p === p)));
    if (p) $("plateBox").open = true;
  };
  $("plate").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    LS.set("g-plate", LS.get("g-plate", "") === b.dataset.p ? "" : b.dataset.p);
    renderPlate();
  });
  renderPlate();
  // Analyses offertes à la création du compte (une seule fois par compte, décidé par le serveur).
  async function claimWelcome() {
    if (!sbUser || !CFG.engage?.welcome || LS.get("g-welcome", "") === sbUser.id) return;
    const r = await apiPost("/api/bienvenue").catch(() => null);
    if (!r || r.error) return;
    LS.set("g-welcome", sbUser.id);
    if (r.granted > 0) {
      await refreshSub();
      track("analyses_offertes", { n: r.granted });
      celebrate(`${r.granted} analyses photo offertes`, "Prends ton repas en photo depuis l'accueil.", "camera");
    }
  }

  // ---------- Points de la semaine (pour la ligue) ----------
  function weekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
    const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow + 3);
    const y = t.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
    const w = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  }
  const weekXP = () => { const w = LS.get("g-xpweek", null); return w && w.w === weekKey() ? w.xp : 0; };
  function bumpWeek(n) {
    if (!(n > 0)) return;
    LS.set("g-xpweek", { w: weekKey(), xp: weekXP() + n });
    clearTimeout(scoreTimer); scoreTimer = setTimeout(sendScore, 4000);
  }
  function bonusXP(n) {
    const before = levelOf(xp).n;
    xp += n; LS.set("g-xp", xp); bumpWeek(n);
    const after = levelOf(xp);
    if (after.n > before) setTimeout(() => celebrate(`Nouveau grade : ${after.name}`, `Tu passes au grade ${after.n}. Ta rigueur paie, continue comme ça.`), 2500);
  }
  let scoreTimer = null;
  async function sendScore() {
    if (!sb || !sbUser || !CFG.engage?.ligue || !LS.get("g-ligue", false)) return;
    await apiPost("/api/ligue/score", { xp: weekXP() }).catch(() => null);
  }

  // ---------- Ligue de la semaine ----------
  const TIER_ICON = [1, 2, 3, 4, 5].map(n => IC("medal", "tier-" + n));
  async function apiGet(url) {
    const { data } = await sb.auth.getSession().catch(() => ({ data: null }));
    const token = data?.session?.access_token;
    if (!token) return { error: "Reconnecte-toi d'abord." };
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!r) return { error: "Le serveur ne répond pas. Réessaie." };
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || "Ça n'a pas marché. Réessaie." };
  }
  async function renderLeague() {
    const on = Boolean(CFG.engage?.ligue && SB);
    $("league").hidden = !on;
    if (!on) return;
    if (!sbUser) {
      $("lgDays").textContent = "";
      $("lgBody").innerHTML = `<p class="small muted">Affronte 30 joueurs de ton niveau chaque semaine : les plus réguliers montent de ligue, de Bronze à Diamant. Ce qui compte, c'est de noter tes repas, ton eau et tes séances, jamais ton poids.</p>
        <button class="primary" type="button" data-lg="login">Me connecter pour jouer</button>`;
      return;
    }
    if (LS.get("g-ligue", false)) await sendScore();
    const b = await apiGet("/api/ligue");
    if (b.error) { $("lgBody").innerHTML = `<p class="small muted">${esc(b.error)}</p>`; return; }
    LS.set("g-ligue", Boolean(b.joined));
    if (!b.joined) {
      $("lgDays").textContent = "";
      $("lgBody").innerHTML = `<p class="small muted">Chaque semaine, tu affrontes 30 joueurs de ton niveau. Les 5 premiers montent de ligue, les 5 derniers descendent. Les points viennent de ta régularité (repas, eau, séances, défis), jamais de ton poids.</p>
        <label class="f" for="lgPseudo">Ton pseudo (visible par ton groupe)<input type="text" id="lgPseudo" maxlength="20" autocomplete="nickname" placeholder="Ex. : Chef_Ramen"></label>
        <button class="primary" type="button" data-lg="join">Rejoindre la ligue</button>
        <p class="small muted" id="lgMsg" aria-live="polite"></p>`;
      return;
    }
    const n = b.members.length, me = b.members.find(m => m.me);
    $("lgDays").textContent = b.daysLeft > 1 ? `Encore ${b.daysLeft} jours` : "Dernier jour";
    const next = b.tiers[b.tier], prev = b.tiers[b.tier - 2];
    const zoneUp = (m) => m.rank <= b.move && m.xp > 0 && b.tier < b.tiers.length;
    const zoneDown = (m) => n >= 10 && m.rank > n - b.move && b.tier > 1;
    const hint = me && zoneUp(me) ? `Tu es en zone de montée : garde ta place jusqu'à dimanche pour passer en ligue ${next}.`
      : me && zoneDown(me) ? `Attention, zone de descente : quelques repas notés suffisent pour remonter.`
      : next ? `Les ${b.move} premiers passent en ligue ${next} dimanche soir.` : "Tu es dans la meilleure ligue. Reste dans le haut du classement !";
    $("lgBody").innerHTML = `
      <div class="lg-head"><span class="lg-tier">${TIER_ICON[b.tier - 1]} Ligue ${esc(b.tierName)}</span><span class="small muted">${me ? `${me.rank}<sup>e</sup> sur ${n}` : ""}</span></div>
      <p class="small">${esc(hint)}</p>
      <ol class="lg-list">${b.members.map(m => `<li class="${m.me ? "me" : ""} ${zoneUp(m) ? "up" : zoneDown(m) ? "down" : ""}">
        <span class="lg-r">${m.rank}</span><span class="lg-p">${esc(m.pseudo)}${m.me ? " (toi)" : ""}</span><span class="lg-x">${nb(m.xp)} XP</span></li>`).join("")}</ol>
      ${n < 5 ? `<p class="small muted">Ton groupe se remplit au fil de la semaine. Invite des amis à jouer !</p>` : ""}
      <p class="small muted">Pseudo : ${esc(b.pseudo)}${prev ? ` · Les ${b.move} derniers redescendent en ${esc(prev)}.` : ""} <button class="linkbtn" type="button" data-lg="quit">Quitter la ligue</button></p>`;
  }
  $("lgBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lg]"); if (!b) return;
    if (b.dataset.lg === "login") { show("profil"); $("accEmail")?.focus(); return; }
    if (b.dataset.lg === "join") {
      const pseudo = $("lgPseudo").value.trim();
      b.disabled = true;
      const r = await apiPost("/api/ligue/rejoindre", { pseudo });
      b.disabled = false;
      if (r?.error) { $("lgMsg").textContent = r.error; return; }
      LS.set("g-ligue", true); track("ligue_rejointe"); toast("Bienvenue dans la ligue !");
      renderLeague();
      return;
    }
    if (b.dataset.lg === "quit") {
      b.disabled = true;
      const r = await apiPost("/api/ligue/quitter");
      if (r?.error) { toast(r.error); b.disabled = false; return; }
      LS.set("g-ligue", false); toast("Tu as quitté la ligue.");
      renderLeague();
    }
  });

  // ---------- Rappel de série (notification du soir) ----------
  // Sans compte : l'appareil s'abonne aux notifications, et l'appli dit au serveur quel est le dernier jour avec un repas.
  const PUSH = Boolean(CFG.engage?.push && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  let pushReg = null, pushSub = null;
  const lastMealDay = () => Object.keys(days).filter(logged).sort().pop() || null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64ToBytes = (s) => { const p = "=".repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  const postJSON = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(r => r.json().then(j => (r.ok ? j : { error: j.error || "Ça n'a pas marché." })).catch(() => ({ error: "Ça n'a pas marché." }))).catch(() => ({ error: "Pas de connexion." }));
  async function pushInit() {
    if (PUSH) {
      pushReg = await navigator.serviceWorker.getRegistration().catch(() => null);
      pushSub = pushReg ? await pushReg.pushManager.getSubscription().catch(() => null) : null;
      if (pushSub) pushSync();
    }
    renderRemind();
  }
  function pushSync() {
    const last = lastMealDay();
    if (!pushSub || !last) return;
    postJSON("/api/push/etat", { endpoint: pushSub.endpoint, lastMealDay: last, streak: streak() });
  }
  async function remindOn() {
    if (!PUSH || !pushReg) { toast("Les rappels ne sont pas disponibles sur ce navigateur."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications refusées. Tu peux les autoriser dans les réglages du navigateur."); renderRemind(); return; }
    const k = await fetch("/api/push/cle").then(r => r.json()).catch(() => ({}));
    if (!k.key) { toast("Les rappels sont momentanément indisponibles."); return; }
    try { pushSub = await pushReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) }); }
    catch { toast("L'activation a échoué. Réessaie."); return; }
    const r = await postJSON("/api/push/abonner", { subscription: pushSub.toJSON(), lastMealDay: lastMealDay(), streak: streak() });
    if (r.error) { toast(r.error); return; }
    track("rappel_active"); toast("Rappel activé : on te prévient le soir si ta série est en danger.");
    renderRemind();
  }
  async function remindOff() {
    if (!pushSub) return;
    await postJSON("/api/push/desabonner", { endpoint: pushSub.endpoint });
    await pushSub.unsubscribe().catch(() => {});
    pushSub = null; toast("Rappel désactivé."); renderRemind();
  }
  function renderRemind() {
    const can = PUSH && Boolean(pushReg);
    const later = LS.get("g-remind-later", "");
    const recent = later && (Date.parse(TODAY) - Date.parse(later)) < 3 * 86400000;
    $("remind").hidden = !(can && !pushSub && Notification.permission === "default" && streak() >= 1 && !recent);
    $("remindPanel").hidden = !(can || (isIOS && !standalone && CFG.engage?.push));
    if (can) {
      const denied = Notification.permission === "denied";
      $("remindState").textContent = pushSub ? "Activé : une notification à 20 h, seulement les jours où ta série est en danger."
        : denied ? "Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur."
        : "Une notification à 20 h, seulement les jours où tu n'as encore rien noté et où ta série est en jeu.";
      $("remindToggle").hidden = denied;
      $("remindToggle").textContent = pushSub ? "Désactiver le rappel" : "Activer le rappel du soir";
    } else {
      $("remindState").textContent = "Sur iPhone, installe d'abord l'appli sur ton écran d'accueil (Partager, puis « Sur l'écran d'accueil ») pour recevoir le rappel du soir.";
      $("remindToggle").hidden = true;
    }
  }
  $("remindOn").addEventListener("click", remindOn);
  $("remindLater").addEventListener("click", () => { LS.set("g-remind-later", TODAY); renderRemind(); });
  $("remindToggle").addEventListener("click", () => (pushSub ? remindOff() : remindOn()));

  // ---------- Vue Pas cher ----------
  function renderRecipes() {
    renderFrigoTarget();
    const t = targets(P()), s = sum(meals());
    const kc = r0(t.kcal - s.kcal), pr = r0(t.prot - s.prot);
    $("needLine").textContent = kc > 0
      ? `Il te reste ${nb(kc)} kcal et ${Math.max(0, pr)} g de protéines. Les plus riches en protéines par euro d'abord.`
      : "Objectif atteint. Des idées pour demain.";
    const budget = Number($("budget").value), time = Number($("time").value);
    const list = RECIPES.filter(r => r.cost <= budget && r.min <= time && r.need.every(n => kitchen.has(n)))
      .sort((a, b) => (b.prot / b.cost) - (a.prot / a.cost));
    const cards = list.map(r => `
      <article class="ticket">
        <div class="row start"><div class="head">${esc(r.name)}</div><span class="price">${euro(r.cost)}</span></div>
        <div class="line"><span>${r.min} min · ${nb(r.kcal)} kcal</span><span>P ${r.prot} · G ${r.gluc} · L ${r.lip}</span></div>
        <div class="rule"></div>
        ${r.ing.map(i => `<div class="line"><span>${esc(i.n)} <span class="muted">· ${esc(i.q)}</span></span><span>${euro(i.c)}</span></div>`).join("")}
        <div class="rule"></div>
        <ol class="steps">${r.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
        <p class="tip">${esc(r.tip)}</p>
        <details class="src"><summary>Source des valeurs</summary><ul>${r.ing.map(i => `<li>${esc(i.ciq)} — ${i.g} g <span class="mono">(Ciqual ${esc(i.code)})</span></li>`).join("")}</ul></details>
        <button class="primary" type="button" data-cook="${RECIPES.indexOf(r)}">Je l'ai mangé</button>
      </article>`);
    if (cards.length > 2) cards.splice(2, 0, `<div class="ad" id="ad-recettes"></div>`);
    $("recipes").innerHTML = cards.length ? cards.join("") : `<div class="note">Aucune recette ne correspond. Augmente le budget ou le temps, ou coche un autre équipement.</div>`;
    loadAd("recettes");
  }
  $("recipes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cook]"); if (!b) return;
    const r = RECIPES[Number(b.dataset.cook)];
    addMeal({ name: r.name, kcal: r.kcal, prot: r.prot, gluc: r.gluc, lip: r.lip, recipe: true });
  });
  ["budget", "time"].forEach(id => $(id).addEventListener("change", renderRecipes));
  document.querySelectorAll("#kitchen button").forEach(b => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    on ? kitchen.add(b.dataset.k) : kitchen.delete(b.dataset.k);
    renderRecipes();
  }));

  // ---------- Vue Progrès ----------
  function renderProgress() {
    const t = targets(P()), cols = [];
    let total = 0, n = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const s = sum(days[keyOf(d)] || []);
      if (s.kcal) { total += s.kcal; n++; }
      const h = Math.max(4, Math.min(100, s.kcal / t.kcal * 100));
      cols.push(`<div class="wd" title="${esc(d.toLocaleDateString("fr-FR"))} : ${nb(s.kcal)} kcal, ${r0(s.prot)} g de protéines">
        <div class="col ${s.prot >= t.prot ? "ok" : ""} ${i === 0 ? "today" : ""}" data-h="${s.kcal ? h : 4}"></div>
        <span>${esc(d.toLocaleDateString("fr-FR", { weekday: "short" }).slice(0, 2))}</span></div>`);
    }
    $("week").innerHTML = cols.join("");
    $("week").querySelectorAll("[data-h]").forEach(el => { el.style.height = Number(el.dataset.h) + "%"; });
    $("weekAvg").textContent = n ? `Moyenne ${nb(total / n)} kcal` : "";
    let daysOk = 0, mealsN = 0, protOk = 0; // sur les 7 derniers jours
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const l = days[keyOf(d)] || [];
      if (l.length) daysOk++; mealsN += l.length; if (l.length && sum(l).prot >= t.prot) protOk++;
    }
    const lv = levelOf(xp);
    $("recap").innerHTML = `
      <div class="stat"><b>${daysOk}/7</b><span>jours notés</span></div>
      <div class="stat"><b>${mealsN}</b><span>repas</span></div>
      <div class="stat"><b>${protOk}</b><span>jours protéines OK</span></div>
      <div class="stat"><b>${streak()}</b><span>jours de série</span></div>
      <div class="stat"><b>${trainsWeek()}</b><span>séance${trainsWeek() > 1 ? "s" : ""}</span></div>
      <div class="stat"><b>${waterWeek()}/7</b><span>jours eau OK</span></div>
      <p class="small muted full">Grade ${lv.n} · ${esc(lv.name)} · ${nb(xp)} XP au total.${lv.to ? ` Encore ${nb(lv.to - xp)} XP pour le grade suivant.` : ""}</p>`;
    const got = BADGES.filter(b => badges[b.id]).length;
    $("badgeCount").textContent = `${got} / ${BADGES.length}`;
    $("badges").innerHTML = BADGES.map(b => `<div class="badge ${badges[b.id] ? "on" : ""}"><span class="bt">${esc(b.t)}</span><span class="bd">${esc(b.d)}</span></div>`).join("");
  }

  // ---------- Carte de partage ----------
  // Une image générée sur l'appareil (jamais envoyée au serveur) : série, grade, points et bilan de la semaine.
  // Volontairement sans calories ni poids : ce n'est pas le genre de chose à mettre sur les réseaux.
  let shareFile = null;
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  async function drawShareCard() {
    const W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    try {
      await Promise.all(['800 150px "Bricolage Grotesque"', '700 36px "Bricolage Grotesque"', '500 30px "Figtree"', '600 44px "Figtree"', '600 30px "Figtree"']
        .map(f => document.fonts.load(f)));
    } catch { /* polices système en secours */ }
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#2f6b3c"); g.addColorStop(1, "#1c4526");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    roundRect(ctx, 60, 60, W - 120, H - 120, 48); ctx.fillStyle = "#f3f5f0"; ctx.fill();
    const st = streak(), lv = levelOf(xp), t = targets(P());
    let daysOk = 0, mealsN = 0, protOk = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const l = days[keyOf(d)] || [];
      if (l.length) daysOk++; mealsN += l.length; if (l.length && sum(l).prot >= t.prot) protOk++;
    }
    const got = BADGES.filter(b => badges[b.id]).length, tw = trainsWeek();
    ctx.textBaseline = "top";
    ctx.fillStyle = "#2f6b3c"; ctx.font = '800 56px "Bricolage Grotesque"'; ctx.fillText("Bon'Assiette", 120, 130);
    ctx.fillStyle = "#56635a"; ctx.font = '600 30px "Figtree"';
    ctx.fillText(new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), 120, 204);
    ctx.fillStyle = "#18201b"; ctx.font = '800 150px "Bricolage Grotesque"'; ctx.fillText(String(st), 120, 280);
    ctx.fillStyle = "#56635a"; ctx.font = '600 44px "Figtree"'; ctx.fillText(st === 1 ? "jour de série" : "jours de série", 120, 455);
    roundRect(ctx, 120, 560, W - 240, 160, 28); ctx.fillStyle = "#e2eee3"; ctx.fill();
    ctx.fillStyle = "#2f6b3c"; ctx.font = '600 30px "Figtree"'; ctx.fillText(`Grade ${lv.n} · ${nb(xp)} XP`, 160, 592);
    ctx.fillStyle = "#18201b"; ctx.font = '800 60px "Bricolage Grotesque"'; ctx.fillText(lv.name, 160, 634);
    const stats = [[`${daysOk}/7`, "jours notés"], [String(mealsN), mealsN > 1 ? "repas cette semaine" : "repas cette semaine"],
      [String(protOk), "jours protéines OK"], [String(tw), tw > 1 ? "séances de sport" : "séance de sport"],
      [`${waterWeek()}/7`, "jours eau OK"], [`${got}/${BADGES.length}`, "badges"]];
    stats.forEach(([v, l], i) => {
      const x = 120 + (i % 2) * 430, y = 770 + Math.floor(i / 2) * 140;
      ctx.fillStyle = "#18201b"; ctx.font = '800 64px "Bricolage Grotesque"'; ctx.fillText(v, x, y);
      ctx.fillStyle = "#56635a"; ctx.font = '500 30px "Figtree"'; ctx.fillText(l, x, y + 78);
    });
    ctx.fillStyle = "#2f6b3c"; ctx.font = '700 36px "Bricolage Grotesque"'; ctx.fillText("bonassiette.fr", 120, 1190);
    ctx.fillStyle = "#56635a"; ctx.font = '500 30px "Figtree"'; ctx.fillText("Compteur de calories gratuit et français", 120, 1238);
    return c;
  }
  const closeShare = () => { $("shareBg").hidden = true; $("shareSheet").hidden = true; shareFile = null; };
  $("shareBtn").addEventListener("click", async () => {
    track("partage_ouvert");
    $("shareImg").removeAttribute("src"); $("shareDl").hidden = true; $("shareGo").disabled = true; shareFile = null;
    $("shareState").textContent = "Préparation de l'image…";
    $("shareBg").hidden = false; $("shareSheet").hidden = false;
    try {
      const c = await drawShareCard();
      const url = c.toDataURL("image/png");
      $("shareImg").src = url; $("shareDl").href = url; $("shareDl").hidden = false;
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      shareFile = blob ? new File([blob], "bonassiette.png", { type: "image/png" }) : null;
      const can = Boolean(shareFile && navigator.canShare && navigator.canShare({ files: [shareFile] }));
      $("shareGo").textContent = can ? "Partager" : "Enregistrer l'image";
      $("shareGo").disabled = false;
      $("shareState").textContent = can ? "Envoie-la sur Instagram, Snap, WhatsApp… où tu veux." : "Enregistre l'image, puis publie-la où tu veux.";
    } catch {
      $("shareState").textContent = "L'image n'a pas pu être créée sur cet appareil.";
    }
  });
  $("shareGo").addEventListener("click", async () => {
    if (shareFile && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      try {
        await navigator.share({ files: [shareFile], title: "Ma progression Bon'Assiette", text: "Ma série et mon grade sur Bon'Assiette, le compteur de calories gratuit · bonassiette.fr" });
        track("partage", { mode: "partage" });
      } catch { /* partage annulé */ }
    } else if (!$("shareDl").hidden) { $("shareDl").click(); track("partage", { mode: "image" }); }
  });
  $("shareClose").addEventListener("click", closeShare);
  $("shareBg").addEventListener("click", closeShare);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("shareSheet").hidden) closeShare(); });

  // ---------- Suivi du corps : une mesure par semaine au maximum ----------
  const MEASURE_GAP_DAYS = 7;
  const fmtDate = (k) => new Date(k + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  // La date de la dernière pesée est gardée à part : supprimer une mesure ne débloque pas la suivante.
  function nextMeasureKey() {
    const lastAt = [LS.get("g-measure-at", ""), ...measures.map(m => m.d)].filter(Boolean).sort().pop();
    if (!lastAt) return TODAY;
    const d = new Date(lastAt + "T12:00:00"); d.setDate(d.getDate() + MEASURE_GAP_DAYS);
    return keyOf(d);
  }
  function sparkline(points, unit, cls) {
    if (points.length < 2) return "";
    const W = 320, H = 120, padL = 44, padR = 12, padT = 12, padB = 24;
    const vals = points.map(p => p.v);
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    let lo = vMin, hi = vMax;
    if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1.5; hi = m + 1.5; }
    const t1 = Math.max(1, daysBetween(points[0].d, points[points.length - 1].d));
    const x = (p) => padL + (W - padL - padR) * daysBetween(points[0].d, p.d) / t1;
    const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
    const dots = points.map(p => `<circle cx="${x(p).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" class="${cls}-dot"/>`).join("");
    const f = (v) => String(Math.round(v * 10) / 10).replace(".", ",");
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="Évolution ${unit}">
      <line x1="${padL}" x2="${W - padR}" y1="${y(vMax)}" y2="${y(vMax)}" class="grid"/><line x1="${padL}" x2="${W - padR}" y1="${y(vMin)}" y2="${y(vMin)}" class="grid"/>
      <text x="${padL - 6}" y="${y(vMax) + 4}" class="axis" text-anchor="end">${f(vMax)}</text>${vMax !== vMin ? `<text x="${padL - 6}" y="${y(vMin) + 4}" class="axis" text-anchor="end">${f(vMin)}</text>` : ""}
      <text x="${padL}" y="${H - 6}" class="axis">${esc(fmtDate(points[0].d))}</text><text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${esc(fmtDate(points[points.length - 1].d))}</text>
      <path d="${path}" class="${cls}-line"/>${dots}</svg>`;
  }
  function renderBody() {
    const next = nextMeasureKey(), can = next <= TODAY;
    $("bodyForm").hidden = !can;
    $("bodyWait").hidden = can;
    if (!can) $("bodyWait").textContent = `Prochaine mesure possible le ${fmtDate(next)}. Une fois par semaine suffit largement : idéalement, une fois par mois.`;
    const last = measures[measures.length - 1];
    if (can && last) { $("mW").value = String(last.w); $("mWaist").value = last.waist ? String(last.waist) : ""; }
    if (can && !last) { $("mW").value = String(P().weight); }
    const wPts = measures.map(m => ({ d: m.d, v: m.w }));
    const tPts = measures.filter(m => m.waist).map(m => ({ d: m.d, v: m.waist }));
    const f = (v) => String(Math.round(v * 10) / 10).replace(".", ",");
    const trend = (pts, u) => {
      if (pts.length < 2) return "";
      const dlt = pts[pts.length - 1].v - pts[0].v, n = daysBetween(pts[0].d, pts[pts.length - 1].d);
      return `${dlt === 0 ? "Stable" : (dlt > 0 ? "+" : "−") + f(Math.abs(dlt)) + " " + u} en ${n} jours`;
    };
    $("bodyCharts").innerHTML = measures.length ? `
      <div class="body-chart"><div class="row"><h3>Poids</h3><span class="num">${f(wPts[wPts.length - 1].v)} kg · ${esc(trend(wPts, "kg"))}</span></div>${sparkline(wPts, "du poids", "w")}</div>
      ${tPts.length ? `<div class="body-chart"><div class="row"><h3>Tour de taille</h3><span class="num">${f(tPts[tPts.length - 1].v)} cm · ${esc(trend(tPts, "cm"))}</span></div>${sparkline(tPts, "du tour de taille", "t")}</div>` : ""}
      ${measures.length < 2 ? `<p class="small muted">La courbe apparaîtra à partir de la deuxième mesure.</p>` : ""}
      <details class="src"><summary>Toutes mes mesures</summary><ul>${measures.slice().reverse().map((m, i) => `<li>${esc(fmtDate(m.d))} : ${f(m.w)} kg${m.waist ? ` · ${f(m.waist)} cm` : ""} <button class="del" type="button" data-m="${measures.length - 1 - i}">Supprimer</button></li>`).join("")}</ul></details>`
      : `<p class="small muted">Aucune mesure pour l'instant. Ce suivi est facultatif.</p>`;
  }
  $("bodySave").addEventListener("click", () => {
    if (nextMeasureKey() > TODAY) return;
    const w = Number(String($("mW").value).replace(",", "."));
    const waistRaw = String($("mWaist").value).trim().replace(",", ".");
    const waist = waistRaw ? Number(waistRaw) : null;
    if (!(w >= 30 && w <= 300)) { toast("Indique un poids entre 30 et 300 kg"); return; }
    if (waist !== null && !(waist >= 40 && waist <= 200)) { toast("Indique un tour de taille entre 40 et 200 cm"); return; }
    measures = [...measures, { d: TODAY, w: Math.round(w * 10) / 10, waist: waist ? Math.round(waist * 10) / 10 : null }];
    LS.set("g-measures", measures); LS.set("g-measure-at", TODAY);
    profile = { ...P(), weight: Math.round(w) }; LS.set("g-profile", profile);
    renderBody(); renderDay();
    toast("Mesure enregistrée. Ton objectif du jour est mis à jour.");
  });
  $("bodyCharts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    measures = measures.filter((_, i) => i !== Number(b.dataset.m));
    LS.set("g-measures", measures); renderBody();
  });

  // ---------- Vue Profil ----------
  $("saveProfile").addEventListener("click", () => { profile = readProfile("p-"); LS.set("g-profile", profile); renderDay(); toast("Profil enregistré"); });
  $("resetBtn").addEventListener("click", () => { $("resetConfirm").hidden = false; $("resetBtn").hidden = true; });
  $("resetNo").addEventListener("click", () => { $("resetConfirm").hidden = true; $("resetBtn").hidden = false; });
  $("resetYes").addEventListener("click", () => {
    // Effacer cet appareil : on se déconnecte d'abord pour ne pas écraser la sauvegarde en ligne.
    if (sbUser) { clearTimeout(pushTimer); sb?.auth.signOut({ scope: "local" }).catch(() => {}); sbUser = null; renderAccount(); }
    LS.clear(); profile = null; days = {}; badges = {}; frozen = []; freezes = 0; xp = 0; xpDay = {}; miles = []; measures = [];
    water = {}; trains = {};
    $("resetConfirm").hidden = true; $("resetBtn").hidden = false;
    show("jour"); openOnboarding(1);
  });

  // ---------- Navigation ----------
  const VIEWS = ["jour", "recettes", "progres", "profil", "aide"];
  function show(v) {
    if (!VIEWS.includes(v)) v = "jour";
    VIEWS.forEach(x => $("view-" + x).hidden = x !== v);
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v === v)));
    if (v === "recettes") renderRecipes();
    if (v === "progres") { renderProgress(); renderBody(); renderLeague(); }
    if (v === "profil") mountProfileForm($("profileForm"), "p-");
    if (v === "jour") loadAd("jour");
    track("vue", { onglet: v });
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.v)));
  $("helpBtn").addEventListener("click", () => show("aide"));
  $("helpDone").addEventListener("click", () => show("jour"));

  // ---------- Publicité (uniquement si configurée et pour les non-abonnés) ----------
  let adsScript = null;
  function loadAd(where) {
    const slot = ADS.slots[where], box = $("ad-" + where);
    if (!box || !ADS.client || !slot || isSubscriber()) { if (box) box.hidden = true; return; }
    if (box.dataset.loaded) return;
    box.hidden = false; box.dataset.loaded = "1";
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.dataset.adClient = ADS.client; ins.dataset.adSlot = slot;
    ins.dataset.adFormat = "auto"; ins.dataset.fullWidthResponsive = "true";
    box.appendChild(ins);
    if (!adsScript) {
      adsScript = document.createElement("script");
      adsScript.async = true; adsScript.crossOrigin = "anonymous";
      adsScript.nonce = NONCE;
      adsScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
      document.head.appendChild(adsScript);
    }
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }

  // ---------- Mesure d'audience (Google Analytics) ----------
  // Avec la publicité, le message de consentement officiel de Google s'en charge (mode consentement).
  // Sans publicité, Bon'Assiette affiche son propre bandeau et ne charge Analytics qu'après « Accepter ».
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  let gaLoaded = false;
  function loadGA() {
    if (!GA_ID || gaLoaded) return;
    gaLoaded = true;
    gtag("js", new Date());
    gtag("config", GA_ID, { anonymize_ip: true });
    const s = document.createElement("script");
    s.async = true; s.nonce = NONCE;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  const track = (name, params) => { if (gaLoaded) gtag("event", name, params || {}); };
  const SIX_MONTHS = 182 * 24 * 3600 * 1000;
  function consentState() {
    const c = LS.get("g-consent", null);
    return c && Date.now() - c.at < SIX_MONTHS ? c.v : null;
  }
  function setConsent(v) {
    LS.set("g-consent", { v, at: Date.now() });
    $("consent").hidden = true;
    if (v === "yes") loadGA();
  }
  function initMeasure() {
    if (!GA_ID) return;
    if (ADS.client && Object.values(ADS.slots).some(Boolean)) {
      gtag("consent", "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });
      loadGA();
      return;
    }
    $("cookiesBtn").hidden = false;
    const c = consentState();
    if (c === "yes") loadGA();
    else if (c === null) $("consent").hidden = false;
  }
  $("consentYes").addEventListener("click", () => setConsent("yes"));
  $("consentNo").addEventListener("click", () => setConsent("no"));
  $("cookiesBtn").addEventListener("click", () => {
    if (consentState() === "yes" && gaLoaded) {
      // Retirer son accord : on l'enregistre et on recharge pour arrêter la mesure.
      LS.set("g-consent", { v: "no", at: Date.now() }); location.reload();
    } else { $("consent").hidden = false; }
  });

  // ---------- Toast ----------
  let tt;
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, Math.max(2200, String(msg).length * 70)); }

  // ---------- Installation ----------
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("installBtn").hidden = true; });
  if (window.matchMedia("(display-mode: standalone)").matches) $("installPanel").hidden = true;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").then(() => pushInit()).catch(() => {});
  else pushInit();

  // ---------- Démarrage ----------
  function renderAll() { renderDay(); }
  $("today").textContent = ((s) => s.charAt(0).toUpperCase() + s.slice(1))(today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
  applyFreezes();
  renderAll();
  initMeasure();
  initAccount();
  loadAd("jour");
  if (!profile) openOnboarding(1);
})();
