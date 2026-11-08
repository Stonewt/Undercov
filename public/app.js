(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const r0 = (n) => Math.round(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const euro = (n) => n.toFixed(2).replace(".", ",") + " €";
  const today = new Date(); const TODAY = keyOf(today);
  $("today").textContent = today.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });

  // ---------- Base de plats (valeurs moyennes indicatives par portion) ----------
  // [nom, kcal, protéines, glucides, lipides, mots-clés]
  const FOODS = [
    ["Plateau resto U (entrée, plat, dessert)",850,35,100,30,"crous ru cantine"],
    ["Plat chaud resto U seul",550,28,60,20,"crous ru cantine"],
    ["Kebab galette + frites",1100,45,110,50,"grec tacos"],
    ["Kebab sandwich sans frites",700,38,60,32,"grec"],
    ["Tacos français taille M",1100,45,110,52,"tacos"],
    ["Burger + frites (menu)",1050,35,120,48,"fast food mcdo"],
    ["Pizza entière (marguerita)",1000,42,120,36,"pizza"],
    ["Part de pizza",250,11,30,9,"pizza"],
    ["Pâtes bolognaise (assiette)",600,28,80,18,"pates spaghetti"],
    ["Pâtes au thon et tomate",550,35,75,12,"pates"],
    ["Pâtes carbonara",700,30,80,28,"pates"],
    ["Riz, poulet et légumes",550,40,65,12,"riz"],
    ["Chili con carne et riz",650,32,85,18,"chili"],
    ["Lentilles cuisinées (250 g)",290,20,45,2,"legumineuses"],
    ["Couscous poulet merguez",750,38,80,30,"couscous"],
    ["Sushis (12 pièces)",550,24,85,10,"japonais"],
    ["Nouilles instantanées",400,8,55,16,"ramen"],
    ["Sandwich jambon-beurre",450,20,50,18,"boulangerie"],
    ["Croque-monsieur",400,20,35,20,"boulangerie"],
    ["Quiche lorraine (part)",450,14,28,31,"boulangerie"],
    ["Salade composée au poulet",450,30,25,25,"salade"],
    ["Omelette 3 œufs",300,20,2,23,"oeufs"],
    ["Poulet rôti (150 g)",300,40,0,15,"viande"],
    ["Steak haché 5 % + purée",550,30,45,26,"viande"],
    ["Bol de céréales + lait",350,10,60,6,"petit dejeuner"],
    ["Tartines beurre-confiture (2)",300,5,45,11,"petit dejeuner"],
    ["Croissant",230,5,25,12,"viennoiserie boulangerie"],
    ["Pain au chocolat",280,5,31,15,"viennoiserie boulangerie chocolatine"],
    ["Skyr nature (150 g)",90,15,6,0,"yaourt laitage"],
    ["Yaourt nature",60,4,6,2,"laitage"],
    ["Fromage blanc (200 g)",150,15,8,6,"laitage"],
    ["Banane",105,1,27,0,"fruit"],
    ["Pomme",80,0,21,0,"fruit"],
    ["Poignée d'amandes (30 g)",175,6,6,15,"noix"],
    ["Barre chocolatée",250,3,30,13,"snack"],
    ["Paquet de chips (45 g)",240,3,24,15,"snack apero"],
    ["Shaker de whey (30 g, eau)",120,24,3,2,"proteine"],
    ["Soda (33 cl)",140,0,35,0,"boisson coca"],
    ["Bière (25 cl)",105,1,9,0,"boisson alcool"],
    ["Café au lait sucré",80,3,10,3,"boisson"]
  ].map(([name,kcal,prot,gluc,lip,tags]) => ({ name, kcal, prot, gluc, lip, tags }));

  // ---------- Recettes étudiantes (prix discount estimés par portion) ----------
  const RECIPES = [
    { name:"Pâtes thon-tomate", cost:1.10, min:15, need:["plaques"], kcal:620, prot:38, gluc:85, lip:12,
      ing:[["Pâtes",  "100 g",0.10],["Thon au naturel","1 boîte 140 g",0.75],["Coulis de tomate","150 g",0.20],["Ail, herbes","pincée",0.05]],
      steps:["Cuire les pâtes 10 min.","Chauffer le coulis avec l'ail et les herbes, ajouter le thon émietté.","Mélanger avec les pâtes."], tip:"Fais-en 3 portions : ça se garde 3 jours au frigo." },
    { name:"Riz sauté aux œufs et légumes", cost:0.95, min:15, need:["plaques"], kcal:580, prot:24, gluc:80, lip:17,
      ing:[["Riz","80 g",0.10],["Œufs","2",0.45],["Légumes surgelés","150 g",0.30],["Sauce soja","1 c. à s.",0.10]],
      steps:["Cuire le riz (ou utiliser un reste de la veille).","Faire revenir les légumes, ajouter le riz.","Pousser sur le côté, brouiller les œufs, mélanger avec la sauce soja."], tip:"Le riz de la veille donne un meilleur résultat." },
    { name:"Dahl de lentilles corail au lait de coco", cost:1.20, min:25, need:["plaques"], kcal:600, prot:26, gluc:80, lip:16,
      ing:[["Lentilles corail","90 g",0.30],["Lait de coco","100 ml",0.35],["Tomates concassées","150 g",0.25],["Curry, oignon","",0.20],["Riz","60 g",0.10]],
      steps:["Faire revenir l'oignon et le curry.","Ajouter lentilles, tomates, lait de coco et un verre d'eau ; cuire 15 min.","Servir avec du riz."], tip:"Se congèle très bien." },
    { name:"Wrap poulet-crudités", cost:2.40, min:10, need:[], kcal:550, prot:38, gluc:55, lip:18,
      ing:[["Tortillas","2",0.40],["Blanc de poulet cuit","120 g",1.50],["Salade, tomate","",0.30],["Fromage blanc + moutarde","2 c. à s.",0.20]],
      steps:["Étaler la sauce fromage blanc-moutarde sur les tortillas.","Garnir de poulet et crudités.","Rouler."], tip:"Parfait à emporter en cours." },
    { name:"Chili sin carne", cost:1.30, min:25, need:["plaques"], kcal:650, prot:25, gluc:110, lip:8,
      ing:[["Haricots rouges","1/2 boîte",0.40],["Maïs","1/4 boîte",0.20],["Tomates concassées","200 g",0.30],["Épices chili, oignon","",0.20],["Riz","70 g",0.10]],
      steps:["Faire revenir l'oignon et les épices.","Ajouter tomates, haricots et maïs ; mijoter 15 min.","Servir avec du riz."], tip:"Ajoute un œuf au plat pour plus de protéines." },
    { name:"Tortilla de pommes de terre", cost:1.00, min:25, need:["plaques"], kcal:600, prot:26, gluc:55, lip:28,
      ing:[["Pommes de terre","250 g",0.30],["Œufs","3",0.65],["Oignon","1/2",0.05]],
      steps:["Cuire les pommes de terre en fines rondelles à la poêle 12 min avec l'oignon.","Verser les œufs battus.","Cuire à feu doux à couvert 8 min."], tip:"Se mange chaude ou froide le lendemain." },
    { name:"Patate douce farcie thon-fromage blanc", cost:1.60, min:12, need:["micro"], kcal:520, prot:35, gluc:70, lip:8,
      ing:[["Patate douce","1 moyenne",0.60],["Thon","1/2 boîte",0.40],["Fromage blanc","100 g",0.25],["Ciboulette","",0.10]],
      steps:["Piquer la patate douce, micro-ondes 8 à 10 min.","Mélanger thon, fromage blanc et ciboulette.","Ouvrir la patate et garnir."], tip:"Au four : 45 min à 200 °C, encore meilleur." },
    { name:"Bowl skyr, avoine et banane", cost:1.10, min:5, need:[], kcal:480, prot:30, gluc:70, lip:8,
      ing:[["Skyr","200 g",0.60],["Flocons d'avoine","50 g",0.10],["Banane","1",0.25],["Miel","1 c. à c.",0.10]],
      steps:["Verser le skyr dans un bol.","Ajouter l'avoine, la banane en rondelles et le miel."], tip:"Prépare-le la veille, l'avoine devient plus moelleuse." },
    { name:"Croque au micro-ondes et salade", cost:1.50, min:5, need:["micro"], kcal:500, prot:28, gluc:45, lip:22,
      ing:[["Pain de mie","4 tranches",0.25],["Jambon","2 tranches",0.70],["Fromage râpé","40 g",0.35],["Salade","",0.20]],
      steps:["Monter deux croques jambon-fromage.","Micro-ondes 1 min 30.","Servir avec la salade."], tip:"Au grille-pain à plat, ils deviennent croustillants." },
    { name:"Couscous express pois chiches-légumes", cost:1.40, min:10, need:["bouilloire"], kcal:580, prot:22, gluc:95, lip:10,
      ing:[["Semoule","80 g",0.10],["Pois chiches","1/2 boîte",0.40],["Légumes grillés en bocal","100 g",0.60],["Épices ras-el-hanout","",0.10]],
      steps:["Couvrir la semoule d'eau bouillante, attendre 5 min.","Ajouter pois chiches, légumes et épices.","Mélanger avec un filet d'huile."], tip:"Se mange aussi froid, en salade." },
    { name:"Carbonara économique", cost:1.30, min:15, need:["plaques"], kcal:700, prot:30, gluc:80, lip:28,
      ing:[["Pâtes","100 g",0.10],["Lardons","50 g",0.50],["Œuf","1 + 1 jaune",0.45],["Fromage râpé","20 g",0.20]],
      steps:["Cuire les pâtes, faire dorer les lardons.","Battre œufs et fromage.","Hors du feu, mélanger pâtes, lardons et œufs avec un peu d'eau de cuisson."], tip:"Jamais de crème : c'est l'eau de cuisson qui rend la sauce onctueuse." },
    { name:"Nouilles instantanées améliorées", cost:0.90, min:10, need:["bouilloire"], kcal:520, prot:20, gluc:58, lip:22,
      ing:[["Nouilles instantanées","1 sachet",0.30],["Œuf","1",0.22],["Légumes surgelés","80 g",0.20],["Sauce soja","",0.05]],
      steps:["Préparer les nouilles à l'eau bouillante.","Ajouter les légumes et l'œuf (poché dans le bouillon ou mollet).","Assaisonner."], tip:"N'utilise que la moitié du sachet d'assaisonnement : très salé." }
  ];

  // ---------- Défis du jour (doux, jamais punitifs) ----------
  const DEFIS = [
    { txt:"Atteindre ton objectif de protéines", test:(s,t)=> s.prot >= t.prot },
    { txt:"Noter 3 repas ou collations aujourd'hui", test:(s,t,m)=> m.length >= 3 },
    { txt:"Manger un fruit", test:(s,t,m)=> m.some(x => /banane|pomme|fruit/i.test(x.name)) },
    { txt:"Cuisiner un repas pas cher", test:(s,t,m)=> m.some(x => x.recipe) },
    { txt:"Un repas d'au moins 30 g de protéines", test:(s,t,m)=> m.some(x => x.prot >= 30) },
    { txt:"Rester entre 90 et 110 % de ton objectif de calories", test:(s,t)=> s.kcal >= t.kcal*0.9 && s.kcal <= t.kcal*1.1 },
    { txt:"Noter ton petit-déjeuner", test:(s,t,m)=> m.some(x => Number(String(x.time).slice(0,2)) < 11) }
  ];

  // ---------- Stockage local ----------
  const LS = {
    get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const DEFAULT_PROFILE = { sex:"h", age:21, weight:70, height:175, activity:1.55, goal:"maintien" };
  let profile = { ...DEFAULT_PROFILE, ...LS.get("g-profile", {}) };
  let days = LS.get("g-days", {});              // { "AAAA-MM-JJ": [repas] }
  let badges = LS.get("g-badges", {});          // { id: dateObtenue }
  let kitchen = new Set(["plaques","micro","bouilloire"]);
  const meals = () => days[TODAY] || [];
  const saveDays = () => LS.set("g-days", days);

  // ---------- Calculs ----------
  function targets(p){
    const bmr = 10*p.weight + 6.25*p.height - 5*p.age + (p.sex === "h" ? 5 : -161);
    let kcal = bmr * Number(p.activity);
    if (p.goal === "muscle") kcal *= 1.10;
    if (p.goal === "perte") kcal *= 0.85;                 // déficit limité à 15 %
    kcal = Math.max(kcal, p.sex === "h" ? 1800 : 1500);    // plancher prudent
    const prot = p.weight * (p.goal === "muscle" ? 1.8 : p.goal === "perte" ? 1.6 : 1.2);
    const lip = kcal * 0.30 / 9, gluc = Math.max(0, (kcal - prot*4 - lip*9) / 4);
    return { kcal:r0(kcal), prot:r0(prot), gluc:r0(gluc), lip:r0(lip) };
  }
  const sum = (list) => list.reduce((a,m)=>({kcal:a.kcal+m.kcal,prot:a.prot+m.prot,gluc:a.gluc+m.gluc,lip:a.lip+m.lip}),{kcal:0,prot:0,gluc:0,lip:0});
  function streak(){
    let n = 0; const d = new Date(today);
    if (!(days[keyOf(d)] || []).length) d.setDate(d.getDate()-1);   // la série tient jusqu'à ce soir
    while ((days[keyOf(d)] || []).length) { n++; d.setDate(d.getDate()-1); }
    return n;
  }
  function defiToday(){
    const seed = Number(TODAY.replaceAll("-","")) % DEFIS.length;
    return DEFIS[seed];
  }

  // ---------- Badges ----------
  const BADGES = [
    { id:"first", t:"Premier repas", d:"Noter ton premier repas", test:()=> Object.values(days).some(l=>l.length) },
    { id:"s3", t:"3 jours d'affilée", d:"Une série de 3 jours", test:()=> streak() >= 3 },
    { id:"s7", t:"Une semaine pleine", d:"Une série de 7 jours", test:()=> streak() >= 7 },
    { id:"s30", t:"Un mois de régularité", d:"Une série de 30 jours", test:()=> streak() >= 30 },
    { id:"chef", t:"Chef fauché", d:"Cuisiner 5 recettes pas chères", test:()=> Object.values(days).flat().filter(m=>m.recipe).length >= 5 },
    { id:"prot3", t:"Protéines au rendez-vous", d:"Objectif de protéines atteint 3 jours", test:()=> Object.values(days).filter(l=> sum(l).prot >= targets(profile).prot).length >= 3 },
    { id:"defi5", t:"Défis relevés", d:"Réussir 5 défis du jour", test:()=> LS.get("g-defis", []).length >= 5 }
  ];
  function checkBadges(){
    let fresh = null;
    for (const b of BADGES) if (!badges[b.id] && b.test()) { badges[b.id] = TODAY; fresh = b; }
    LS.set("g-badges", badges);
    if (fresh) toast(`Badge débloqué : ${fresh.t}`);
  }

  // ---------- Rendu : aujourd'hui ----------
  function renderDay(){
    const t = targets(profile), list = meals(), s = sum(list);
    const left = t.kcal - s.kcal;
    $("kcalLeft").textContent = Math.abs(r0(left));
    $("kcalLbl").textContent = left >= 0 ? "KCAL RESTANTES" : "KCAL EN PLUS";
    $("ringArc").style.strokeDashoffset = (326.7 * (1 - Math.min(1, s.kcal/t.kcal))).toFixed(1);
    const bar = (k, b, n) => { $(b).style.width = Math.min(100, s[k]/Math.max(1,t[k])*100) + "%"; $(n).textContent = `${r0(s[k])} / ${t[k]} g`; };
    bar("prot","barP","numP"); bar("gluc","barG","numG"); bar("lip","barL","numL");

    $("streakN").textContent = streak();

    const d = defiToday(), ok = d.test(s, t, list);
    $("defiTxt").textContent = d.txt;
    $("defi").classList.toggle("done", ok);
    $("defiIco").textContent = ok ? "✓" : "!";
    $("defiState").textContent = ok ? "Réussi" : "";
    if (ok) { const done = LS.get("g-defis", []); if (!done.includes(TODAY)) { done.push(TODAY); LS.set("g-defis", done); toast("Défi du jour réussi"); } }

    $("mealCount").textContent = list.length ? `${list.length} REPAS` : "";
    $("meals").innerHTML = list.length ? list.map((m,i) => `
      <div class="meal"><span class="t">${esc(m.name)}</span><span class="k">${r0(m.kcal)} kcal</span>
      <div class="sub"><span>${esc(m.time)}</span><span>P ${r0(m.prot)} g</span><span>G ${r0(m.gluc)} g</span><span>L ${r0(m.lip)} g</span>
      <button class="del" type="button" data-i="${i}">Retirer</button></div></div>`).join("")
      : `<div class="empty"><h3>Rien de noté pour l'instant</h3><p class="small muted">Cherche ton plat ci-dessus : un geste suffit, et ta série démarre.</p></div>`;

    renderRecent();
    checkBadges();
  }

  function renderRecent(){
    const seen = new Map();
    Object.keys(days).sort().reverse().forEach(k => (days[k]||[]).slice().reverse().forEach(m => {
      if (!seen.has(m.name)) seen.set(m.name, { ...m, n: 0 });
      seen.get(m.name).n++;
    }));
    const top = [...seen.values()].sort((a,b)=> b.n - a.n).slice(0, 8);
    $("recentWrap").hidden = !top.length;
    $("recent").innerHTML = top.map((m,i) => `<button class="chip" type="button" data-r="${i}">${esc(m.name)}<b>${r0(m.kcal)}</b></button>`).join("");
    $("recent").onclick = (e) => { const b = e.target.closest("[data-r]"); if (b) addMeal(top[Number(b.dataset.r)]); };
  }

  function addMeal(m){
    const d = new Date();
    const item = { name:m.name, kcal:r0(m.kcal), prot:r0(m.prot), gluc:r0(m.gluc), lip:r0(m.lip), time:`${pad(d.getHours())}h${pad(d.getMinutes())}`, ...(m.recipe ? { recipe:true } : {}) };
    days[TODAY] = [...meals(), item];
    saveDays();
    const before = Number($("streakN").textContent);
    renderDay();
    const after = streak();
    if (after > before && after > 1) toast(`${after} jours d'affilée`);
    else toast(`${item.name} ajouté`);
  }

  // Recherche
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function renderResults(){
    const q = norm($("search").value.trim());
    if (!q) { $("results").innerHTML = ""; return; }
    const hits = FOODS.filter(f => norm(f.name + " " + f.tags).includes(q)).slice(0, 8);
    $("results").innerHTML = hits.length ? hits.map((f,i) => `
      <button class="res" type="button" data-f="${FOODS.indexOf(f)}"><span>${esc(f.name)}</span><span class="k">${f.kcal} kcal</span>
      <span class="sub">P ${f.prot} g · G ${f.gluc} g · L ${f.lip} g</span></button>`).join("")
      : `<p class="small muted pad6">Pas trouvé. Utilise « Saisir un repas à la main ».</p>`;
  }
  $("search").addEventListener("input", renderResults);
  $("results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    addMeal(FOODS[Number(b.dataset.f)]);
    $("search").value = ""; renderResults();
  });

  // Saisie manuelle
  $("customBtn").addEventListener("click", () => { $("customBox").hidden = !$("customBox").hidden; if (!$("customBox").hidden) $("cName").focus(); });
  $("cAdd").addEventListener("click", () => {
    const name = $("cName").value.trim(), kcal = Number($("cK").value);
    if (!name || !(kcal > 0)) { toast("Indique au moins un nom et des calories"); return; }
    addMeal({ name, kcal, prot:Number($("cP").value)||0, gluc:Number($("cG").value)||0, lip:Number($("cL").value)||0 });
    ["cName","cK","cP","cG","cL"].forEach(id => $(id).value = "");
    $("customBox").hidden = true;
  });

  $("meals").addEventListener("click", (e) => {
    const b = e.target.closest(".del"); if (!b) return;
    days[TODAY] = meals().filter((_, i) => i !== Number(b.dataset.i));
    if (!days[TODAY].length) delete days[TODAY];
    saveDays(); renderDay();
  });

  // ---------- Rendu : recettes ----------
  function renderRecipes(){
    const t = targets(profile), s = sum(meals());
    const kc = r0(t.kcal - s.kcal), pr = r0(t.prot - s.prot);
    $("needLine").textContent = kc > 0 ? `Il te reste environ ${kc} kcal et ${Math.max(0,pr)} g de protéines pour aujourd'hui. Les recettes les plus riches en protéines passent en premier.` : "Ton objectif du jour est atteint. Voici des idées pour demain.";
    const budget = Number($("budget").value), time = Number($("time").value);
    const list = RECIPES.filter(r => r.cost <= budget && r.min <= time && r.need.every(n => kitchen.has(n)))
      .sort((a,b) => (b.prot/b.cost) - (a.prot/a.cost));
    $("recipes").innerHTML = list.length ? list.map(r => `
      <article class="ticket">
        <div class="row top"><div class="head">${esc(r.name)}</div><span class="price">${euro(r.cost)}</span></div>
        <div class="line"><span>${r.min} min · ${r.kcal} kcal</span><span>P ${r.prot} · G ${r.gluc} · L ${r.lip}</span></div>
        <div class="rule"></div>
        ${r.ing.map(([n,q,c]) => `<div class="line"><span>${esc(n)}${q ? ` <span class="muted">· ${esc(q)}</span>` : ""}</span><span>${euro(c)}</span></div>`).join("")}
        <div class="rule"></div>
        <ol class="steps">${r.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
        <p class="tip">${esc(r.tip)}</p>
        <button class="primary" type="button" data-cook="${RECIPES.indexOf(r)}">Je l'ai mangé</button>
      </article>`).join("")
      : `<div class="note">Aucune recette ne correspond. Augmente le budget ou le temps, ou ajoute un équipement.</div>`;
  }
  $("recipes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cook]"); if (!b) return;
    const r = RECIPES[Number(b.dataset.cook)];
    addMeal({ ...r, recipe:true });
  });
  ["budget","time"].forEach(id => $(id).addEventListener("change", renderRecipes));
  document.querySelectorAll("#kitchen button").forEach(b => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    on ? kitchen.add(b.dataset.k) : kitchen.delete(b.dataset.k);
    renderRecipes();
  }));

  // ---------- Rendu : progrès ----------
  function renderProgress(){
    const t = targets(profile), cols = [];
    let total = 0, n = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = keyOf(d), s = sum(days[k] || []);
      if (s.kcal) { total += s.kcal; n++; }
      const h = Math.max(4, Math.min(100, s.kcal / t.kcal * 100));
      const ok = s.prot >= t.prot;
      cols.push(`<div class="wd" title="${d.toLocaleDateString("fr-FR")} : ${r0(s.kcal)} kcal, ${r0(s.prot)} g de protéines">
        <div class="col ${ok ? "ok" : ""} ${i === 0 ? "today" : ""}" data-h="${s.kcal ? h : 4}"></div>
        <span>${d.toLocaleDateString("fr-FR",{weekday:"short"}).slice(0,2)}</span></div>`);
    }
    $("week").innerHTML = cols.join("");
    $("week").querySelectorAll("[data-h]").forEach(el => { el.style.height = Number(el.dataset.h) + "%"; });
    $("weekAvg").textContent = n ? `MOYENNE ${r0(total/n)} KCAL` : "";
    const got = BADGES.filter(b => badges[b.id]).length;
    $("badgeCount").textContent = `${got} / ${BADGES.length}`;
    $("badges").innerHTML = BADGES.map(b => `<div class="badge ${badges[b.id] ? "on" : ""}"><span class="bt">${esc(b.t)}</span><span class="bd">${esc(b.d)}</span></div>`).join("");
  }

  // ---------- Profil ----------
  function renderProfile(){
    $("sex").value = profile.sex; $("age").value = profile.age; $("weight").value = profile.weight;
    $("height").value = profile.height; $("activity").value = String(profile.activity);
    document.querySelectorAll("#goal button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.g === profile.goal)));
    targetLine();
  }
  function readProfile(){
    const c = (v,a,b,d) => { v = Number(v); return Number.isFinite(v) && v ? Math.min(b, Math.max(a, v)) : d; };
    return { sex:$("sex").value, age:c($("age").value,18,99,21), weight:c($("weight").value,35,250,70), height:c($("height").value,130,230,175),
      activity:Number($("activity").value), goal:document.querySelector('#goal button[aria-pressed="true"]')?.dataset.g || "maintien" };
  }
  function targetLine(){ const t = targets(readProfile()); $("targetLine").textContent = `Objectif : ${t.kcal} kcal · ${t.prot} g de protéines · ${t.gluc} g de glucides · ${t.lip} g de lipides par jour.`; }
  document.querySelectorAll("#goal button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#goal button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); targetLine();
  }));
  ["sex","age","weight","height","activity"].forEach(id => $(id).addEventListener("input", targetLine));
  $("saveProfile").addEventListener("click", () => { profile = readProfile(); LS.set("g-profile", profile); renderDay(); toast("Profil enregistré"); });

  // ---------- Onglets ----------
  function show(v){
    ["jour","recettes","progres","profil"].forEach(x => $("view-"+x).hidden = x !== v);
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v === v)));
    if (v === "recettes") renderRecipes();
    if (v === "progres") renderProgress();
    window.scrollTo({ top:0 });
  }
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.v)));

  // ---------- Toast ----------
  let tt;
  function toast(msg){ const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 2200); }

  // ---------- Installation (écran d'accueil) ----------
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(()=>{}); deferred = null; $("installBtn").hidden = true; });
  if (window.matchMedia("(display-mode: standalone)").matches) $("installPanel").hidden = true;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- Démarrage ----------
  renderProfile(); renderDay();
})();
