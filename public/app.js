(() => {
  "use strict";

  // ---------- Réglages ----------
  // Réglages envoyés par le serveur (voir config.js). Vides = publicité et mesure désactivées.
  let CFG = {};
  try { CFG = JSON.parse(document.getElementById("cfg")?.textContent || "{}"); } catch { CFG = {}; }
  const ADS = { client: CFG.adsClient || "", slots: CFG.adSlots || {} };
  const GA_ID = /^G-[A-Z0-9]{6,12}$/.test(CFG.gaId || "") ? CFG.gaId : "";
  const NONCE = document.querySelector("script[nonce]")?.nonce || "";
  // L'abonnement sera vérifié par le serveur ; en attendant, personne n'est abonné.
  const isSubscriber = () => false;

  const DATA = window.GAMELLE_DATA || { foods: [], recipes: [] };
  const FOODS = DATA.foods, RECIPES = DATA.recipes;

  // ---------- Outils ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const r0 = (n) => Math.round(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const euro = (n) => n.toFixed(2).replace(".", ",") + " €";
  const nb = (n) => r0(n).toLocaleString("fr-FR");
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const ciqUrl = (code) => `https://ciqual.anses.fr/#/aliments/${encodeURIComponent(code)}`;
  const today = new Date(); const TODAY = keyOf(today);

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith("g-")).forEach(k => localStorage.removeItem(k)); } catch { /* rien */ } }
  };

  // ---------- État ----------
  const DEFAULT_PROFILE = { sex: "h", age: 21, weight: 70, height: 175, activity: 1.55, goal: "maintien" };
  let profile = LS.get("g-profile", null);
  let days = LS.get("g-days", {});
  let badges = LS.get("g-badges", {});
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
    const prot = p.weight * (p.goal === "muscle" ? 1.8 : p.goal === "perte" ? 1.6 : 1.2);
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
  function streak() {
    let n = 0; const d = new Date(today);
    if (!(days[keyOf(d)] || []).length) d.setDate(d.getDate() - 1);
    while ((days[keyOf(d)] || []).length) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const BADGES = [
    { id: "first", t: "Premier repas", d: "Noter ton premier repas", test: () => Object.values(days).some(l => l.length) },
    { id: "s3", t: "3 jours d'affilée", d: "Une série de 3 jours", test: () => streak() >= 3 },
    { id: "s7", t: "Une semaine pleine", d: "Une série de 7 jours", test: () => streak() >= 7 },
    { id: "s30", t: "Un mois de régularité", d: "Une série de 30 jours", test: () => streak() >= 30 },
    { id: "chef", t: "Chef fauché", d: "Cuisiner 5 recettes pas chères", test: () => Object.values(days).flat().filter(m => m.recipe).length >= 5 },
    { id: "prot3", t: "Protéines au rendez-vous", d: "Objectif de protéines atteint 3 jours", test: () => Object.values(days).filter(l => sum(l).prot >= targets(P()).prot).length >= 3 },
    { id: "defi5", t: "Défis relevés", d: "Réussir 5 défis du jour", test: () => LS.get("g-defis", []).length >= 5 }
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
    $("goalLine").textContent = `Objectif « ${GOALS[p.goal].toLowerCase()} » : ${nb(t.kcal)} kcal et ${t.prot} g de protéines par jour.`;
    $("streakN").textContent = streak();

    const d = defiToday(), ok = d.test(s, t, list);
    $("defiTxt").textContent = d.txt;
    $("defi").classList.toggle("done", ok);
    $("defiIco").textContent = ok ? "✓" : "!";
    $("defiState").textContent = ok ? "Réussi" : "";
    if (ok) { const done = LS.get("g-defis", []); if (!done.includes(TODAY)) { done.push(TODAY); LS.set("g-defis", done); toast("Défi du jour réussi"); } }

    $("mealCount").textContent = list.length ? `${list.length} REPAS` : "";
    $("meals").innerHTML = list.length ? list.map((m, i) => `
      <div class="meal"><span class="t">${esc(m.name)}${m.qty && m.qty !== 1 ? ` <span class="muted">× ${esc(String(m.qty).replace(".", ","))}</span>` : ""}</span><span class="k">${nb(m.kcal)} kcal</span>
      <div class="sub"><span>${esc(m.time)}</span><span>P ${r0(m.prot)} g</span><span>G ${r0(m.gluc)} g</span><span>L ${r0(m.lip)} g</span>
      <button class="del" type="button" data-i="${i}">Retirer</button></div></div>`).join("")
      : `<div class="empty"><h3>Rien de noté pour l'instant</h3><p class="small muted">Cherche ce que tu as mangé dans « Ajouter un repas » : un geste suffit, et ta série démarre.</p></div>`;

    renderRecent();
    checkBadges();
  }

  function renderRecent() {
    const seen = new Map();
    Object.keys(days).sort().reverse().forEach(k => (days[k] || []).slice().reverse().forEach(m => {
      const key = m.name + "|" + (m.qty || 1);
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
      time: `${pad(d.getHours())}h${pad(d.getMinutes())}`, qty: m.qty || 1, ...(m.recipe ? { recipe: true } : {})
    };
    days[TODAY] = [...meals(), item];
    saveDays();
    track(item.recipe ? "recette_mangee" : "repas_ajoute", { nb_jour: days[TODAY].length, serie: streak() });
    const before = Number($("streakN").textContent);
    renderDay();
    const after = streak();
    toast(after > before && after > 1 ? `${after} jours d'affilée` : `${item.name} ajouté`);
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
      : `<p class="small muted pad6">Pas trouvé. Utilise « Saisir un repas à la main » avec les valeurs de l'étiquette.</p>`;
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
  let sheetFood = null, sheetQty = 1, lastFocus = null;
  function openSheet(f) {
    sheetFood = f; sheetQty = 1; lastFocus = document.activeElement;
    $("sheetTitle").textContent = f.name;
    $("sheetPortion").textContent = "Portion de référence : " + f.portion;
    $("sheetSrc").innerHTML = `<p>Table Ciqual 2025, ANSES. Valeurs calculées pour la portion :</p><ul>${f.src.map(([code, g, nm]) => `<li>${esc(nm)} — ${g} g <span class="mono">(code ${esc(code)})</span></li>`).join("")}</ul><p class="mono">${esc(ciqUrl(f.src[0][0]).replace("https://", ""))}</p>`;
    setQty(1);
    $("sheetBg").hidden = false; $("sheet").hidden = false;
    $("sheetAdd").focus();
  }
  function setQty(q) {
    sheetQty = q;
    $("sheetQty").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.q) === q)));
    const f = sheetFood;
    $("sheetVals").innerHTML = `
      <div class="line tot"><span>Calories</span><span>${nb(f.kcal * q)} kcal</span></div>
      <div class="line"><span><i class="dot d-p"></i>Protéines</span><span>${r0(f.prot * q)} g</span></div>
      <div class="line"><span><i class="dot d-g"></i>Glucides</span><span>${r0(f.gluc * q)} g</span></div>
      <div class="line"><span><i class="dot d-l"></i>Lipides</span><span>${r0(f.lip * q)} g</span></div>`;
  }
  function closeSheet() { $("sheetBg").hidden = true; $("sheet").hidden = true; sheetFood = null; lastFocus?.focus?.(); }
  $("sheetQty").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) setQty(Number(b.dataset.q)); });
  $("sheetCancel").addEventListener("click", closeSheet);
  $("sheetBg").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
  $("sheetAdd").addEventListener("click", () => {
    const f = sheetFood, q = sheetQty; if (!f) return;
    addMeal({ name: f.name, kcal: f.kcal * q, prot: f.prot * q, gluc: f.gluc * q, lip: f.lip * q, qty: q });
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

  $("meals").addEventListener("click", (e) => {
    const b = e.target.closest(".del"); if (!b) return;
    days[TODAY] = meals().filter((_, i) => i !== Number(b.dataset.i));
    if (!days[TODAY].length) delete days[TODAY];
    saveDays(); renderDay();
  });

  // ---------- Vue Pas cher ----------
  function renderRecipes() {
    const t = targets(P()), s = sum(meals());
    const kc = r0(t.kcal - s.kcal), pr = r0(t.prot - s.prot);
    $("needLine").textContent = kc > 0
      ? `Il te reste environ ${nb(kc)} kcal et ${Math.max(0, pr)} g de protéines aujourd'hui. Les recettes qui donnent le plus de protéines par euro passent en premier.`
      : "Ton objectif du jour est atteint. Voici des idées pour demain.";
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
    $("weekAvg").textContent = n ? `MOYENNE ${nb(total / n)} KCAL` : "";
    const got = BADGES.filter(b => badges[b.id]).length;
    $("badgeCount").textContent = `${got} / ${BADGES.length}`;
    $("badges").innerHTML = BADGES.map(b => `<div class="badge ${badges[b.id] ? "on" : ""}"><span class="bt">${esc(b.t)}</span><span class="bd">${esc(b.d)}</span></div>`).join("");
  }

  // ---------- Vue Profil ----------
  $("saveProfile").addEventListener("click", () => { profile = readProfile("p-"); LS.set("g-profile", profile); renderDay(); toast("Profil enregistré"); });
  $("resetBtn").addEventListener("click", () => { $("resetConfirm").hidden = false; $("resetBtn").hidden = true; });
  $("resetNo").addEventListener("click", () => { $("resetConfirm").hidden = true; $("resetBtn").hidden = false; });
  $("resetYes").addEventListener("click", () => {
    LS.clear(); profile = null; days = {}; badges = {};
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
    if (v === "progres") renderProgress();
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
  // Sans publicité, Gamelle affiche son propre bandeau et ne charge Analytics qu'après « Accepter ».
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
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 2200); }

  // ---------- Installation ----------
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("installBtn").hidden = true; });
  if (window.matchMedia("(display-mode: standalone)").matches) $("installPanel").hidden = true;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});

  // ---------- Démarrage ----------
  function renderAll() { renderDay(); }
  $("today").textContent = today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  renderAll();
  initMeasure();
  loadAd("jour");
  if (!profile) openOnboarding(1);
})();
