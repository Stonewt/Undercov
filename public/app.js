const socket = io();
window.socket = socket;

let currentRoom = null;
window.currentRoom = null;

let myPlayerId = localStorage.getItem("playerId") || null;
window.myPlayerId = myPlayerId;
let myPlayerToken = localStorage.getItem("playerToken") || null;
let myRoomCode = localStorage.getItem("roomCode") || null;
let timerInterval = null;
let selectedVoteTargetId = null;
let selectedVoteTargetName = null;
let voteAlreadySent = false;
let currentTurnKey = null;
let autoSubmittedTurnKey = null;
let previousVisiblePlayerIds = [];
let lastTensionSecondPlayed = null;
let mobileActiveTab = null;

// ─── DOM refs ───────────────────────────────────────────
const nameInput        = document.getElementById("nameInput");
const roomInput        = document.getElementById("roomInput");
const createBtn        = document.getElementById("createBtn");
const joinBtn          = document.getElementById("joinBtn");
const resumeBlock      = document.getElementById("resumeBlock");
const resumeBtn        = document.getElementById("resumeBtn");
const resumeSeparator  = document.getElementById("resumeSeparator");
const statusBanner     = document.getElementById("statusBanner");
const topRoomInfo      = document.getElementById("topRoomInfo");
const topHostInfo      = document.getElementById("topHostInfo");
const startWrap        = document.getElementById("startWrap");
const roomSetupCard    = document.getElementById("roomSetupCard");
const leaveWrap        = document.getElementById("leaveWrap");
const leaveBtn         = document.getElementById("leaveBtn");
const lobby            = document.getElementById("lobby");
const phaseInfo        = document.getElementById("phaseInfo");
const speakerInfo      = document.getElementById("speakerInfo");
const playersList      = document.getElementById("playersList");
const startBtn         = document.getElementById("startBtn");
const restartBtn       = document.getElementById("restartBtn");
const secretCard       = document.getElementById("secretCard");
const wordText         = document.getElementById("wordText");
const compositionCard  = document.getElementById("compositionCard");
const compositionHelp  = document.getElementById("compositionHelp");
const compositionSummary = document.getElementById("compositionSummary");
const undercoverCountInput = document.getElementById("undercoverCountInput");
const mrWhiteCountInput    = document.getElementById("mrWhiteCountInput");
const turnDurationInput    = document.getElementById("turnDurationInput");
const voteDurationInput    = document.getElementById("voteDurationInput");
const categorySelect       = document.getElementById("categorySelect");
const subcategorySelect    = document.getElementById("subcategorySelect");
const chatCard         = document.getElementById("chatCard");
const messagesList     = document.getElementById("messagesList");
const chatInput        = document.getElementById("chatInput");
const sendChatBtn      = document.getElementById("sendChatBtn");
const chatHelp         = document.getElementById("chatHelp");
const roleDolls        = document.getElementById("roleDolls");
const waitingRoleDolls = document.getElementById("waitingRoleDolls");
const waitingCard      = document.getElementById("waitingCard");
const waitingText      = document.getElementById("waitingText");
const waitingCategory  = document.getElementById("waitingCategory");
const waitingSubcategory = document.getElementById("waitingSubcategory");
const waitingTurnDuration = document.getElementById("waitingTurnDuration");
const waitingVoteDuration = document.getElementById("waitingVoteDuration");
const voteCard         = document.getElementById("voteCard");
const voteButtons      = document.getElementById("voteButtons");
const selectedVoteText = document.getElementById("selectedVoteText");
const confirmVoteBtn   = document.getElementById("confirmVoteBtn");
const endCard          = document.getElementById("endCard");
const endTitle         = document.getElementById("endTitle");
const winnerText       = document.getElementById("winnerText");
const revealList       = document.getElementById("revealList");
const timerFill        = document.getElementById("timerFill");
const timerText        = document.getElementById("timerText");

let audioCtx = null;

// ─── AUDIO ──────────────────────────────────────────────
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
}

function playTone({ type="triangle", from=440, to=660, duration=0.08, gain=0.05 }={}) {
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gn  = audioCtx.createGain();
  osc.type = type;
  osc.connect(gn); gn.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 0.001), now + duration);
  gn.gain.setValueAtTime(0.0001, now);
  gn.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  gn.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now); osc.stop(now + duration + 0.01);
}

function playClickSound(type = "default") {
  const map = {
    soft:    { type:"sine",     from:520, to:760, duration:0.05, gain:0.035 },
    success: { type:"triangle", from:660, to:980, duration:0.09, gain:0.05  },
    join:    { type:"triangle", from:520, to:840, duration:0.1,  gain:0.05  },
    leave:   { type:"sawtooth", from:420, to:220, duration:0.1,  gain:0.04  },
    vote:    { type:"square",   from:500, to:680, duration:0.07, gain:0.035 },
    tension: { type:"square",   from:780, to:840, duration:0.06, gain:0.028 },
    reveal:  { type:"triangle", from:340, to:720, duration:0.16, gain:0.045 },
    default: { type:"triangle", from:420, to:620, duration:0.04, gain:0.04  },
  };
  playTone(map[type] || map.default);
}

function attachUiSounds() {
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) { playClickSound("default"); return; }
    if (e.target.closest("select,input")) playClickSound("soft");
  }, { passive: true });
}

// ─── STATUS ─────────────────────────────────────────────
function setStatus(msg, important = false) {
  statusBanner.textContent = msg;
  statusBanner.classList.remove("hidden");
  statusBanner.classList.toggle("important", important);
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => {
    statusBanner.classList.add("hidden");
    statusBanner.classList.remove("important");
  }, important ? 2200 : 1600);
}

// ─── COPY ────────────────────────────────────────────────
function copyText(text, cb) {
  const done = () => cb?.();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { fallback(); done(); });
    return;
  }
  fallback(); done();
  function fallback() {
    const el = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove();
  }
}

function initTopRoomCopy() {
  if (!topRoomInfo) return;
  topRoomInfo.addEventListener("click", () => {
    if (!currentRoom?.code) return;
    copyText(currentRoom.code, () => {
      topRoomInfo.classList.add("copy-flash");
      setStatus(`Code ${currentRoom.code} copié`);
      setTimeout(() => topRoomInfo.classList.remove("copy-flash"), 950);
    });
  });
}

// ─── SESSION ─────────────────────────────────────────────
function saveSession(playerId, playerToken, roomCode) {
  myPlayerId = playerId; window.myPlayerId = playerId;
  myPlayerToken = playerToken;
  myRoomCode = roomCode || myRoomCode;
  localStorage.setItem("playerId", playerId);
  localStorage.setItem("playerToken", playerToken);
  if (myRoomCode) localStorage.setItem("roomCode", myRoomCode);
}

function clearSession() {
  myPlayerId = myPlayerToken = myRoomCode = null;
  ["playerId","playerToken","roomCode"].forEach(k => localStorage.removeItem(k));
}

function updateResumeUI(canResume = false) {
  resumeBlock?.classList.toggle("hidden", !canResume);
  resumeSeparator?.classList.toggle("hidden", !canResume);
  if (canResume && myRoomCode && resumeBtn)
    resumeBtn.textContent = `↩ Reprendre ma partie (${myRoomCode})`;
}

function validateStoredSession() {
  if (!myPlayerToken || !myRoomCode) { updateResumeUI(false); return; }
  socket.emit("checkSession", { playerToken: myPlayerToken, roomCode: myRoomCode }, (res) => {
    if (!res?.ok) { clearSession(); updateResumeUI(false); return; }
    updateResumeUI(true);
  });
}

// ─── HELPERS ─────────────────────────────────────────────
function normalizeSingleWordInput(v) {
  if (typeof v !== "string") return "";
  const c = v.trim().replace(/\s+/g," ");
  return c ? c.split(" ")[0].slice(0,24) : "";
}

function stopTimer() {
  clearInterval(timerInterval); timerInterval = null;
  if (timerFill) { timerFill.style.width = "0%"; timerFill.style.background = "#22c55e"; }
  if (timerText) timerText.textContent = "--";
  lastTensionSecondPlayed = null;
}

function resetVoteSelection() {
  selectedVoteTargetId = selectedVoteTargetName = null;
  voteAlreadySent = false;
  if (selectedVoteText) selectedVoteText.textContent = "Aucun joueur sélectionné.";
  if (confirmVoteBtn) confirmVoteBtn.disabled = true;
}

function isMobile() { return window.innerWidth <= 820; }

// ─── MOBILE : construction dynamique des panels ──────────
function getMobileTabs(room) {
  if (!room) return [];
  const isHost = room.hostPlayerId === myPlayerId;
  if (room.gameOver) {
    return [{ id:"mob-result", label:"🏁 Résultat" }];
  }
  if (!room.started) {
    if (isHost) return [
      { id:"mob-waiting-players", label:"👥 Joueurs" },
      { id:"mob-config",          label:"⚙ Config"  },
    ];
    return [{ id:"mob-waiting-players", label:"👥 Attente" }];
  }
  const tabs = [
    { id:"mob-word",    label:"🔤 Mot"     },
    { id:"mob-chat",    label:"💬 Chat"    },
    { id:"mob-players", label:"👥 Joueurs" },
    { id:"mob-vote",    label:"🗳 Vote", isVote: true },
  ];
  return tabs;
}

function buildMobileTabs(room) {
  const tabBar  = document.getElementById("mobileTabBar");
  const mobArea = document.getElementById("mobileArea");
  if (!tabBar || !mobArea) return;

  const tabs = getMobileTabs(room);
  const validIds = tabs.map(t => t.id);

  let defaultTab = validIds[0] || null;
  if (room.gameOver)              defaultTab = "mob-result";
  else if (room.phase==="voting") defaultTab = "mob-vote";
  else if (room.started)          defaultTab = "mob-chat";
  else                            defaultTab = "mob-waiting-players";

  if (!mobileActiveTab || !validIds.includes(mobileActiveTab)) {
    mobileActiveTab = defaultTab;
  }

  tabBar.innerHTML = "";
  tabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.className = "mobile-game-tab";
    if (tab.isVote) btn.classList.add("vote-tab");
    if (tab.isVote && room.phase==="voting" && !room.gameOver) btn.classList.add("vote-tab-active-phase");
    if (tab.id === mobileActiveTab) btn.classList.add("active");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      mobileActiveTab = tab.id;
      buildMobileTabs(room);
    });
    tabBar.appendChild(btn);
  });

  tabBar.style.display = "flex";
  mobArea.style.display = "block";

  mobArea.innerHTML = "";
  switch (mobileActiveTab) {
    case "mob-waiting-players": renderMobWaitingPlayers(room, mobArea); break;
    case "mob-config":          renderMobConfig(mobArea);               break;
    case "mob-word":            renderMobWord(mobArea);                 break;
    case "mob-chat":            renderMobChat(room, mobArea);           break;
    case "mob-players":         renderMobPlayers(room, mobArea);        break;
    case "mob-vote":            renderMobVote(room, mobArea);           break;
    case "mob-result":          renderMobResult(room, mobArea);         break;
  }
}

// ── Salle d'attente / lobby ──────────────────────────────
function renderMobWaitingPlayers(room, area) {
  const isHost = room.hostPlayerId === myPlayerId;
  const box = mkPanel();

  const title = document.createElement("h2");
  title.className = "waiting-title";
  title.textContent = isHost ? "Salon d'attente" : "En attente…";
  box.appendChild(title);

  const sub = document.createElement("p");
  sub.style.cssText = "text-align:center;font-size:14px;opacity:.70;margin-bottom:16px;";
  sub.textContent = isHost
    ? `${room.players.length} joueur(s) connecté(s). Configure dans l'onglet ⚙ Config.`
    : "L'hôte va bientôt lancer la partie…";
  box.appendChild(sub);

  appendDolls(box, room, "Composition prévue");

  const meta = document.createElement("div");
  meta.className = "waiting-meta";
  meta.style.margin = "14px 0";
  meta.innerHTML = `
    <div class="waiting-meta-item"><span class="waiting-meta-label">Catégorie</span><span>${room.selectedCategory||"--"}</span></div>
    <div class="waiting-meta-item"><span class="waiting-meta-label">Sous-cat.</span><span>${room.selectedSubcategory||"--"}</span></div>
    <div class="waiting-meta-item"><span class="waiting-meta-label">Tour</span><span>${room.turnDurationSeconds||30} s</span></div>
    <div class="waiting-meta-item"><span class="waiting-meta-label">Vote</span><span>${room.voteDurationSeconds||30} s</span></div>
  `;
  box.appendChild(meta);

  appendLabel(box, "Joueurs");
  const ul = document.createElement("ul");
  ul.className = "players-list-mobile";
  room.players.forEach(p => {
    const li = document.createElement("li");
    li.className = "players-list-mobile-item";
    let label = p.name;
    if (p.id === myPlayerId) label += " (toi)";
    if (p.id === room.hostPlayerId) label += " 👑";
    if (!p.connected) label += " — déconnecté";
    li.textContent = label;
    ul.appendChild(li);
  });
  box.appendChild(ul);

  if (isHost) {
    const btn = mkBigBtn("Lancer la partie", "#22c55e", "#16a34a");
    btn.style.marginTop = "18px";
    btn.addEventListener("click", doStartGame);
    box.appendChild(btn);
  }

  area.appendChild(box);
}

// ── Config (hôte en lobby) ───────────────────────────────
function renderMobConfig(area) {
  const box = mkPanel();
  appendLabel(box, "Configuration");

  if (!currentRoom) { area.appendChild(box); return; }
  const room = currentRoom;
  const n = room.players.length;

  box.appendChild(mkField("Undercovers", () => {
    const inp = document.createElement("input");
    inp.type="number"; inp.min="1"; inp.step="1";
    inp.value = undercoverCountInput?.value || "1";
    inp.style.cssText = "width:100%;background:rgba(255,255,255,.9);color:#111;border-radius:10px;padding:10px 12px;font-size:16px;border:none;";
    inp.addEventListener("input", () => {
      if (undercoverCountInput) { undercoverCountInput.value = inp.value; renderComposition(room); }
    });
    if (n<=3) inp.disabled=true;
    return inp;
  }));

  box.appendChild(mkField("Mr White (0 ou 1)", () => {
    const inp = document.createElement("input");
    inp.type="number"; inp.min="0"; inp.max="1"; inp.step="1";
    inp.value = mrWhiteCountInput?.value || "0";
    inp.style.cssText = "width:100%;background:rgba(255,255,255,.9);color:#111;border-radius:10px;padding:10px 12px;font-size:16px;border:none;";
    inp.addEventListener("input", () => {
      if (mrWhiteCountInput) { mrWhiteCountInput.value = inp.value; renderComposition(room); }
    });
    if (n<=3) inp.disabled=true;
    return inp;
  }));

  const turnVal = document.createElement("span");
  turnVal.textContent = turnDurationInput?.value || "30";
  box.appendChild(mkField(`Durée du tour : ${turnVal.textContent} s`, () => {
    const inp = document.createElement("input");
    inp.type="range"; inp.min="15"; inp.max="45"; inp.step="1";
    inp.value = turnDurationInput?.value || "30";
    inp.className = "duration-slider";
    inp.addEventListener("input", () => {
      if (turnDurationInput) { turnDurationInput.value=inp.value; renderComposition(room); }
      inp.previousElementSibling && (inp.previousElementSibling.textContent = `Durée du tour : ${inp.value} s`);
    });
    return inp;
  }));

  box.appendChild(mkField(`Durée du vote : ${voteDurationInput?.value||"30"} s`, () => {
    const inp = document.createElement("input");
    inp.type="range"; inp.min="15"; inp.max="45"; inp.step="1";
    inp.value = voteDurationInput?.value || "30";
    inp.className = "duration-slider";
    inp.addEventListener("input", () => {
      if (voteDurationInput) { voteDurationInput.value=inp.value; renderComposition(room); }
    });
    return inp;
  }));

  if (room.categoryOptions?.length) {
    box.appendChild(mkField("Catégorie", () => {
      const sel = document.createElement("select");
      sel.style.cssText = "width:100%;background:rgba(255,255,255,.9);color:#111;border-radius:10px;padding:10px 12px;font-size:16px;border:none;";
      room.categoryOptions.forEach(cat => {
        const o=document.createElement("option"); o.value=cat.name; o.textContent=cat.name;
        if (cat.name===(categorySelect?.value||room.selectedCategory)) o.selected=true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        if (categorySelect) { categorySelect.value=sel.value; populateSubcategorySelect(room, sel.value); renderComposition(room); }
        buildMobileTabs(room);
      });
      return sel;
    }));

    const selCat = categorySelect?.value || room.selectedCategory;
    const catObj = room.categoryOptions.find(c=>c.name===selCat)||room.categoryOptions[0];
    if (catObj?.subcategories?.length && selCat !== "Tout") {
      box.appendChild(mkField("Sous-catégorie", () => {
        const sel = document.createElement("select");
        sel.style.cssText = "width:100%;background:rgba(255,255,255,.9);color:#111;border-radius:10px;padding:10px 12px;font-size:16px;border:none;";
        catObj.subcategories.forEach(name => {
          const o=document.createElement("option"); o.value=name; o.textContent=name;
          if (name===(subcategorySelect?.value||room.selectedSubcategory)) o.selected=true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => {
          if (subcategorySelect) { subcategorySelect.value=sel.value; renderComposition(room); }
        });
        return sel;
      }));
    }
  }

  if (compositionSummary?.textContent) {
    const sum = document.createElement("p");
    sum.style.cssText = "font-size:12px;color:#fdba74;font-weight:600;margin:12px 0;";
    sum.textContent = compositionSummary.textContent;
    box.appendChild(sum);
  }
  appendDolls(box, room, "Composition");

  const btn = mkBigBtn("Lancer la partie", "#22c55e", "#16a34a");
  btn.style.marginTop = "18px";
  btn.addEventListener("click", doStartGame);
  box.appendChild(btn);

  area.appendChild(box);
}

// ── Mot secret ───────────────────────────────────────────
function renderMobWord(area) {
  const box = mkPanel();
  box.style.cssText += "display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;";

  const lbl = document.createElement("p");
  lbl.style.cssText = "font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.50;margin-bottom:20px;";
  lbl.textContent = "Ton mot secret";
  box.appendChild(lbl);

  const w = document.createElement("p");
  w.style.cssText = `font-family:'Syne',sans-serif;font-size:42px;font-weight:800;letter-spacing:1px;
    color:#fff;text-align:center;padding:32px 24px;border-radius:20px;
    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
    text-shadow:0 0 40px rgba(255,255,255,0.20);margin:0;width:100%;
    animation:wordReveal .5s cubic-bezier(.22,1,.36,1);`;
  w.textContent = wordText?.textContent || "—";
  box.appendChild(w);

  const hint = document.createElement("p");
  hint.style.cssText = "text-align:center;font-size:13px;opacity:.50;margin-top:20px;line-height:1.5;max-width:280px;";
  const hasWord = wordText?.textContent && wordText.textContent !== "Tu n'as pas de mot.";
  hint.textContent = hasWord
    ? "Donne des indices sans dire ce mot !"
    : "Tu es Mr White. Observe et bluff !";
  box.appendChild(hint);

  area.appendChild(box);
}

// ── Chat ─────────────────────────────────────────────────
function renderMobChat(room, area) {
  const box = mkPanel();
  box.className = "mob-panel-chat";

  const ph = document.createElement("p");
  ph.style.cssText = "font-size:13px;font-weight:700;opacity:.80;margin:0 0 3px;font-family:'Syne',sans-serif;flex-shrink:0;";
  ph.textContent = phaseInfo?.textContent || "";
  box.appendChild(ph);

  const sp = document.createElement("p");
  sp.style.cssText = "font-size:13px;color:#fdba74;font-weight:600;margin:0 0 10px;flex-shrink:0;min-height:18px;";
  sp.textContent = speakerInfo?.textContent || "";
  box.appendChild(sp);

  const msgs = document.createElement("div");
  msgs.className = "messages";
  (room.messages||[]).forEach(msg => {
    const div = document.createElement("div");
    div.className = "message" + (!msg.playerId ? " system" : "");
    const ns = document.createElement("span"); ns.className="message-name"; ns.textContent=msg.playerName;
    const ts = document.createElement("span"); ts.className="message-text"; ts.textContent=" "+msg.text;
    div.appendChild(ns); div.appendChild(ts); msgs.appendChild(div);
  });
  box.appendChild(msgs);
  setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 0);

  const me = room.players.find(p => p.id === myPlayerId);
  const isMyTurn = room.phase==="speaking" && room.currentSpeakerId===myPlayerId && me && !me.eliminated;

  const row = document.createElement("div");
  row.className = "row";

  const inp = document.createElement("input");
  inp.maxLength=24;
  inp.placeholder=isMyTurn?"Ton mot…":"Ce n'est pas ton tour";
  inp.disabled=!isMyTurn;
  inp.style.fontSize="16px";
  inp.autocomplete="off";

  const sendB = document.createElement("button");
  sendB.textContent="Envoyer"; sendB.disabled=!isMyTurn; sendB.style.whiteSpace="nowrap";

  inp.addEventListener("input", () => {
    const v = normalizeSingleWordInput(inp.value);
    if (inp.value!==v) inp.value=v;
    sendB.disabled = !isMyTurn || !v;
  });
  inp.addEventListener("keydown", e => { if(e.key==="Enter"&&!sendB.disabled) sendB.click(); });
  sendB.addEventListener("click", () => {
    const text = normalizeSingleWordInput(inp.value);
    if (!text) return;
    socket.emit("sendTurnMessage", { text }, (res) => {
      if (!res?.ok) return setStatus(res?.error||"Impossible d'envoyer", true);
      chatInput.value=""; sendChatBtn.disabled=true;
      playClickSound("success"); setStatus("Mot envoyé");
    });
  });

  row.appendChild(inp); row.appendChild(sendB);
  box.appendChild(row);

  const help = document.createElement("p");
  help.style.cssText="font-size:11px;opacity:.50;margin-top:6px;flex-shrink:0;";
  help.textContent = isMyTurn
    ? "Entre un seul mot. Tu ne peux pas écrire ton mot secret."
    : (room.phase==="voting" ? "Vote en cours." : "Ce n'est pas ton tour.");
  box.appendChild(help);

  area.appendChild(box);
}

// ── Joueurs + compo ──────────────────────────────────────
function renderMobPlayers(room, area) {
  const box = mkPanel();

  appendLabel(box, `Joueurs — Manche ${room.round}`);

  const ul = document.createElement("ul");
  ul.className = "players-list-mobile";
  sortPlayersForDisplay(room).forEach(p => {
    const li = document.createElement("li");
    li.className = "players-list-mobile-item";
    if (p.eliminated) li.classList.add("player-dead");
    if (p.id===room.currentSpeakerId && room.phase==="speaking" && !room.gameOver) li.classList.add("player-current");
    let label = p.name;
    if (p.id===myPlayerId) label+=" (toi)";
    if (p.id===room.hostPlayerId) label+=" 👑";
    if (p.eliminated) label+=" — éliminé";
    else if (p.id===room.currentSpeakerId && room.phase==="speaking") label+=" — parle";
    li.textContent=label;
    ul.appendChild(li);
  });
  box.appendChild(ul);

  appendDolls(box, room, "Composition");

  area.appendChild(box);
}

// ── Vote ─────────────────────────────────────────────────
function renderMobVote(room, area) {
  const box = mkPanel();

  const me = room.players.find(p => p.id === myPlayerId);

  if (room.phase !== "voting" || room.gameOver) {
    box.innerHTML=`
      <div class="vote-not-ready-inner" style="padding:50px 16px;text-align:center;">
        <div class="vote-not-ready-icon">🗳</div>
        <p class="vote-not-ready-title">Pas encore le moment</p>
        <p class="vote-not-ready-sub">Le vote s'ouvrira une fois que tous les joueurs auront donné leur indice.</p>
      </div>`;
    area.appendChild(box); return;
  }

  if (me?.eliminated) {
    const p=document.createElement("p");
    p.style.cssText="text-align:center;opacity:.55;padding:40px 16px;";
    p.textContent="Tu es éliminé et ne peux pas voter.";
    box.appendChild(p); area.appendChild(box); return;
  }

  const header=document.createElement("div"); header.className="vote-card-header";
  header.innerHTML=`<div class="vote-pulse-dot"></div><h2>⚡ Vote en cours</h2>`;
  box.appendChild(header);

  const btnsWrap=document.createElement("div");
  const votables=room.players.filter(p=>!p.eliminated&&p.id!==myPlayerId);

  const infoText=document.createElement("p");
  infoText.style.cssText="font-size:13px;opacity:.80;margin:10px 0 6px;";
  infoText.textContent=voteAlreadySent
    ? `Vote confirmé contre ${selectedVoteTargetName}.`
    : (selectedVoteTargetId ? `Cible : ${selectedVoteTargetName}` : "Aucun joueur sélectionné.");

  const confirmB=document.createElement("button");
  confirmB.style.cssText="width:100%;background:linear-gradient(180deg,#f97316,#ea580c);box-shadow:0 5px 0 rgba(0,0,0,.28),0 8px 22px rgba(249,115,22,.32);margin-top:4px;";
  confirmB.textContent="Confirmer mon vote";
  confirmB.disabled=!selectedVoteTargetId||voteAlreadySent;

  votables.forEach(player => {
    const btn=document.createElement("button");
    btn.className="vote-btn"+(selectedVoteTargetId===player.id?" vote-btn-selected":"");
    btn.textContent=`Choisir ${player.name}`;
    if (voteAlreadySent) btn.disabled=true;
    btn.addEventListener("click", () => {
      if (voteAlreadySent) return;
      selectedVoteTargetId=player.id; selectedVoteTargetName=player.name;
      btnsWrap.querySelectorAll(".vote-btn").forEach(b=>b.classList.remove("vote-btn-selected"));
      btn.classList.add("vote-btn-selected");
      confirmB.disabled=false;
      infoText.textContent=`Cible : ${player.name}`;
    });
    btnsWrap.appendChild(btn);
  });
  box.appendChild(btnsWrap);
  box.appendChild(infoText);

  confirmB.addEventListener("click", () => {
    if (!selectedVoteTargetId||voteAlreadySent) return;
    socket.emit("votePlayer", { targetId:selectedVoteTargetId }, (res) => {
      if (!res?.ok) return setStatus(res?.error||"Impossible de voter", true);
      voteAlreadySent=true; confirmB.disabled=true;
      infoText.textContent=`Vote confirmé contre ${selectedVoteTargetName}.`;
      voteAlreadySent=true; if(confirmVoteBtn) confirmVoteBtn.disabled=true;
      playClickSound("vote"); setStatus("Vote envoyé", true);
    });
  });
  box.appendChild(confirmB);

  area.appendChild(box);
}

// ── Résultat ─────────────────────────────────────────────
function renderMobResult(room, area) {
  const box = mkPanel();

  const title=document.createElement("h2");
  title.style.cssText="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;text-align:center;margin-bottom:10px;";
  title.textContent=getMyOutcome(room)||"Fin de partie";
  box.appendChild(title);

  const sub=document.createElement("p");
  sub.style.cssText="text-align:center;font-size:15px;opacity:.80;margin-bottom:16px;";
  sub.textContent=room.winner==="aucun"?"La partie a été interrompue.":`Équipe gagnante : ${room.winner}`;
  box.appendChild(sub);

  if (room.reveal) {
    const ul=document.createElement("ul");
    ul.style.cssText="list-style:none;margin:0;padding:0;display:grid;gap:8px;";
    room.reveal.forEach((player,i) => {
      const li=document.createElement("li"); li.className="reveal-item"; li.style.animationDelay=`${i*120}ms`;
      const badge=document.createElement("span"); badge.className=`reveal-role-badge ${player.role}`; badge.textContent=player.role;
      const text=document.createElement("span"); text.className="reveal-main-text";
      text.textContent=`${player.name} • ${player.word||"aucun mot"}`;
      li.appendChild(badge); li.appendChild(text); ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  if (room.hostPlayerId===myPlayerId) {
    const btn=mkBigBtn("⚙ Configurer & Rejouer", "#22c55e", "#16a34a");
    btn.style.marginTop="18px";
    btn.addEventListener("click", () => {
      socket.emit("returnToLobby", {}, (res) => {
        if (!res?.ok) return setStatus(res?.error||"Impossible", true);
        playClickSound("success"); setStatus("Retour au lobby !");
      });
    });
    box.appendChild(btn);
  }

  area.appendChild(box);
}

// ─── UTILS DOM ───────────────────────────────────────────
function mkPanel() {
  const d=document.createElement("div");
  d.style.cssText="width:100%;box-sizing:border-box;padding:4px 0;";
  return d;
}

function mkBigBtn(label, c1, c2) {
  const btn=document.createElement("button");
  btn.className="big-btn";
  btn.textContent=label;
  btn.style.background=`linear-gradient(180deg,${c1},${c2})`;
  return btn;
}

function mkField(labelText, inputFactory) {
  const wrap=document.createElement("div");
  wrap.className="form-block";
  const lbl=document.createElement("label");
  lbl.style.cssText="display:block;margin-bottom:6px;font-size:14px;opacity:.85;font-weight:500;";
  lbl.textContent=labelText;
  wrap.appendChild(lbl);
  wrap.appendChild(inputFactory());
  return wrap;
}

function appendLabel(parent, text) {
  const p=document.createElement("p");
  p.style.cssText="font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:.50;margin-bottom:10px;";
  p.textContent=text;
  parent.appendChild(p);
}

function appendDolls(parent, room, label) {
  const wrap=document.createElement("div"); wrap.className="role-dolls-wrap";
  const t=document.createElement("div"); t.className="role-dolls-title"; t.textContent=label;
  const row=document.createElement("div"); row.className="role-dolls";
  fillRoleDolls(row, room);
  wrap.appendChild(t); wrap.appendChild(row); parent.appendChild(wrap);
}

// ─── RESET UI ────────────────────────────────────────────
function resetUI() {
  currentRoom=null; window.currentRoom=null;
  currentTurnKey=autoSubmittedTurnKey=null;
  previousVisiblePlayerIds=[]; lastTensionSecondPlayed=null;
  mobileActiveTab=null;

  lobby.classList.add("hidden");
  if(secretCard) secretCard.classList.add("hidden");
  if(compositionCard) { compositionCard.classList.add("hidden"); compositionCard.style=""; }
  if(chatCard) chatCard.classList.add("hidden");
  if(waitingCard) waitingCard.classList.add("hidden");
  if(voteCard) voteCard.classList.add("hidden");
  if(endCard) endCard.classList.add("hidden");
  leaveWrap.classList.add("hidden");
  startWrap.classList.remove("hidden");
  roomSetupCard.classList.remove("hidden");

  topRoomInfo.classList.add("hidden");
  topHostInfo.classList.add("hidden");
  const cs=document.getElementById("topRoomCode"); if(cs) cs.textContent="";
  topHostInfo.textContent="";

  playersList.innerHTML="";
  if(messagesList) messagesList.innerHTML="";
  if(voteButtons) voteButtons.innerHTML="";
  if(revealList) revealList.innerHTML="";
  if(roleDolls) roleDolls.innerHTML="";
  if(waitingRoleDolls) waitingRoleDolls.innerHTML="";

  if(phaseInfo) phaseInfo.textContent="";
  if(speakerInfo) speakerInfo.textContent="";
  if(wordText) wordText.textContent="";
  if(winnerText) winnerText.textContent="";
  if(compositionHelp) compositionHelp.textContent="";
  if(compositionSummary) compositionSummary.textContent="";
  if(waitingCategory) waitingCategory.textContent="--";
  if(waitingSubcategory) waitingSubcategory.textContent="--";
  if(waitingTurnDuration) waitingTurnDuration.textContent="--";
  if(waitingVoteDuration) waitingVoteDuration.textContent="--";
  if(chatInput) chatInput.value="";
  if(categorySelect) categorySelect.innerHTML="";
  if(subcategorySelect) subcategorySelect.innerHTML="";
  // FIX : réinitialiser le gameId pour éviter le bug d'écran de fin
  if(endCard) { endCard.dataset.renderedGameId=""; }

  // Supprimer le bouton returnToLobby s'il existe
  document.getElementById("returnToLobbyBtn")?.remove();

  // Reset zone mobile
  const tabBar=document.getElementById("mobileTabBar");
  const mobArea=document.getElementById("mobileArea");
  if(tabBar) { tabBar.innerHTML=""; tabBar.style.display="none"; }
  if(mobArea) { mobArea.innerHTML=""; mobArea.style.display="none"; }

  resetVoteSelection();
  stopTimer();
  validateStoredSession();
}

function hideGameplayButtons() {
  startBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
}

// ─── DESKTOP HELPERS ─────────────────────────────────────
function sortPlayersForDisplay(room) {
  if (!room.started || !Array.isArray(room.speakingOrder) || !room.speakingOrder.length)
    return [...room.players];
  const idx=new Map(room.speakingOrder.map((id,i)=>[id,i]));
  return [...room.players].sort((a,b)=>(idx.get(a.id)??Infinity)-(idx.get(b.id)??Infinity));
}

function renderPlayers(room) {
  playersList.innerHTML="";
  sortPlayersForDisplay(room).forEach(player => {
    const li=document.createElement("li");
    if(player.eliminated) li.classList.add("player-dead");
    if(player.id===room.currentSpeakerId&&room.phase==="speaking"&&!room.gameOver) li.classList.add("player-current");
    const ns=document.createElement("span"); ns.className="player-name";
    let label=player.name;
    if(player.id===myPlayerId) label+=" (toi)";
    if(player.id===room.hostPlayerId) label+=" 👑";
    ns.textContent=label; li.appendChild(ns);
    const sub=[];
    if(player.id===room.currentSpeakerId&&room.phase==="speaking"&&!room.gameOver) sub.push("réfléchit");
    if(player.eliminated) sub.push("éliminé");
    if(sub.length) { const s=document.createElement("span"); s.className="player-sub"; s.textContent=sub.join(" • "); li.appendChild(s); }
    playersList.appendChild(li);
  });
}

function getDisplayCounts(room) {
  if (room.started) return room.roleComposition || {};
  const n = room.players.length;
  let u = 1, m = 0;
  if (undercoverCountInput) u = Math.max(1, parseInt(undercoverCountInput.value, 10) || 1);
  if (mrWhiteCountInput)    m = Math.max(0, Math.min(1, parseInt(mrWhiteCountInput.value, 10) || 0));
  if (n <= 3) return { civil: 2, undercover: 1, mrwhite: 0 };
  u = Math.min(u, Math.max(1, n - m - 1));
  let c = n - u - m;
  if (c < 1) { u = Math.max(1, n - m - 1); c = n - u - m; }
  return { civil: c, undercover: u, mrwhite: m };
}

function fillRoleDolls(container, room) {
  if (!container) return;
  container.innerHTML = "";
  const c = getDisplayCounts(room);
  [...Array(c.civil||0).fill("civil"), ...Array(c.undercover||0).fill("undercover"), ...Array(c.mrwhite||0).fill("mrwhite")]
    .forEach(role => {
      const d = document.createElement("div"); d.className = `role-doll ${role}`;
      const h = document.createElement("div"); h.className = "role-doll-head";
      const b = document.createElement("div"); b.className = "role-doll-body";
      d.appendChild(h); d.appendChild(b); container.appendChild(d);
    });
}

function renderRoleDolls(room) {
  fillRoleDolls(roleDolls, room);
  fillRoleDolls(waitingRoleDolls, room);
  const hw = document.getElementById("roleDollsHostWrap");
  const hc = document.getElementById("roleDollsHost");
  if (hw && hc) {
    const isHost = room.hostPlayerId === myPlayerId;
    const show = isHost && !room.started && !room.gameOver;
    const c = getDisplayCounts(room);
    const total = (c.civil||0) + (c.undercover||0) + (c.mrwhite||0);
    hw.style.display = (show && total > 0) ? "" : "none";
    if (show) fillRoleDolls(hc, room);
  }
}

function renderMessages(room) {
  messagesList.innerHTML="";
  (room.messages||[]).forEach(msg=>{
    const div=document.createElement("div"); div.className="message"+(!msg.playerId?" system":"");
    const ns=document.createElement("span"); ns.className="message-name"; ns.textContent=msg.playerName;
    const ts=document.createElement("span"); ts.className="message-text"; ts.textContent=" "+msg.text;
    div.appendChild(ns); div.appendChild(ts); messagesList.appendChild(div);
  });
  messagesList.scrollTop=messagesList.scrollHeight;
}

function renderChat(room) {
  if(!room.started||room.gameOver) { chatCard.classList.add("hidden"); return; }
  chatCard.classList.remove("hidden");
  renderRoleDolls(room); renderMessages(room);
  const me=room.players.find(p=>p.id===myPlayerId);
  const isMyTurn=room.phase==="speaking"&&room.currentSpeakerId===myPlayerId&&me&&!me.eliminated;
  chatInput.disabled=!isMyTurn;
  sendChatBtn.disabled=!isMyTurn||!normalizeSingleWordInput(chatInput.value);
  chatHelp.textContent=room.phase==="voting"?"Vote en cours.":isMyTurn?"Entre un seul mot. Tu ne peux pas écrire ton mot secret.":"Ce n'est pas ton tour.";
}

function renderWaitingRoom(room) {
  const isHost=room.hostPlayerId===myPlayerId;
  const show=!room.started&&!room.gameOver&&!isHost;
  waitingCard.classList.toggle("hidden",!show);
  if(!show) return;
  renderRoleDolls(room);
  waitingText.textContent="En attente du lancement de la partie par l'hôte…";
  waitingCategory.textContent=room.selectedCategory||"--";
  waitingSubcategory.textContent=room.selectedSubcategory||"--";
  waitingTurnDuration.textContent=`${room.turnDurationSeconds||30} s`;
  waitingVoteDuration.textContent=`${room.voteDurationSeconds||30} s`;
}

function renderVoteButtons(room) {
  voteButtons.innerHTML="";
  const me=room.players.find(p=>p.id===myPlayerId);
  if(!me||me.eliminated||room.phase!=="voting"||room.gameOver) { voteCard.classList.add("hidden"); resetVoteSelection(); return; }
  voteCard.classList.remove("hidden");
  room.players.filter(p=>!p.eliminated&&p.id!==myPlayerId).forEach(player=>{
    const btn=document.createElement("button"); btn.className="vote-btn"; btn.textContent=`Choisir ${player.name}`;
    if(selectedVoteTargetId===player.id) btn.classList.add("vote-btn-selected");
    btn.onclick=()=>{
      if(voteAlreadySent) return;
      selectedVoteTargetId=player.id; selectedVoteTargetName=player.name;
      selectedVoteText.textContent=`Cible sélectionnée : ${player.name}`;
      confirmVoteBtn.disabled=false; renderVoteButtons(room);
    };
    voteButtons.appendChild(btn);
  });
  if(voteAlreadySent) { confirmVoteBtn.disabled=true; selectedVoteText.textContent=`Vote confirmé contre ${selectedVoteTargetName}.`; }
}

function getMyOutcome(room) {
  if(!room.gameOver||!room.reveal) return null;
  if(room.winner==="aucun") return "Partie arrêtée";
  const me=room.reveal.find(p=>p.id===myPlayerId); if(!me) return null;
  if(room.winner==="civils"&&me.role==="civil") return "Victoire";
  if(room.winner==="undercover"&&me.role==="undercover") return "Victoire";
  if(room.winner==="mrwhite"&&me.role==="mrwhite") return "Victoire";
  return "Défaite";
}

function renderEndGame(room) {
  if(!room.gameOver) { endCard.classList.add("hidden"); return; }
  // FIX : utiliser gameId unique pour éviter d'afficher le mauvais écran de fin
  const already=endCard.dataset.renderedGameId===String(room.gameId);
  endCard.classList.remove("hidden");
  endTitle.textContent=getMyOutcome(room)||"Fin de partie";
  winnerText.textContent=room.winner==="aucun"
    ?"La partie a été interrompue."
    :`Équipe gagnante : ${room.winner}`;
  if(!already) {
    revealList.innerHTML="";
    (room.reveal||[]).forEach((player,i)=>{
      const li=document.createElement("li"); li.className="reveal-item"; li.style.animationDelay=`${i*120}ms`;
      const badge=document.createElement("span"); badge.className=`reveal-role-badge ${player.role}`; badge.textContent=player.role;
      const text=document.createElement("span"); text.className="reveal-main-text"; text.textContent=`${player.name} • ${player.word||"aucun mot"}`;
      li.appendChild(badge); li.appendChild(text); revealList.appendChild(li);
    });
    endCard.dataset.renderedGameId=String(room.gameId);
    playClickSound("reveal");
  }
}

function renderTimer(room) {
  stopTimer();
  let endAt=null, total=null;
  if(room.phase==="speaking"&&room.turnEndsAt) { endAt=room.turnEndsAt; total=room.turnDurationMs||30000; }
  else if(room.phase==="voting"&&room.voteEndsAt) { endAt=room.voteEndsAt; total=room.voteDurationMs||30000; }
  else return;
  const tick=()=>{
    const rem=Math.max(0,endAt-Date.now());
    const pct=Math.max(0,Math.min(100,(rem/total)*100));
    const sec=Math.ceil(rem/1000);
    timerFill.style.width=`${pct}%`;
    timerText.textContent=`${sec} s`;
    timerFill.style.background=rem<=3000?"#ef4444":rem<=7000?"#f59e0b":"#22c55e";
    if(sec<=5&&sec>0&&lastTensionSecondPlayed!==sec) { lastTensionSecondPlayed=sec; playClickSound("tension"); }
    const isMyTurn=room.phase==="speaking"&&room.currentSpeakerId===myPlayerId&&!room.gameOver;
    if(isMyTurn&&rem<=250&&currentTurnKey&&autoSubmittedTurnKey!==currentTurnKey) {
      const w=normalizeSingleWordInput(chatInput.value);
      if(w&&!sendChatBtn.disabled) { autoSubmittedTurnKey=currentTurnKey; sendChatBtn.click(); }
    }
    if(rem<=0) stopTimer();
  };
  tick(); timerInterval=setInterval(tick,250);
}

function clampCompositionValues(room) {
  if(!undercoverCountInput||!mrWhiteCountInput) return {undercoverCount:1,mrwhiteCount:0,civilCount:room.players.length-1};
  const n=room.players.length;
  if(n<=3) { undercoverCountInput.value="1"; mrWhiteCountInput.value="0"; return {undercoverCount:1,mrwhiteCount:0,civilCount:2}; }
  let u=Math.max(1,parseInt(undercoverCountInput.value,10)||1);
  let m=Math.max(0,Math.min(1,parseInt(mrWhiteCountInput.value,10)||0));
  u=Math.min(u,Math.max(1,n-m-1));
  let c=n-u-m; if(c<1) { u=Math.max(1,n-m-1); c=n-u-m; }
  undercoverCountInput.value=String(u); mrWhiteCountInput.value=String(m);
  return {undercoverCount:u,mrwhiteCount:m,civilCount:c};
}

function clampSeconds(v,fallback=30) { const n=parseInt(v,10); return isNaN(n)?fallback:Math.max(15,Math.min(45,n)); }

function populateCategorySelect(room) {
  if(!categorySelect||!subcategorySelect) return;
  const opts=Array.isArray(room.categoryOptions)?room.categoryOptions:[];
  const cur=categorySelect.value;
  const sel=opts.find(o=>o.name===cur)?.name||room.selectedCategory||opts[0]?.name||"Tout";
  categorySelect.innerHTML="";
  opts.forEach(cat=>{ const o=document.createElement("option"); o.value=cat.name; o.textContent=cat.name; o.selected=cat.name===sel; categorySelect.appendChild(o); });
  const isTout=categorySelect.value==="Tout";
  const subWrap=subcategorySelect?.closest(".form-block");
  if(subWrap) subWrap.style.display=isTout?"none":"";
  if(!isTout) populateSubcategorySelect(room, sel, subcategorySelect.value||room.selectedSubcategory);
}

function populateSubcategorySelect(room,catName,pref=null) {
  if(!subcategorySelect) return;
  if(catName==="Tout") {
    subcategorySelect.innerHTML="";
    const subWrap=subcategorySelect.closest(".form-block");
    if(subWrap) subWrap.style.display="none";
    return;
  }
  const opts=Array.isArray(room.categoryOptions)?room.categoryOptions:[];
  const cat=opts.find(i=>i.name===catName)||opts[0];
  const subs=cat?.subcategories||[];
  const sel=(pref&&subs.includes(pref))?pref:(room.selectedSubcategory&&subs.includes(room.selectedSubcategory))?room.selectedSubcategory:subs[0]||"";
  subcategorySelect.innerHTML="";
  subs.forEach(name=>{ const o=document.createElement("option"); o.value=name; o.textContent=name; o.selected=name===sel; subcategorySelect.appendChild(o); });
  const subWrap=subcategorySelect.closest(".form-block");
  if(subWrap) subWrap.style.display="";
}

function getSelectedComposition(room) { const v=clampCompositionValues(room); return {undercoverCount:v.undercoverCount,mrwhiteCount:v.mrwhiteCount}; }

function getSelectedSettings(room) {
  const t=clampSeconds(turnDurationInput?.value,room?.turnDurationSeconds||30);
  const v=clampSeconds(voteDurationInput?.value,room?.voteDurationSeconds||30);
  if(turnDurationInput) turnDurationInput.value=String(t);
  if(voteDurationInput) voteDurationInput.value=String(v);
  const cat=categorySelect?.value||room?.selectedCategory||"Tout";
  const sub=cat==="Tout"?null:(subcategorySelect?.value||room?.selectedSubcategory||null);
  return {turnDurationSeconds:t,voteDurationSeconds:v,category:cat,subcategory:sub};
}

function renderComposition(room) {
  if(!compositionCard) return;
  const isHost=room.hostPlayerId===myPlayerId;
  if(!(!room.started&&!room.gameOver&&isHost)) { compositionCard.classList.add("hidden"); return; }
  compositionCard.classList.remove("hidden");
  const n=room.players.length;
  if(turnDurationInput!==document.activeElement) turnDurationInput.value=String(clampSeconds(turnDurationInput.value,room.turnDurationSeconds||30));
  if(voteDurationInput!==document.activeElement) voteDurationInput.value=String(clampSeconds(voteDurationInput.value,room.voteDurationSeconds||30));
  populateCategorySelect(room);
  if(n<=3) { undercoverCountInput.disabled=true; mrWhiteCountInput.disabled=true; undercoverCountInput.value="1"; mrWhiteCountInput.value="0"; compositionHelp.textContent="À 3 joueurs : composition fixe."; }
  else { undercoverCountInput.disabled=false; mrWhiteCountInput.disabled=false; undercoverCountInput.min="1"; undercoverCountInput.max=String(n-1); mrWhiteCountInput.min="0"; mrWhiteCountInput.max="1"; compositionHelp.textContent="Choisissez la composition, les durées et la catégorie."; }
  const vals=clampCompositionValues(room); const sets=getSelectedSettings(room);
  compositionSummary.textContent=`${vals.civilCount} civil(s) • ${vals.undercoverCount} undercover(s)${vals.mrwhiteCount?" • 1 Mr White":""} • Tours ${sets.turnDurationSeconds}s • Vote ${sets.voteDurationSeconds}s`;
  renderRoleDolls(room);
}
window.renderComposition=renderComposition;

function handlePresenceSounds(room) {
  const ids=(room.players||[]).map(p=>p.id);
  if(!previousVisiblePlayerIds.length) { previousVisiblePlayerIds=ids; return; }
  if(ids.filter(id=>!previousVisiblePlayerIds.includes(id)).length) playClickSound("join");
  else if(previousVisiblePlayerIds.filter(id=>!ids.includes(id)).length) playClickSound("leave");
  previousVisiblePlayerIds=ids;
}

// ─── MAIN RENDER ─────────────────────────────────────────
function renderRoom(room) {
  handlePresenceSounds(room);
  currentRoom=room; window.currentRoom=room;
  myRoomCode=room.code; localStorage.setItem("roomCode",room.code);

  lobby.classList.remove("hidden");
  leaveWrap.classList.remove("hidden");
  startWrap.classList.add("hidden");

  const host=room.players.find(p=>p.id===room.hostPlayerId);
  const cs=document.getElementById("topRoomCode"); if(cs) cs.textContent="Room "+room.code;
  topRoomInfo.classList.remove("hidden");
  topHostInfo.textContent=host?`Hôte : ${host.name}`:"Pas d'hôte";
  topHostInfo.classList.remove("hidden");

  const nextKey=`${room.code}-${room.phase}-${room.round}-${room.currentSpeakerId||"none"}`;
  if(currentTurnKey!==nextKey) {
    currentTurnKey=nextKey; autoSubmittedTurnKey=null; lastTensionSecondPlayed=null;
    if(!(room.phase==="speaking"&&room.currentSpeakerId===myPlayerId)) chatInput.value="";
  }

  phaseInfo.textContent=!room.started?"Salon":`Manche ${room.round}`;
  if(!room.started) { speakerInfo.textContent="La partie n'a pas encore commencé"; }
  else {
    const spk=room.players.find(p=>p.id===room.currentSpeakerId);
    speakerInfo.textContent=room.phase==="speaking"&&spk?`${spk.name} réfléchit`
      :room.phase==="voting"?`Vote en cours (${room.voteCount}/${room.players.filter(p=>!p.eliminated).length})`:"";
  }

  renderPlayers(room);
  renderComposition(room);
  renderChat(room);
  renderWaitingRoom(room);
  renderTimer(room);
  hideGameplayButtons();

  const isHost=room.hostPlayerId===myPlayerId;
  if(!room.started&&isHost) startBtn.classList.remove("hidden");

  // Bouton "Configurer & Rejouer" pour l'hôte en fin de partie
  if(room.gameOver&&isHost) {
    restartBtn.classList.add("hidden");
    let lobbyBtn = document.getElementById("returnToLobbyBtn");
    if(!lobbyBtn) {
      lobbyBtn = document.createElement("button");
      lobbyBtn.id = "returnToLobbyBtn";
      lobbyBtn.textContent = "⚙ Configurer & Rejouer";
      lobbyBtn.style.background = "linear-gradient(180deg,#22c55e,#16a34a)";
      lobbyBtn.addEventListener("click", () => {
        socket.emit("returnToLobby", {}, (res) => {
          if(!res?.ok) return setStatus(res?.error||"Impossible", true);
          playClickSound("success"); setStatus("Retour au lobby !");
        });
      });
      document.querySelector(".room-actions-bottom")?.appendChild(lobbyBtn);
    }
    lobbyBtn.classList.remove("hidden");
  } else {
    document.getElementById("returnToLobbyBtn")?.classList.add("hidden");
  }

  if(room.started&&!room.gameOver) secretCard.classList.remove("hidden");
  renderVoteButtons(room);
  renderEndGame(room);

  if(isMobile()) {
    if(room.gameOver) mobileActiveTab="mob-result";
    else if(room.phase==="voting" && mobileActiveTab!=="mob-vote") mobileActiveTab="mob-vote";
    else if(room.started && !["mob-word","mob-chat","mob-players","mob-vote"].includes(mobileActiveTab)) mobileActiveTab="mob-chat";
    else if(!room.started && isHost && !["mob-waiting-players","mob-config"].includes(mobileActiveTab)) mobileActiveTab="mob-waiting-players";
    else if(!room.started && !isHost) mobileActiveTab="mob-waiting-players";
    buildMobileTabs(room);
  }
}
window.renderRoom=renderRoom;

// ─── LANDING TABS ────────────────────────────────────────
function initMobileTabs() {
  const mobileTabs=document.getElementById("mobileTabs");
  const loginCard=document.getElementById("roomSetupCard");
  const rulesCard=document.getElementById("rulesCard");
  if(!mobileTabs||!loginCard||!rulesCard) return;
  const apply=()=>{
    if(window.innerWidth>820) { mobileTabs.classList.add("hidden"); loginCard.classList.remove("hidden-tab"); rulesCard.classList.remove("active"); return; }
    mobileTabs.classList.remove("hidden");
    const active=mobileTabs.querySelector(".mobile-tab-btn.active");
    if(active?.dataset.tab==="rules") { loginCard.classList.add("hidden-tab"); rulesCard.classList.add("active"); }
    else { loginCard.classList.remove("hidden-tab"); rulesCard.classList.remove("active"); }
  };
  mobileTabs.querySelectorAll(".mobile-tab-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      mobileTabs.querySelectorAll(".mobile-tab-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      if(btn.dataset.tab==="rules") { loginCard.classList.add("hidden-tab"); rulesCard.classList.add("active"); }
      else { loginCard.classList.remove("hidden-tab"); rulesCard.classList.remove("active"); }
    });
  });
  apply(); window.addEventListener("resize",apply);
}

// ─── ACTIONS ─────────────────────────────────────────────
function doStartGame() {
  const composition=currentRoom?getSelectedComposition(currentRoom):null;
  const settings=currentRoom?getSelectedSettings(currentRoom):null;
  socket.emit("startGame",{composition,settings},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible de lancer",true);
    playClickSound("success"); setStatus("Partie lancée");
  });
}
window.doStartGame=doStartGame;

function doResumeSession() {
  if(!myPlayerToken) { updateResumeUI(false); return setStatus("Aucune session à reprendre",true); }
  socket.emit("resumeSession",{playerToken:myPlayerToken},(res)=>{
    if(!res?.ok) { clearSession(); resetUI(); return setStatus(res?.error||"Impossible de reprendre la session",true); }
    saveSession(res.playerId,res.playerToken,res.room.code);
    renderRoom(res.room);
    updateResumeUI(true); playClickSound("join"); setStatus("Reconnexion réussie");
  });
}

createBtn.addEventListener("click",()=>{
  const name=nameInput.value.trim();
  if(!name) return setStatus("Entre un pseudo",true);
  clearSession(); resetUI();
  socket.emit("createRoom",{name},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible de créer la room",true);
    saveSession(res.playerId,res.playerToken,res.room.code);
    renderRoom(res.room);
    updateResumeUI(true); playClickSound("success"); setStatus("Room créée");
  });
});

joinBtn.addEventListener("click",()=>{
  const name=nameInput.value.trim();
  const code=roomInput.value.trim().toUpperCase();
  if(!name||!code) return setStatus("Entre un pseudo et un code",true);
  const token=myRoomCode===code?myPlayerToken:null;
  socket.emit("joinRoom",{name,code,playerToken:token},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible de rejoindre la room",true);
    saveSession(res.playerId,res.playerToken,res.room.code);
    renderRoom(res.room);
    updateResumeUI(true); playClickSound("join"); setStatus("Room rejointe");
  });
});

resumeBtn?.addEventListener("click", doResumeSession);
startBtn.addEventListener("click", doStartGame);

restartBtn.addEventListener("click",()=>{
  const composition=currentRoom?getSelectedComposition(currentRoom):null;
  const settings=currentRoom?getSelectedSettings(currentRoom):null;
  socket.emit("restartGame",{composition,settings},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible de relancer",true);
    playClickSound("success"); setStatus("Nouvelle partie lancée");
  });
});

leaveBtn.addEventListener("click",()=>{
  socket.emit("leaveRoom",{},(()=>{
    resetUI(); validateStoredSession(); playClickSound("leave"); setStatus("Tu as quitté la partie.");
  }));
});

sendChatBtn.addEventListener("click",()=>{
  const text=normalizeSingleWordInput(chatInput.value);
  if(!text) return;
  socket.emit("sendTurnMessage",{text},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible d'envoyer",true);
    chatInput.value=""; sendChatBtn.disabled=true; playClickSound("success"); setStatus("Mot envoyé");
  });
});

confirmVoteBtn.addEventListener("click",()=>{
  if(!selectedVoteTargetId||voteAlreadySent) return;
  socket.emit("votePlayer",{targetId:selectedVoteTargetId},(res)=>{
    if(!res?.ok) return setStatus(res?.error||"Impossible de voter",true);
    voteAlreadySent=true; confirmVoteBtn.disabled=true;
    selectedVoteText.textContent=`Vote confirmé contre ${selectedVoteTargetName}.`;
    playClickSound("vote"); setStatus("Vote envoyé",true);
  });
});

chatInput.addEventListener("input",()=>{
  const v=normalizeSingleWordInput(chatInput.value);
  if(chatInput.value!==v) chatInput.value=v;
  const isMyTurn=currentRoom&&currentRoom.phase==="speaking"&&currentRoom.currentSpeakerId===myPlayerId&&!currentRoom.gameOver;
  sendChatBtn.disabled=!isMyTurn||!v;
});
chatInput.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!sendChatBtn.disabled) sendChatBtn.click(); });

if(undercoverCountInput) undercoverCountInput.addEventListener("input",()=>{ if(currentRoom) renderComposition(currentRoom); });
if(mrWhiteCountInput)    mrWhiteCountInput.addEventListener("input",()=>{ if(currentRoom) renderComposition(currentRoom); });
if(turnDurationInput)    turnDurationInput.addEventListener("input",()=>{ turnDurationInput.value=String(clampSeconds(turnDurationInput.value,30)); if(currentRoom) renderComposition(currentRoom); });
if(voteDurationInput)    voteDurationInput.addEventListener("input",()=>{ voteDurationInput.value=String(clampSeconds(voteDurationInput.value,30)); if(currentRoom) renderComposition(currentRoom); });
if(categorySelect)       categorySelect.addEventListener("change",()=>{ if(!currentRoom) return; populateSubcategorySelect(currentRoom,categorySelect.value); renderComposition(currentRoom); });
if(subcategorySelect)    subcategorySelect.addEventListener("change",()=>{ if(currentRoom) renderComposition(currentRoom); });

// ─── SOCKET EVENTS ───────────────────────────────────────
socket.on("roomUpdated",(room)=>{
  if(room.phase!=="voting") resetVoteSelection();
  renderRoom(room);
});

socket.on("gameStarted",({word})=>{
  secretCard.classList.remove("hidden");
  endCard.classList.add("hidden");
  // FIX : réinitialiser le gameId quand une nouvelle partie commence
  if(endCard) endCard.dataset.renderedGameId="";
  waitingCard.classList.add("hidden");
  resetVoteSelection();
  wordText.textContent=word||"Tu n'as pas de mot.";
  playClickSound("success"); setStatus("La partie commence");
  mobileActiveTab="mob-word";
  if(isMobile()&&currentRoom) buildMobileTabs(currentRoom);
});

socket.on("sessionResumed",({word})=>{
  secretCard.classList.remove("hidden");
  wordText.textContent=word||"Tu n'as pas de mot.";
});

socket.on("voteResult",(result)=>{
  resetVoteSelection();
  if(result.tie) setStatus("Égalité : personne n'est éliminé.",true);
  else setStatus(`${result.eliminated.name} est éliminé (${result.eliminated.role}).`,true);
  playClickSound("vote");
});

// ─── INIT ────────────────────────────────────────────────
window.addEventListener("load",()=>{
  const intro=document.getElementById("introOverlay");
  const scene=document.getElementById("introScene");
  if(!intro||!scene) { initMobileTabs(); return; }
  setTimeout(()=>{
    scene.classList.add("intro-hidden");
    setTimeout(()=>{ intro.remove(); initMobileTabs(); },900);
  },2300);
});

function initAds() {
  document.querySelectorAll("[data-close-ad]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const ad=document.querySelector(`[data-ad="${btn.dataset.closeAd}"]`);
      if(!ad) return; ad.classList.add("hidden");
      localStorage.setItem(`adClosed:${btn.dataset.closeAd}`,"1");
    });
  });
  document.querySelectorAll("[data-ad]").forEach(ad=>{
    if(localStorage.getItem(`adClosed:${ad.dataset.ad}`)==="1") ad.classList.add("hidden");
  });
}

window.addEventListener("resize",()=>{
  if(!currentRoom) return;
  if(isMobile()) buildMobileTabs(currentRoom);
  else {
    const tabBar=document.getElementById("mobileTabBar");
    const mobArea=document.getElementById("mobileArea");
    if(tabBar) tabBar.style.display="none";
    if(mobArea) mobArea.style.display="none";
  }
});

attachUiSounds();
initAds();
initTopRoomCopy();
validateStoredSession();