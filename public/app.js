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
let mobileGameActivePanel = "chatCard";

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const resumeBlock = document.getElementById("resumeBlock");
const resumeBtn = document.getElementById("resumeBtn");
const resumeSeparator = document.getElementById("resumeSeparator");

const statusBanner = document.getElementById("statusBanner");
const topRoomInfo = document.getElementById("topRoomInfo");
const topHostInfo = document.getElementById("topHostInfo");
// AJOUT : bouton reprendre dans la topbar
const topResumeBtn = document.getElementById("topResumeBtn");

const startWrap = document.getElementById("startWrap");
const roomSetupCard = document.getElementById("roomSetupCard");
const leaveWrap = document.getElementById("leaveWrap");
const leaveBtn = document.getElementById("leaveBtn");

const lobby = document.getElementById("lobby");
const phaseInfo = document.getElementById("phaseInfo");
const speakerInfo = document.getElementById("speakerInfo");
const playersList = document.getElementById("playersList");

const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
// AJOUT : boutons lancer dans les cards mobiles
const startBtnMobile = document.getElementById("startBtnMobile");
const startBtnConfig = document.getElementById("startBtnConfig");

const secretCard = document.getElementById("secretCard");
const wordText = document.getElementById("wordText");

const compositionCard = document.getElementById("compositionCard");
const compositionHelp = document.getElementById("compositionHelp");
const compositionSummary = document.getElementById("compositionSummary");
const undercoverCountInput = document.getElementById("undercoverCountInput");
const mrWhiteCountInput = document.getElementById("mrWhiteCountInput");
const turnDurationInput = document.getElementById("turnDurationInput");
const voteDurationInput = document.getElementById("voteDurationInput");
const categorySelect = document.getElementById("categorySelect");
const subcategorySelect = document.getElementById("subcategorySelect");

const chatCard = document.getElementById("chatCard");
const messagesList = document.getElementById("messagesList");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatHelp = document.getElementById("chatHelp");
const roleDolls = document.getElementById("roleDolls");
const waitingRoleDolls = document.getElementById("waitingRoleDolls");

const waitingCard = document.getElementById("waitingCard");
const waitingText = document.getElementById("waitingText");
const waitingCategory = document.getElementById("waitingCategory");
const waitingSubcategory = document.getElementById("waitingSubcategory");
const waitingTurnDuration = document.getElementById("waitingTurnDuration");
const waitingVoteDuration = document.getElementById("waitingVoteDuration");

const voteCard = document.getElementById("voteCard");
const voteButtons = document.getElementById("voteButtons");
const selectedVoteText = document.getElementById("selectedVoteText");
const confirmVoteBtn = document.getElementById("confirmVoteBtn");

const endCard = document.getElementById("endCard");
const endTitle = document.getElementById("endTitle");
const winnerText = document.getElementById("winnerText");
const revealList = document.getElementById("revealList");

const timerFill = document.getElementById("timerFill");
const timerText = document.getElementById("timerText");

let audioCtx = null;

function initMobileTabs() {
  const mobileTabs = document.getElementById("mobileTabs");
  const tabButtons = document.querySelectorAll(".mobile-tab-btn");
  const loginCard = document.getElementById("roomSetupCard");
  const rulesCard = document.getElementById("rulesCard");

  if (!mobileTabs || !loginCard || !rulesCard) return;

  const applyMobileTabsLayout = () => {
    const isMobile = window.innerWidth <= 820;

    if (isMobile) {
      mobileTabs.classList.remove("hidden");

      const activeBtn =
        mobileTabs.querySelector(".mobile-tab-btn.active") ||
        mobileTabs.querySelector('[data-tab="login"]');

      tabButtons.forEach((btn) => btn.classList.remove("active"));

      if (activeBtn) {
        activeBtn.classList.add("active");
        const tabName = activeBtn.getAttribute("data-tab");

        if (tabName === "rules") {
          loginCard.classList.add("hidden-tab");
          rulesCard.classList.add("active");
        } else {
          loginCard.classList.remove("hidden-tab");
          rulesCard.classList.remove("active");
        }
      } else {
        loginCard.classList.remove("hidden-tab");
        rulesCard.classList.remove("active");
      }
    } else {
      mobileTabs.classList.add("hidden");
      loginCard.classList.remove("hidden-tab");
      rulesCard.classList.remove("active");
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      const loginBtn = mobileTabs.querySelector('[data-tab="login"]');
      if (loginBtn) loginBtn.classList.add("active");
    }
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.getAttribute("data-tab");

      tabButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      if (tabName === "login") {
        loginCard.classList.remove("hidden-tab");
        rulesCard.classList.remove("active");
      } else if (tabName === "rules") {
        loginCard.classList.add("hidden-tab");
        rulesCard.classList.add("active");
      }
    });
  });

  applyMobileTabsLayout();
  window.addEventListener("resize", applyMobileTabsLayout);
}

window.addEventListener("load", () => {
  const intro = document.getElementById("introOverlay");
  const scene = document.getElementById("introScene");

  if (!intro || !scene) {
    initMobileTabs();
    return;
  }

  setTimeout(() => {
    scene.classList.add("intro-hidden");
    setTimeout(() => {
      intro.remove();
      initMobileTabs();
    }, 900);
  }, 2300);
});

function ensureAudio() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function playTone({ type = "triangle", from = 440, to = 660, duration = 0.08, gain = 0.05 } = {}) {
  ensureAudio();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = type;
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.frequency.setValueAtTime(from, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 0.001), now + duration);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.01);
}

function playClickSound(type = "default") {
  if (type === "soft") {
    playTone({ type: "sine", from: 520, to: 760, duration: 0.05, gain: 0.035 });
    return;
  }
  if (type === "success") {
    playTone({ type: "triangle", from: 660, to: 980, duration: 0.09, gain: 0.05 });
    return;
  }
  if (type === "join") {
    playTone({ type: "triangle", from: 520, to: 840, duration: 0.1, gain: 0.05 });
    return;
  }
  if (type === "leave") {
    playTone({ type: "sawtooth", from: 420, to: 220, duration: 0.1, gain: 0.04 });
    return;
  }
  if (type === "vote") {
    playTone({ type: "square", from: 500, to: 680, duration: 0.07, gain: 0.035 });
    return;
  }
  if (type === "tension") {
    playTone({ type: "square", from: 780, to: 840, duration: 0.06, gain: 0.028 });
    return;
  }
  if (type === "reveal") {
    playTone({ type: "triangle", from: 340, to: 720, duration: 0.16, gain: 0.045 });
    return;
  }
  playTone({ type: "triangle", from: 420, to: 620, duration: 0.04, gain: 0.04 });
}

function attachUiSounds() {
  document.addEventListener("pointerdown", (e) => {
    const target = e.target;
    if (!target) return;
    if (target.closest("button")) {
      playClickSound("default");
      return;
    }
    if (target.closest("select") || target.closest("input")) {
      playClickSound("soft");
    }
  }, { passive: true });
}

function setStatus(message, important = false) {
  statusBanner.textContent = message;
  statusBanner.classList.remove("hidden");
  statusBanner.classList.toggle("important", important);
  clearTimeout(setStatus._timer);
  setStatus._timer = setTimeout(() => {
    statusBanner.classList.add("hidden");
    statusBanner.classList.remove("important");
  }, important ? 2200 : 1600);
}

function copyText(text, onSuccess) {
  if (!text) return;
  const done = () => { if (typeof onSuccess === "function") onSuccess(); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el); done();
    });
    return;
  }
  const el = document.createElement("textarea");
  el.value = text; document.body.appendChild(el); el.select();
  document.execCommand("copy"); document.body.removeChild(el); done();
}

function initTopRoomCopy() {
  if (!topRoomInfo) return;
  topRoomInfo.style.cursor = "pointer";
  topRoomInfo.title = "Cliquer pour copier le code";
  topRoomInfo.addEventListener("click", () => {
    if (!currentRoom?.code) return;
    copyText(currentRoom.code, () => {
      topRoomInfo.classList.add("copied");
      setStatus(`Code ${currentRoom.code} copié`);
      setTimeout(() => topRoomInfo.classList.remove("copied"), 1200);
    });
  });
}

function saveSession(playerId, playerToken, roomCode) {
  myPlayerId = playerId;
  window.myPlayerId = playerId;
  myPlayerToken = playerToken;
  myRoomCode = roomCode || myRoomCode;
  localStorage.setItem("playerId", playerId);
  localStorage.setItem("playerToken", playerToken);
  if (myRoomCode) localStorage.setItem("roomCode", myRoomCode);
}

function clearSession() {
  myPlayerId = null; myPlayerToken = null; myRoomCode = null;
  localStorage.removeItem("playerId");
  localStorage.removeItem("playerToken");
  localStorage.removeItem("roomCode");
}

function updateResumeUI(canResume = false) {
  resumeBlock.classList.toggle("hidden", !canResume);
  resumeSeparator.classList.toggle("hidden", !canResume);
  if (resumeBtn && canResume && myRoomCode) {
    resumeBtn.textContent = `Reprendre ma partie (${myRoomCode})`;
  }
  // AJOUT : bouton reprendre dans topbar (visible quand on est sur l'écran d'accueil avec session existante)
  if (topResumeBtn) {
    topResumeBtn.classList.toggle("hidden", !canResume);
    if (canResume && myRoomCode) {
      topResumeBtn.textContent = `↩ ${myRoomCode}`;
    }
  }
}

function validateStoredSession() {
  if (!myPlayerToken || !myRoomCode) { updateResumeUI(false); return; }
  socket.emit("checkSession", { playerToken: myPlayerToken, roomCode: myRoomCode }, (res) => {
    if (!res?.ok) { clearSession(); updateResumeUI(false); return; }
    updateResumeUI(true);
  });
}

function normalizeSingleWordInput(value) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned.split(" ")[0].slice(0, 24);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerFill.style.width = "0%";
  timerText.textContent = "--";
  timerFill.style.background = "#22c55e";
  lastTensionSecondPlayed = null;
}

function resetVoteSelection() {
  selectedVoteTargetId = null; selectedVoteTargetName = null; voteAlreadySent = false;
  selectedVoteText.textContent = "Aucun joueur sélectionné.";
  confirmVoteBtn.disabled = true;
}

function resetUI() {
  currentRoom = null; window.currentRoom = null;
  currentTurnKey = null; autoSubmittedTurnKey = null;
  previousVisiblePlayerIds = []; lastTensionSecondPlayed = null;
  mobileGameActivePanel = "chatCard";

  lobby.classList.add("hidden");
  secretCard.classList.add("hidden");
  if (compositionCard) compositionCard.classList.add("hidden");
  chatCard.classList.add("hidden");
  waitingCard.classList.add("hidden");
  voteCard.classList.add("hidden");
  endCard.classList.add("hidden");
  leaveWrap.classList.add("hidden");
  startWrap.classList.remove("hidden");
  roomSetupCard.classList.remove("hidden");

  // AJOUT : cacher les nouvelles cards mobiles
  const playersCompoCard = document.getElementById("playersCompoCard");
  if (playersCompoCard) playersCompoCard.classList.add("hidden");
  const waitingPlayersTab = document.getElementById("waitingPlayersTab");
  if (waitingPlayersTab) waitingPlayersTab.classList.add("hidden");

  topRoomInfo.classList.add("hidden");
  topHostInfo.classList.add("hidden");
  const _codeSpan = document.getElementById("topRoomCode");
  if (_codeSpan) _codeSpan.textContent = "";
  topHostInfo.textContent = "";
  topRoomInfo.classList.remove("clickable-room", "copied");

  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  voteButtons.innerHTML = "";
  revealList.innerHTML = "";
  if (roleDolls) roleDolls.innerHTML = "";
  if (waitingRoleDolls) waitingRoleDolls.innerHTML = "";

  phaseInfo.textContent = ""; speakerInfo.textContent = "";
  wordText.textContent = ""; winnerText.textContent = "";
  if (compositionHelp) compositionHelp.textContent = "";
  if (compositionSummary) compositionSummary.textContent = "";
  if (waitingCategory) waitingCategory.textContent = "--";
  if (waitingSubcategory) waitingSubcategory.textContent = "--";
  if (waitingTurnDuration) waitingTurnDuration.textContent = "--";
  if (waitingVoteDuration) waitingVoteDuration.textContent = "--";
  chatInput.value = "";
  if (categorySelect) categorySelect.innerHTML = "";
  if (subcategorySelect) subcategorySelect.innerHTML = "";
  endCard.dataset.renderedRound = "";
  endCard.dataset.renderedWinner = "";

  resetVoteSelection();
  stopTimer();
  updateMobileGamePanels();
  validateStoredSession();
}

function hideGameplayButtons() {
  startBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
  if (startBtnMobile) startBtnMobile.classList.add("hidden");
  if (startBtnConfig) startBtnConfig.classList.add("hidden");
}

function sortPlayersForDisplay(room) {
  if (!room.started || !Array.isArray(room.speakingOrder) || room.speakingOrder.length === 0) {
    return [...room.players];
  }
  const indexMap = new Map(room.speakingOrder.map((id, index) => [id, index]));
  return [...room.players].sort((a, b) => {
    const ia = indexMap.has(a.id) ? indexMap.get(a.id) : Number.MAX_SAFE_INTEGER;
    const ib = indexMap.has(b.id) ? indexMap.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
}

function renderPlayers(room) {
  playersList.innerHTML = "";
  const orderedPlayers = sortPlayersForDisplay(room);
  orderedPlayers.forEach((player) => {
    const li = document.createElement("li");
    if (player.eliminated) li.classList.add("player-dead");
    if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) li.classList.add("player-current");
    const nameLine = document.createElement("span");
    nameLine.className = "player-name";
    let mainLabel = player.name;
    if (player.id === myPlayerId) mainLabel += " (toi)";
    if (player.id === room.hostPlayerId) mainLabel += " 👑";
    nameLine.textContent = mainLabel;
    li.appendChild(nameLine);
    const subParts = [];
    if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) subParts.push("réfléchit");
    if (player.eliminated) subParts.push("éliminé");
    if (subParts.length > 0) {
      const subLine = document.createElement("span");
      subLine.className = "player-sub";
      subLine.textContent = subParts.join(" • ");
      li.appendChild(subLine);
    }
    playersList.appendChild(li);
  });
}

// AJOUT : render la liste des joueurs dans le panel mobile dédié (pendant la partie)
function renderPlayersMobile(room) {
  const list = document.getElementById("playersListMobile");
  if (!list) return;
  list.innerHTML = "";
  const orderedPlayers = sortPlayersForDisplay(room);
  orderedPlayers.forEach((player) => {
    const li = document.createElement("li");
    li.className = "players-list-mobile-item";
    if (player.eliminated) li.classList.add("player-dead");
    if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) li.classList.add("player-current");
    let label = player.name;
    if (player.id === myPlayerId) label += " (toi)";
    if (player.id === room.hostPlayerId) label += " 👑";
    if (player.eliminated) label += " — éliminé";
    else if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) label += " — réfléchit";
    li.textContent = label;
    list.appendChild(li);
  });
}

// AJOUT : render la liste des joueurs dans l'onglet d'attente mobile (lobby hôte)
function renderWaitingPlayersMobile(room) {
  const list = document.getElementById("waitingPlayersListMobile");
  if (!list) return;
  list.innerHTML = "";
  room.players.forEach((player) => {
    const li = document.createElement("li");
    li.className = "players-list-mobile-item";
    let label = player.name;
    if (player.id === myPlayerId) label += " (toi)";
    if (player.id === room.hostPlayerId) label += " 👑";
    if (!player.connected) label += " — déconnecté";
    li.textContent = label;
    list.appendChild(li);
  });

  // Mettre à jour les infos de config dans l'onglet Joueurs
  const catEl = document.getElementById("waitingCategoryMobile");
  const subcatEl = document.getElementById("waitingSubcategoryMobile");
  const turnEl = document.getElementById("waitingTurnMobile");
  const voteEl = document.getElementById("waitingVoteMobile");
  if (catEl) catEl.textContent = room.selectedCategory || "--";
  if (subcatEl) subcatEl.textContent = room.selectedSubcategory || "--";
  if (turnEl) turnEl.textContent = `${room.turnDurationSeconds || 30} s`;
  if (voteEl) voteEl.textContent = `${room.voteDurationSeconds || 30} s`;

  // Bouton lancer dans l'onglet Joueurs (hôte)
  const btn = document.getElementById("startBtnMobile");
  if (btn) {
    const isHost = room.hostPlayerId === myPlayerId;
    btn.classList.toggle("hidden", !(!room.started && isHost));
  }

  // Bonhommes dans l'onglet Joueurs
  const dollsEl = document.getElementById("waitingRoleDollsMobile");
  if (dollsEl) fillRoleDolls(dollsEl, room);
}

function fillRoleDolls(container, room) {
  if (!container) return;
  container.innerHTML = "";
  const composition = room.roleComposition || {};
  const dolls = [];
  for (let i = 0; i < (composition.civil || 0); i++) dolls.push("civil");
  for (let i = 0; i < (composition.undercover || 0); i++) dolls.push("undercover");
  for (let i = 0; i < (composition.mrwhite || 0); i++) dolls.push("mrwhite");
  dolls.forEach((role) => {
    const doll = document.createElement("div");
    doll.className = `role-doll ${role}`;
    const head = document.createElement("div"); head.className = "role-doll-head";
    const body = document.createElement("div"); body.className = "role-doll-body";
    doll.appendChild(head); doll.appendChild(body); container.appendChild(doll);
  });
}

function renderRoleDolls(room) {
  fillRoleDolls(roleDolls, room);
  fillRoleDolls(waitingRoleDolls, room);

  // AJOUT : bonhommes dans l'onglet joueurs pendant la partie (mobile)
  const mobileDolls = document.getElementById("roleDollsMobile");
  if (mobileDolls) fillRoleDolls(mobileDolls, room);

  const mobile = window.innerWidth <= 820;
  const configDolls = document.getElementById("roleDollsConfig");
  const configWrap = document.getElementById("roleDollsConfigWrap");
  if (configDolls && configWrap) {
    if (mobile) {
      configWrap.style.display = "";
      fillRoleDolls(configDolls, room);
    } else {
      configWrap.style.display = "none";
    }
  }
}

function renderMessages(room) {
  messagesList.innerHTML = "";
  const messages = room.messages || [];
  messages.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "message";
    if (!msg.playerId) div.classList.add("system");
    const nameSpan = document.createElement("span");
    nameSpan.className = "message-name"; nameSpan.textContent = `${msg.playerName}`;
    const textSpan = document.createElement("span");
    textSpan.className = "message-text"; textSpan.textContent = msg.text;
    div.appendChild(nameSpan); div.appendChild(textSpan);
    messagesList.appendChild(div);
  });
  messagesList.scrollTop = messagesList.scrollHeight;
}

function renderChat(room) {
  if (!room.started || room.gameOver) { chatCard.classList.add("hidden"); return; }
  chatCard.classList.remove("hidden");
  renderRoleDolls(room);
  renderMessages(room);
  const me = room.players.find((p) => p.id === myPlayerId);
  const isMyTurn = room.phase === "speaking" && room.currentSpeakerId === myPlayerId && me && !me.eliminated;
  chatInput.disabled = !isMyTurn;
  sendChatBtn.disabled = !isMyTurn || !normalizeSingleWordInput(chatInput.value);
  if (room.phase === "voting") chatHelp.textContent = "Vote en cours.";
  else if (isMyTurn) chatHelp.textContent = "Entre un seul mot. Tu ne peux pas écrire ton mot secret.";
  else chatHelp.textContent = "Ce n'est pas ton tour. Tu peux lire.";
}

function renderWaitingRoom(room) {
  const isHost = room.hostPlayerId === myPlayerId;
  const shouldShow = !room.started && !room.gameOver && !isHost;
  waitingCard.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  renderRoleDolls(room);
  waitingText.textContent = "En attente du lancement de la partie par l'hôte…";
  waitingCategory.textContent = room.selectedCategory || "--";
  waitingSubcategory.textContent = room.selectedSubcategory || "--";
  waitingTurnDuration.textContent = `${room.turnDurationSeconds || 30} s`;
  waitingVoteDuration.textContent = `${room.voteDurationSeconds || 30} s`;
}

function renderVoteButtons(room) {
  voteButtons.innerHTML = "";
  const me = room.players.find((p) => p.id === myPlayerId);
  if (!me || me.eliminated || room.phase !== "voting" || room.gameOver) {
    voteCard.classList.add("hidden"); resetVoteSelection(); return;
  }
  voteCard.classList.remove("hidden");
  room.players.filter((p) => !p.eliminated && p.id !== myPlayerId).forEach((player) => {
    const btn = document.createElement("button");
    btn.className = "vote-btn"; btn.textContent = `Choisir ${player.name}`;
    if (selectedVoteTargetId === player.id) btn.classList.add("vote-btn-selected");
    btn.onclick = () => {
      if (voteAlreadySent) return;
      selectedVoteTargetId = player.id; selectedVoteTargetName = player.name;
      selectedVoteText.textContent = `Cible sélectionnée : ${player.name}`;
      confirmVoteBtn.disabled = false;
      renderVoteButtons(room);
    };
    voteButtons.appendChild(btn);
  });
  if (voteAlreadySent) {
    confirmVoteBtn.disabled = true;
    selectedVoteText.textContent = `Vote confirmé contre ${selectedVoteTargetName}.`;
  }
}

function getMyOutcome(room) {
  if (!room.gameOver || !room.reveal) return null;
  if (room.winner === "aucun") return "Partie arrêtée";
  const me = room.reveal.find((p) => p.id === myPlayerId);
  if (!me) return null;
  if (room.winner === "civils" && me.role === "civil") return "Victoire";
  if (room.winner === "undercover" && me.role === "undercover") return "Victoire";
  if (room.winner === "mrwhite" && me.role === "mrwhite") return "Victoire";
  return "Défaite";
}

function renderEndGame(room) {
  if (!room.gameOver) { endCard.classList.add("hidden"); return; }
  const alreadyRendered = endCard.dataset.renderedRound === String(room.round) && endCard.dataset.renderedWinner === String(room.winner);
  endCard.classList.remove("hidden");
  const outcome = getMyOutcome(room) || "Fin de partie";
  endTitle.textContent = outcome;
  winnerText.textContent = room.winner === "aucun"
    ? "La partie a été interrompue : aucun indice n'a été donné pendant la manche."
    : `Équipe gagnante : ${room.winner}`;
  if (!alreadyRendered) {
    revealList.innerHTML = "";
    room.reveal.forEach((player, index) => {
      const li = document.createElement("li");
      li.className = "reveal-item"; li.style.animationDelay = `${index * 120}ms`;
      const badge = document.createElement("span");
      badge.className = `reveal-role-badge ${player.role}`; badge.textContent = player.role;
      const text = document.createElement("span");
      text.className = "reveal-main-text";
      text.textContent = `${player.name}` + `${player.word ? ` • ${player.word}` : " • aucun mot"}`;
      li.appendChild(badge); li.appendChild(text); revealList.appendChild(li);
    });
    endCard.dataset.renderedRound = String(room.round);
    endCard.dataset.renderedWinner = String(room.winner);
    playClickSound("reveal");
  }
}

function renderTimer(room) {
  stopTimer();
  let endAt = null, total = null;
  if (room.phase === "speaking" && room.turnEndsAt) { endAt = room.turnEndsAt; total = room.turnDurationMs || 30000; }
  else if (room.phase === "voting" && room.voteEndsAt) { endAt = room.voteEndsAt; total = room.voteDurationMs || 30000; }
  else return;
  const tick = () => {
    const remaining = Math.max(0, endAt - Date.now());
    const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
    const secondsLeft = Math.ceil(remaining / 1000);
    timerFill.style.width = `${percent}%`;
    timerText.textContent = `${secondsLeft} s`;
    if (remaining <= 7000) timerFill.style.background = "#f59e0b";
    else timerFill.style.background = "#22c55e";
    if (remaining <= 3000) timerFill.style.background = "#ef4444";
    if (secondsLeft <= 5 && secondsLeft > 0 && lastTensionSecondPlayed !== secondsLeft) {
      lastTensionSecondPlayed = secondsLeft; playClickSound("tension");
    }
    const isMyTurn = room.phase === "speaking" && room.currentSpeakerId === myPlayerId && !room.gameOver;
    if (isMyTurn && remaining <= 250 && currentTurnKey && autoSubmittedTurnKey !== currentTurnKey) {
      const word = normalizeSingleWordInput(chatInput.value);
      if (word && !sendChatBtn.disabled) { autoSubmittedTurnKey = currentTurnKey; sendChatBtn.click(); }
    }
    if (remaining <= 0) stopTimer();
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function clampCompositionValues(room) {
  if (!undercoverCountInput || !mrWhiteCountInput) {
    return { undercoverCount: 1, mrwhiteCount: 0, civilCount: room.players.length - 1 };
  }
  const playerCount = room.players.length;
  if (playerCount <= 3) {
    undercoverCountInput.value = "1"; mrWhiteCountInput.value = "0";
    return { undercoverCount: 1, mrwhiteCount: 0, civilCount: 2 };
  }
  let undercoverCount = Number.parseInt(undercoverCountInput.value, 10);
  let mrwhiteCount = Number.parseInt(mrWhiteCountInput.value, 10);
  if (!Number.isInteger(undercoverCount)) undercoverCount = 1;
  if (!Number.isInteger(mrwhiteCount)) mrwhiteCount = 0;
  mrwhiteCount = Math.max(0, Math.min(1, mrwhiteCount));
  undercoverCount = Math.max(1, undercoverCount);
  const maxUndercover = Math.max(1, playerCount - mrwhiteCount - 1);
  undercoverCount = Math.min(undercoverCount, maxUndercover);
  let civilCount = playerCount - undercoverCount - mrwhiteCount;
  if (civilCount < 1) {
    undercoverCount = Math.max(1, playerCount - mrwhiteCount - 1);
    civilCount = playerCount - undercoverCount - mrwhiteCount;
  }
  undercoverCountInput.value = String(undercoverCount);
  mrWhiteCountInput.value = String(mrwhiteCount);
  return { undercoverCount, mrwhiteCount, civilCount };
}

function clampSeconds(value, fallback = 30) {
  let n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) n = fallback;
  return Math.max(15, Math.min(45, n));
}

function populateCategorySelect(room) {
  if (!categorySelect || !subcategorySelect) return;
  const options = Array.isArray(room.categoryOptions) ? room.categoryOptions : [];
  const currentValue = categorySelect.value;
  const selectedCategory = options.find(opt => opt.name === currentValue)?.name || room.selectedCategory || options[0]?.name || "";
  categorySelect.innerHTML = "";
  options.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name; option.textContent = category.name;
    option.selected = category.name === selectedCategory;
    categorySelect.appendChild(option);
  });
  populateSubcategorySelect(room, selectedCategory, subcategorySelect.value || room.selectedSubcategory);
}

function populateSubcategorySelect(room, categoryName, preferredSubcategory = null) {
  if (!subcategorySelect) return;
  const options = Array.isArray(room.categoryOptions) ? room.categoryOptions : [];
  const category = options.find((item) => item.name === categoryName) || options[0];
  const subcategories = category?.subcategories || [];
  const selectedSubcategory =
    preferredSubcategory && subcategories.includes(preferredSubcategory) ? preferredSubcategory :
    room.selectedSubcategory && subcategories.includes(room.selectedSubcategory) ? room.selectedSubcategory :
    subcategories[0] || "";
  subcategorySelect.innerHTML = "";
  subcategories.forEach((name) => {
    const option = document.createElement("option");
    option.value = name; option.textContent = name;
    option.selected = name === selectedSubcategory;
    subcategorySelect.appendChild(option);
  });
}

function getSelectedComposition(room) {
  const values = clampCompositionValues(room);
  return { undercoverCount: values.undercoverCount, mrwhiteCount: values.mrwhiteCount };
}

function getSelectedSettings(room) {
  const turnDurationSeconds = clampSeconds(turnDurationInput?.value, room?.turnDurationSeconds || 30);
  const voteDurationSeconds = clampSeconds(voteDurationInput?.value, room?.voteDurationSeconds || 30);
  if (turnDurationInput) turnDurationInput.value = String(turnDurationSeconds);
  if (voteDurationInput) voteDurationInput.value = String(voteDurationSeconds);
  return {
    turnDurationSeconds, voteDurationSeconds,
    category: categorySelect?.value || room?.selectedCategory || null,
    subcategory: subcategorySelect?.value || room?.selectedSubcategory || null
  };
}

function renderComposition(room) {
  if (!compositionCard || !compositionHelp || !compositionSummary ||
      !undercoverCountInput || !mrWhiteCountInput || !turnDurationInput ||
      !voteDurationInput || !categorySelect || !subcategorySelect) return;
  const isHost = room.hostPlayerId === myPlayerId;
  const canConfigure = !room.started && !room.gameOver && isHost;
  if (!canConfigure) { compositionCard.classList.add("hidden"); return; }
  compositionCard.classList.remove("hidden");
  const playerCount = room.players.length;
  if (turnDurationInput !== document.activeElement) turnDurationInput.value = String(clampSeconds(turnDurationInput.value, room.turnDurationSeconds || 30));
  if (voteDurationInput !== document.activeElement) voteDurationInput.value = String(clampSeconds(voteDurationInput.value, room.voteDurationSeconds || 30));
  populateCategorySelect(room);
  if (playerCount <= 3) {
    undercoverCountInput.disabled = true; mrWhiteCountInput.disabled = true;
    undercoverCountInput.value = "1"; mrWhiteCountInput.value = "0";
    compositionHelp.textContent = "À 3 joueurs : composition fixe. L'hôte peut aussi choisir la durée et la catégorie.";
  } else {
    undercoverCountInput.disabled = false; mrWhiteCountInput.disabled = false;
    undercoverCountInput.min = "1"; undercoverCountInput.max = String(playerCount - 1);
    mrWhiteCountInput.min = "0"; mrWhiteCountInput.max = "1";
    compositionHelp.textContent = "L'hôte choisit la composition, les durées et la catégorie.";
  }
  const values = clampCompositionValues(room);
  const settings = getSelectedSettings(room);
  compositionSummary.textContent =
    `${values.civilCount} civil(s) • ${values.undercoverCount} undercover(s)` +
    `${values.mrwhiteCount ? " • 1 Mr White" : ""}` +
    ` • Tours ${settings.turnDurationSeconds}s • Vote ${settings.voteDurationSeconds}s` +
    ` • ${settings.category || "--"} / ${settings.subcategory || "--"}`;

  // AJOUT : bouton Lancer dans l'onglet Config mobile
  if (startBtnConfig) startBtnConfig.classList.remove("hidden");
}

window.renderComposition = renderComposition;

function handlePresenceSounds(room) {
  const currentIds = (room.players || []).map((p) => p.id);
  if (!previousVisiblePlayerIds.length) { previousVisiblePlayerIds = currentIds; return; }
  const joined = currentIds.filter((id) => !previousVisiblePlayerIds.includes(id));
  const left = previousVisiblePlayerIds.filter((id) => !currentIds.includes(id));
  if (joined.length > 0) playClickSound("join");
  else if (left.length > 0) playClickSound("leave");
  previousVisiblePlayerIds = currentIds;
}

// AJOUT : liste complète des panels possibles (incluant les nouveaux)
const ALL_MOBILE_PANELS = ["secretCard", "chatCard", "playersCompoCard", "voteCard", "waitingPlayersTab", "compositionCard"];

function updateMobileGamePanels() {
  const isMobile = window.innerWidth <= 820;
  const tabs = document.getElementById("mobileGameTabs");
  if (!tabs) {
    if (typeof window.updateMobileUI === "function") window.updateMobileUI(currentRoom);
    return;
  }

  const isHost = currentRoom?.hostPlayerId === myPlayerId;
  const isLobby = currentRoom && !currentRoom.started && !currentRoom.gameOver;
  const isPlaying = currentRoom?.started && !currentRoom?.gameOver;
  const isVoting = currentRoom?.phase === "voting" && !currentRoom?.gameOver;

  // Panels disponibles selon le contexte
  // En lobby hôte : waitingPlayersTab + compositionCard
  // En jeu : secretCard + chatCard + playersCompoCard + voteCard
  // Fin de partie : chatCard uniquement
  let availablePanels = [];
  if (isLobby && isHost) {
    availablePanels = ["waitingPlayersTab", "compositionCard"];
  } else if (isPlaying) {
    availablePanels = ["secretCard", "chatCard", "playersCompoCard", "voteCard"];
  } else {
    availablePanels = ["chatCard"];
  }

  // Panel par défaut selon contexte
  const defaultPanel =
    currentRoom?.gameOver ? "chatCard" :
    isVoting ? "voteCard" :
    isPlaying ? "chatCard" :
    isLobby && isHost ? "waitingPlayersTab" :
    "chatCard";

  if (!mobileGameActivePanel || !availablePanels.includes(mobileGameActivePanel)) {
    mobileGameActivePanel = defaultPanel;
  }

  if (!isMobile) {
    // Desktop : tout afficher, aucun panel mobile
    ALL_MOBILE_PANELS.forEach((id) => {
      const panel = document.getElementById(id);
      if (panel) panel.classList.remove("mobile-hidden-panel");
    });
    // Cacher les panels qui ne sont destinés qu'au mobile
    ["playersCompoCard", "waitingPlayersTab"].forEach((id) => {
      const panel = document.getElementById(id);
      if (panel) panel.classList.add("hidden");
    });
    return;
  }

  // Mobile : afficher uniquement le panel actif parmi les disponibles
  ALL_MOBILE_PANELS.forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const shouldShow = availablePanels.includes(id) && id === mobileGameActivePanel;
    panel.classList.toggle("mobile-hidden-panel", !shouldShow);
    if (availablePanels.includes(id)) {
      panel.classList.remove("hidden");
    } else {
      panel.classList.add("hidden");
    }
  });

  // Mettre à jour les onglets visibles et actifs
  tabs.querySelectorAll(".mobile-game-tab").forEach((btn) => {
    const panelId = btn.getAttribute("data-panel");
    const isAvailable = availablePanels.includes(panelId);
    const isActive = panelId === mobileGameActivePanel;
    btn.style.display = isAvailable ? "" : "none";
    btn.classList.toggle("active", isActive);
  });

  // Onglet Vote : état spécial
  const voteTab = tabs.querySelector('[data-panel="voteCard"]');
  if (voteTab) {
    voteTab.classList.toggle("vote-tab-active-phase", isVoting);
  }

  // voteNotReadyCard : afficher si on est sur l'onglet vote mais pas en phase vote
  const voteNotReady = document.getElementById("voteNotReadyCard");
  const voteCardInner = document.getElementById("voteCardInner");
  if (voteNotReady && voteCardInner) {
    const onVoteTab = mobileGameActivePanel === "voteCard";
    if (onVoteTab && !isVoting && isPlaying) {
      voteNotReady.style.display = "";
      voteCardInner.style.display = "none";
    } else {
      voteNotReady.style.display = "none";
      voteCardInner.style.display = "";
    }
  }
}

function initMobileGameTabs() {
  const tabs = document.getElementById("mobileGameTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".mobile-game-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      mobileGameActivePanel = btn.getAttribute("data-panel");
      updateMobileGamePanels();
    });
  });
  window.addEventListener("resize", updateMobileGamePanels);
}

window.setMobileGameActivePanel = (panelId) => {
  mobileGameActivePanel = panelId;
  updateMobileGamePanels();
};

function renderRoom(room) {
  handlePresenceSounds(room);
  currentRoom = room; window.currentRoom = room;
  myRoomCode = room.code;
  localStorage.setItem("roomCode", room.code);

  lobby.classList.remove("hidden");
  leaveWrap.classList.remove("hidden");
  startWrap.classList.add("hidden");

  // AJOUT : cacher le bouton topbar reprendre quand on est dans une room
  if (topResumeBtn) topResumeBtn.classList.add("hidden");

  const host = room.players.find((p) => p.id === room.hostPlayerId);

  const codeSpan = document.getElementById("topRoomCode");
  if (codeSpan) codeSpan.textContent = "Room " + room.code;
  topRoomInfo.classList.remove("hidden");
  topHostInfo.textContent = host ? `Hôte : ${host.name}` : "Pas d'hôte";
  topHostInfo.classList.remove("hidden");

  const nextTurnKey = `${room.code}-${room.phase}-${room.round}-${room.currentSpeakerId || "none"}`;
  if (currentTurnKey !== nextTurnKey) {
    currentTurnKey = nextTurnKey; autoSubmittedTurnKey = null; lastTensionSecondPlayed = null;
    if (!(room.phase === "speaking" && room.currentSpeakerId === myPlayerId)) chatInput.value = "";
  }

  if (!room.started) {
    phaseInfo.textContent = "Salon";
    speakerInfo.textContent = "La partie n'a pas encore commencé";
  } else {
    phaseInfo.textContent = `Manche ${room.round}`;
    const speaker = room.players.find((p) => p.id === room.currentSpeakerId);
    if (room.phase === "speaking" && speaker) speakerInfo.textContent = `${speaker.name} réfléchit`;
    else if (room.phase === "voting") speakerInfo.textContent = `Vote en cours (${room.voteCount}/${room.players.filter((p) => !p.eliminated).length})`;
    else speakerInfo.textContent = "";
  }

  renderPlayers(room);
  renderPlayersMobile(room);              // AJOUT
  renderWaitingPlayersMobile(room);       // AJOUT
  renderComposition(room);
  renderChat(room);
  renderWaitingRoom(room);
  renderTimer(room);
  hideGameplayButtons();

  const isHost = room.hostPlayerId === myPlayerId;
  if (!room.started && isHost) startBtn.classList.remove("hidden");
  if (room.gameOver && isHost) restartBtn.classList.remove("hidden");

  renderVoteButtons(room);
  renderEndGame(room);

  // Déterminer le bon panel actif selon la phase
  const isVoting = room.phase === "voting" && !room.gameOver;
  const isLobby = !room.started && !room.gameOver;
  const isPlaying = room.started && !room.gameOver;

  if (room.gameOver) {
    mobileGameActivePanel = "chatCard";
  } else if (isVoting) {
    mobileGameActivePanel = "voteCard";
  } else if (isPlaying) {
    // Ne pas forcer le changement si l'utilisateur a choisi un autre onglet
    if (!["chatCard", "secretCard", "playersCompoCard"].includes(mobileGameActivePanel)) {
      mobileGameActivePanel = "chatCard";
    }
  } else if (isLobby && isHost) {
    if (!["waitingPlayersTab", "compositionCard"].includes(mobileGameActivePanel)) {
      mobileGameActivePanel = "waitingPlayersTab";
    }
  } else {
    mobileGameActivePanel = "chatCard";
  }

  updateMobileGamePanels();
}

window.renderRoom = renderRoom;

function closeAd(adId) {
  const ad = document.querySelector(`[data-ad="${adId}"]`);
  if (!ad) return;
  ad.classList.add("hidden");
  localStorage.setItem(`adClosed:${adId}`, "1");
  ["leftAds", "rightAds"].forEach((columnId) => {
    const column = document.getElementById(columnId);
    if (!column) return;
    const visibleAds = [...column.querySelectorAll(".ad-slot:not(.hidden)")];
    if (visibleAds.length === 0) column.classList.add("hidden");
  });
}

function initAds() {
  document.querySelectorAll("[data-close-ad]").forEach((btn) => {
    btn.addEventListener("click", () => { closeAd(btn.dataset.closeAd); });
  });
  document.querySelectorAll("[data-ad]").forEach((ad) => {
    const adId = ad.dataset.ad;
    if (localStorage.getItem(`adClosed:${adId}`) === "1") ad.classList.add("hidden");
  });
  ["leftAds", "rightAds"].forEach((columnId) => {
    const column = document.getElementById(columnId);
    if (!column) return;
    const visibleAds = [...column.querySelectorAll(".ad-slot:not(.hidden)")];
    if (visibleAds.length === 0) column.classList.add("hidden");
  });
}

createBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) return setStatus("Entre un pseudo", true);
  clearSession(); resetUI();
  socket.emit("createRoom", { name }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de créer la room", true);
    saveSession(res.playerId, res.playerToken, res.room.code);
    renderRoom(res.room);
    if (typeof window.updateMobileUI === "function") window.updateMobileUI(res.room);
    updateResumeUI(true); playClickSound("success"); setStatus("Room créée");
  });
});

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();
  if (!name || !code) return setStatus("Entre un pseudo et un code", true);
  const existingToken = myRoomCode === code ? myPlayerToken : null;
  socket.emit("joinRoom", { name, code, playerToken: existingToken }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de rejoindre la room", true);
    saveSession(res.playerId, res.playerToken, res.room.code);
    renderRoom(res.room);
    if (typeof window.updateMobileUI === "function") window.updateMobileUI(res.room);
    updateResumeUI(true); playClickSound("join"); setStatus("Room rejointe");
  });
});

resumeBtn.addEventListener("click", () => {
  if (!myPlayerToken) { updateResumeUI(false); return setStatus("Aucune session à reprendre", true); }
  socket.emit("resumeSession", { playerToken: myPlayerToken }, (res) => {
    if (!res?.ok) { clearSession(); resetUI(); return setStatus(res?.error || "Impossible de reprendre la session", true); }
    saveSession(res.playerId, res.playerToken, res.room.code);
    renderRoom(res.room);
    if (typeof window.updateMobileUI === "function") window.updateMobileUI(res.room);
    updateResumeUI(true); playClickSound("join"); setStatus("Reconnexion réussie");
  });
});

// AJOUT : bouton reprendre dans la topbar
if (topResumeBtn) {
  topResumeBtn.addEventListener("click", () => {
    if (!myPlayerToken) { updateResumeUI(false); return setStatus("Aucune session à reprendre", true); }
    socket.emit("resumeSession", { playerToken: myPlayerToken }, (res) => {
      if (!res?.ok) { clearSession(); resetUI(); return setStatus(res?.error || "Impossible de reprendre la session", true); }
      saveSession(res.playerId, res.playerToken, res.room.code);
      renderRoom(res.room);
      updateResumeUI(true); playClickSound("join"); setStatus("Reconnexion réussie");
    });
  });
}

function doStartGame() {
  const composition = currentRoom ? getSelectedComposition(currentRoom) : null;
  const settings = currentRoom ? getSelectedSettings(currentRoom) : null;
  socket.emit("startGame", { composition, settings }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de lancer", true);
    playClickSound("success"); setStatus("Partie lancée");
  });
}

startBtn.addEventListener("click", doStartGame);
// AJOUT : boutons lancer dans les cards mobiles
if (startBtnMobile) startBtnMobile.addEventListener("click", doStartGame);
if (startBtnConfig) startBtnConfig.addEventListener("click", doStartGame);

restartBtn.addEventListener("click", () => {
  const composition = currentRoom ? getSelectedComposition(currentRoom) : null;
  const settings = currentRoom ? getSelectedSettings(currentRoom) : null;
  socket.emit("restartGame", { composition, settings }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de relancer", true);
    playClickSound("success"); setStatus("Nouvelle partie lancée");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom", {}, () => {
    resetUI(); validateStoredSession(); playClickSound("leave"); setStatus("Tu as quitté la partie.");
  });
});

sendChatBtn.addEventListener("click", () => {
  const text = normalizeSingleWordInput(chatInput.value);
  if (!text) return;
  socket.emit("sendTurnMessage", { text }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible d'envoyer", true);
    chatInput.value = ""; sendChatBtn.disabled = true; playClickSound("success"); setStatus("Mot envoyé");
  });
});

confirmVoteBtn.addEventListener("click", () => {
  if (!selectedVoteTargetId || voteAlreadySent) return;
  socket.emit("votePlayer", { targetId: selectedVoteTargetId }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de voter", true);
    voteAlreadySent = true; confirmVoteBtn.disabled = true;
    selectedVoteText.textContent = `Vote confirmé contre ${selectedVoteTargetName}.`;
    playClickSound("vote"); setStatus("Vote envoyé", true);
  });
});

chatInput.addEventListener("input", () => {
  const normalized = normalizeSingleWordInput(chatInput.value);
  if (chatInput.value !== normalized) chatInput.value = normalized;
  const isMyTurn = currentRoom && currentRoom.phase === "speaking" && currentRoom.currentSpeakerId === myPlayerId && !currentRoom.gameOver;
  sendChatBtn.disabled = !isMyTurn || !normalized;
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !sendChatBtn.disabled) sendChatBtn.click();
});

if (undercoverCountInput) undercoverCountInput.addEventListener("input", () => { if (currentRoom) renderComposition(currentRoom); });
if (mrWhiteCountInput) mrWhiteCountInput.addEventListener("input", () => { if (currentRoom) renderComposition(currentRoom); });
if (turnDurationInput) turnDurationInput.addEventListener("input", () => { turnDurationInput.value = String(clampSeconds(turnDurationInput.value, 30)); if (currentRoom) renderComposition(currentRoom); });
if (voteDurationInput) voteDurationInput.addEventListener("input", () => { voteDurationInput.value = String(clampSeconds(voteDurationInput.value, 30)); if (currentRoom) renderComposition(currentRoom); });
if (categorySelect) categorySelect.addEventListener("change", () => { if (!currentRoom) return; populateSubcategorySelect(currentRoom, categorySelect.value); renderComposition(currentRoom); });
if (subcategorySelect) subcategorySelect.addEventListener("change", () => { if (currentRoom) renderComposition(currentRoom); });

socket.on("roomUpdated", (room) => {
  if (room.phase !== "voting") resetVoteSelection();
  renderRoom(room);
  if (typeof window.updateMobileUI === "function") window.updateMobileUI(room);
});

socket.on("gameStarted", ({ word }) => {
  secretCard.classList.remove("hidden");
  endCard.classList.add("hidden");
  waitingCard.classList.add("hidden");
  resetVoteSelection();
  wordText.textContent = word || "Tu n'as pas de mot.";
  playClickSound("success"); setStatus("La partie commence");
  mobileGameActivePanel = "secretCard";
  updateMobileGamePanels();
});

socket.on("sessionResumed", ({ word }) => {
  secretCard.classList.remove("hidden");
  wordText.textContent = word || "Tu n'as pas de mot.";
});

socket.on("voteResult", (result) => {
  resetVoteSelection();
  if (result.tie) setStatus("Égalité : personne n'est éliminé.", true);
  else setStatus(`${result.eliminated.name} est éliminé (${result.eliminated.role}).`, true);
  playClickSound("vote");
});

attachUiSounds();
initAds();
initTopRoomCopy();
initMobileGameTabs();
validateStoredSession();