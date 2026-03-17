const socket = io();

let currentRoom = null;
let myPlayerId = localStorage.getItem("playerId") || null;
let myPlayerToken = localStorage.getItem("playerToken") || null;
let myRoomCode = localStorage.getItem("roomCode") || null;
let timerInterval = null;
let selectedVoteTargetId = null;
let selectedVoteTargetName = null;
let voteAlreadySent = false;
let currentTurnKey = null;
let autoSubmittedTurnKey = null;
let previousVisiblePlayerIds = [];

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

const resultCard = document.getElementById("resultCard");
const resultText = document.getElementById("resultText");

const endCard = document.getElementById("endCard");
const endTitle = document.getElementById("endTitle");
const winnerText = document.getElementById("winnerText");
const revealList = document.getElementById("revealList");

const timerFill = document.getElementById("timerFill");
const timerText = document.getElementById("timerText");

let audioCtx = null;

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

function saveSession(playerId, playerToken, roomCode) {
  myPlayerId = playerId;
  myPlayerToken = playerToken;
  myRoomCode = roomCode || myRoomCode;

  localStorage.setItem("playerId", playerId);
  localStorage.setItem("playerToken", playerToken);

  if (myRoomCode) {
    localStorage.setItem("roomCode", myRoomCode);
  }
}

function clearSession() {
  myPlayerId = null;
  myPlayerToken = null;
  myRoomCode = null;

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
}

function validateStoredSession() {
  if (!myPlayerToken || !myRoomCode) {
    updateResumeUI(false);
    return;
  }

  socket.emit(
    "checkSession",
    { playerToken: myPlayerToken, roomCode: myRoomCode },
    (res) => {
      if (!res?.ok) {
        clearSession();
        updateResumeUI(false);
        return;
      }

      updateResumeUI(true);
    }
  );
}

function normalizeSingleWordInput(value) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned.split(" ")[0].slice(0, 24);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerFill.style.width = "0%";
  timerText.textContent = "--";
  timerFill.style.background = "#22c55e";
}

function resetVoteSelection() {
  selectedVoteTargetId = null;
  selectedVoteTargetName = null;
  voteAlreadySent = false;
  selectedVoteText.textContent = "Aucun joueur sélectionné.";
  confirmVoteBtn.disabled = true;
}

function resetUI() {
  currentRoom = null;
  currentTurnKey = null;
  autoSubmittedTurnKey = null;
  previousVisiblePlayerIds = [];

  lobby.classList.add("hidden");
  secretCard.classList.add("hidden");
  if (compositionCard) compositionCard.classList.add("hidden");
  chatCard.classList.add("hidden");
  waitingCard.classList.add("hidden");
  voteCard.classList.add("hidden");
  resultCard.classList.add("hidden");
  endCard.classList.add("hidden");
  leaveWrap.classList.add("hidden");
  startWrap.classList.remove("hidden");
  roomSetupCard.classList.remove("hidden");

  topRoomInfo.classList.add("hidden");
  topHostInfo.classList.add("hidden");
  topRoomInfo.textContent = "";
  topHostInfo.textContent = "";

  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  voteButtons.innerHTML = "";
  revealList.innerHTML = "";
  if (roleDolls) roleDolls.innerHTML = "";
  if (waitingRoleDolls) waitingRoleDolls.innerHTML = "";

  phaseInfo.textContent = "";
  speakerInfo.textContent = "";
  wordText.textContent = "";
  resultText.textContent = "";
  winnerText.textContent = "";
  if (compositionHelp) compositionHelp.textContent = "";
  if (compositionSummary) compositionSummary.textContent = "";
  if (waitingCategory) waitingCategory.textContent = "--";
  if (waitingSubcategory) waitingSubcategory.textContent = "--";
  if (waitingTurnDuration) waitingTurnDuration.textContent = "--";
  if (waitingVoteDuration) waitingVoteDuration.textContent = "--";
  chatInput.value = "";

  if (categorySelect) categorySelect.innerHTML = "";
  if (subcategorySelect) subcategorySelect.innerHTML = "";

  resetVoteSelection();
  stopTimer();
  updateResumeUI(false);
}

function hideGameplayButtons() {
  startBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
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

    if (player.eliminated) {
      li.classList.add("player-dead");
    }

    if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) {
      li.classList.add("player-current");
    }

    const nameLine = document.createElement("span");
    nameLine.className = "player-name";

    let mainLabel = player.name;
    if (player.id === myPlayerId) mainLabel += " (toi)";
    if (player.id === room.hostPlayerId) mainLabel += " 👑";
    nameLine.textContent = mainLabel;
    li.appendChild(nameLine);

    const subParts = [];

    if (player.id === room.currentSpeakerId && room.phase === "speaking" && !room.gameOver) {
      subParts.push("réfléchit");
    }

    if (player.eliminated) {
      subParts.push("éliminé");
    }

    if (subParts.length > 0) {
      const subLine = document.createElement("span");
      subLine.className = "player-sub";
      subLine.textContent = subParts.join(" • ");
      li.appendChild(subLine);
    }

    playersList.appendChild(li);
  });
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

    const head = document.createElement("div");
    head.className = "role-doll-head";

    const body = document.createElement("div");
    body.className = "role-doll-body";

    doll.appendChild(head);
    doll.appendChild(body);
    container.appendChild(doll);
  });
}

function renderRoleDolls(room) {
  fillRoleDolls(roleDolls, room);
  fillRoleDolls(waitingRoleDolls, room);
}

function renderMessages(room) {
  messagesList.innerHTML = "";
  const messages = room.messages || [];

  messages.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "message";

    if (!msg.playerId) {
      div.classList.add("system");
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "message-name";
    nameSpan.textContent = `${msg.playerName}`;

    const textSpan = document.createElement("span");
    textSpan.className = "message-text";
    textSpan.textContent = msg.text;

    div.appendChild(nameSpan);
    div.appendChild(textSpan);

    messagesList.appendChild(div);
  });

  messagesList.scrollTop = messagesList.scrollHeight;
}

function renderChat(room) {
  if (!room.started || room.gameOver) {
    chatCard.classList.add("hidden");
    return;
  }

  chatCard.classList.remove("hidden");
  renderRoleDolls(room);
  renderMessages(room);

  const me = room.players.find((p) => p.id === myPlayerId);

  const isMyTurn =
    room.phase === "speaking" &&
    room.currentSpeakerId === myPlayerId &&
    me &&
    !me.eliminated;

  chatInput.disabled = !isMyTurn;
  sendChatBtn.disabled = !isMyTurn || !normalizeSingleWordInput(chatInput.value);

  if (room.phase === "voting") {
    chatHelp.textContent = "Vote en cours.";
  } else if (isMyTurn) {
    chatHelp.textContent = "Entre un seul mot. Tu ne peux pas écrire ton mot secret.";
  } else {
    chatHelp.textContent = "Ce n'est pas ton tour. Tu peux lire.";
  }
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
    voteCard.classList.add("hidden");
    resetVoteSelection();
    return;
  }

  voteCard.classList.remove("hidden");

  room.players
    .filter((p) => !p.eliminated && p.id !== myPlayerId)
    .forEach((player) => {
      const btn = document.createElement("button");
      btn.className = "vote-btn";
      btn.textContent = `Choisir ${player.name}`;

      if (selectedVoteTargetId === player.id) {
        btn.classList.add("vote-btn-selected");
      }

      btn.onclick = () => {
        if (voteAlreadySent) return;
        selectedVoteTargetId = player.id;
        selectedVoteTargetName = player.name;
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

  const me = room.reveal.find((p) => p.id === myPlayerId);
  if (!me) return null;

  if (room.winner === "civils" && me.role === "civil") return "Victoire";
  if (room.winner === "undercover" && me.role === "undercover") return "Victoire";
  if (room.winner === "mrwhite" && me.role === "mrwhite") return "Victoire";
  return "Défaite";
}

function renderEndGame(room) {
  if (!room.gameOver) {
    endCard.classList.add("hidden");
    return;
  }

  endCard.classList.remove("hidden");

  const outcome = getMyOutcome(room) || "Fin de partie";
  endTitle.textContent = outcome;
  winnerText.textContent = `Équipe gagnante : ${room.winner}`;

  revealList.innerHTML = "";

  room.reveal.forEach((player) => {
    const li = document.createElement("li");
    li.textContent =
      `${player.name} : ${player.role}` +
      `${player.word ? ` | ${player.word}` : ""}`;
    revealList.appendChild(li);
  });
}

function renderTimer(room) {
  stopTimer();

  let endAt = null;
  let total = null;

  if (room.phase === "speaking" && room.turnEndsAt) {
    endAt = room.turnEndsAt;
    total = room.turnDurationMs || 30000;
  } else if (room.phase === "voting" && room.voteEndsAt) {
    endAt = room.voteEndsAt;
    total = room.voteDurationMs || 30000;
  } else {
    return;
  }

  const tick = () => {
    const remaining = Math.max(0, endAt - Date.now());
    const percent = Math.max(0, Math.min(100, (remaining / total) * 100));

    timerFill.style.width = `${percent}%`;
    timerText.textContent = `${Math.ceil(remaining / 1000)} s`;

    if (remaining <= 7000) {
      timerFill.style.background = "#f59e0b";
    } else {
      timerFill.style.background = "#22c55e";
    }

    if (remaining <= 3000) {
      timerFill.style.background = "#ef4444";
    }

    const isMyTurn =
      room.phase === "speaking" &&
      room.currentSpeakerId === myPlayerId &&
      !room.gameOver;

    if (
      isMyTurn &&
      remaining <= 250 &&
      currentTurnKey &&
      autoSubmittedTurnKey !== currentTurnKey
    ) {
      const word = normalizeSingleWordInput(chatInput.value);
      if (word && !sendChatBtn.disabled) {
        autoSubmittedTurnKey = currentTurnKey;
        sendChatBtn.click();
      }
    }

    if (remaining <= 0) {
      stopTimer();
    }
  };

  tick();
  timerInterval = setInterval(tick, 200);
}

function clampCompositionValues(room) {
  if (!undercoverCountInput || !mrWhiteCountInput) {
    return { undercoverCount: 1, mrwhiteCount: 0, civilCount: room.players.length - 1 };
  }

  const playerCount = room.players.length;

  if (playerCount <= 3) {
    undercoverCountInput.value = "1";
    mrWhiteCountInput.value = "0";
    return {
      undercoverCount: 1,
      mrwhiteCount: 0,
      civilCount: 2
    };
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

  return {
    undercoverCount,
    mrwhiteCount,
    civilCount
  };
}

function clampSeconds(value, fallback = 30) {
  let n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) n = fallback;
  return Math.max(15, Math.min(45, n));
}

function populateCategorySelect(room) {
  if (!categorySelect || !subcategorySelect) return;

  const options = Array.isArray(room.categoryOptions) ? room.categoryOptions : [];
  const selectedCategory = room.selectedCategory || options[0]?.name || "";

  categorySelect.innerHTML = "";
  options.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    option.selected = category.name === selectedCategory;
    categorySelect.appendChild(option);
  });

  populateSubcategorySelect(room, selectedCategory, room.selectedSubcategory);
}

function populateSubcategorySelect(room, categoryName, preferredSubcategory = null) {
  if (!subcategorySelect) return;

  const options = Array.isArray(room.categoryOptions) ? room.categoryOptions : [];
  const category = options.find((item) => item.name === categoryName) || options[0];

  const subcategories = category?.subcategories || [];
  const selectedSubcategory =
    preferredSubcategory && subcategories.includes(preferredSubcategory)
      ? preferredSubcategory
      : subcategories[0] || "";

  subcategorySelect.innerHTML = "";

  subcategories.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === selectedSubcategory;
    subcategorySelect.appendChild(option);
  });
}

function getSelectedComposition(room) {
  const values = clampCompositionValues(room);
  return {
    undercoverCount: values.undercoverCount,
    mrwhiteCount: values.mrwhiteCount
  };
}

function getSelectedSettings(room) {
  const turnDurationSeconds = clampSeconds(
    turnDurationInput?.value,
    room?.turnDurationSeconds || 30
  );
  const voteDurationSeconds = clampSeconds(
    voteDurationInput?.value,
    room?.voteDurationSeconds || 30
  );

  if (turnDurationInput) turnDurationInput.value = String(turnDurationSeconds);
  if (voteDurationInput) voteDurationInput.value = String(voteDurationSeconds);

  return {
    turnDurationSeconds,
    voteDurationSeconds,
    category: categorySelect?.value || room?.selectedCategory || null,
    subcategory: subcategorySelect?.value || room?.selectedSubcategory || null
  };
}

function renderComposition(room) {
  if (
    !compositionCard ||
    !compositionHelp ||
    !compositionSummary ||
    !undercoverCountInput ||
    !mrWhiteCountInput ||
    !turnDurationInput ||
    !voteDurationInput ||
    !categorySelect ||
    !subcategorySelect
  ) {
    return;
  }

  const isHost = room.hostPlayerId === myPlayerId;
  const canConfigure = !room.started && !room.gameOver && isHost;

  if (!canConfigure) {
    compositionCard.classList.add("hidden");
    return;
  }

  compositionCard.classList.remove("hidden");

  const playerCount = room.players.length;

  if (turnDurationInput !== document.activeElement) {
    turnDurationInput.value = String(clampSeconds(turnDurationInput.value, room.turnDurationSeconds || 30));
  }
  if (voteDurationInput !== document.activeElement) {
    voteDurationInput.value = String(clampSeconds(voteDurationInput.value, room.voteDurationSeconds || 30));
  }

  populateCategorySelect(room);

  if (playerCount <= 3) {
    undercoverCountInput.disabled = true;
    mrWhiteCountInput.disabled = true;
    undercoverCountInput.value = "1";
    mrWhiteCountInput.value = "0";
    compositionHelp.textContent = "À 3 joueurs : composition fixe. L'hôte peut aussi choisir la durée et la catégorie.";
  } else {
    undercoverCountInput.disabled = false;
    mrWhiteCountInput.disabled = false;
    undercoverCountInput.min = "1";
    undercoverCountInput.max = String(playerCount - 1);
    mrWhiteCountInput.min = "0";
    mrWhiteCountInput.max = "1";
    compositionHelp.textContent = "L'hôte choisit la composition, les durées et la catégorie.";
  }

  const values = clampCompositionValues(room);
  const settings = getSelectedSettings(room);

  compositionSummary.textContent =
    `${values.civilCount} civil(s) • ${values.undercoverCount} undercover(s)` +
    `${values.mrwhiteCount ? " • 1 Mr White" : ""}` +
    ` • Tours ${settings.turnDurationSeconds}s • Vote ${settings.voteDurationSeconds}s` +
    ` • ${settings.category || "--"} / ${settings.subcategory || "--"}`;
}

function handlePresenceSounds(room) {
  const currentIds = (room.players || []).map((p) => p.id);
  if (!previousVisiblePlayerIds.length) {
    previousVisiblePlayerIds = currentIds;
    return;
  }

  const joined = currentIds.filter((id) => !previousVisiblePlayerIds.includes(id));
  const left = previousVisiblePlayerIds.filter((id) => !currentIds.includes(id));

  if (joined.length > 0) {
    playClickSound("join");
  } else if (left.length > 0) {
    playClickSound("leave");
  }

  previousVisiblePlayerIds = currentIds;
}

function renderRoom(room) {
  handlePresenceSounds(room);

  currentRoom = room;
  myRoomCode = room.code;
  localStorage.setItem("roomCode", room.code);

  lobby.classList.remove("hidden");
  leaveWrap.classList.remove("hidden");
  startWrap.classList.add("hidden");

  const host = room.players.find((p) => p.id === room.hostPlayerId);

  topRoomInfo.textContent = `Room ${room.code}`;
  topHostInfo.textContent = host ? `Hôte : ${host.name}` : "Pas d'hôte";
  topRoomInfo.classList.remove("hidden");
  topHostInfo.classList.remove("hidden");

  const nextTurnKey = `${room.code}-${room.phase}-${room.round}-${room.currentSpeakerId || "none"}`;
  if (currentTurnKey !== nextTurnKey) {
    currentTurnKey = nextTurnKey;
    autoSubmittedTurnKey = null;

    if (!(room.phase === "speaking" && room.currentSpeakerId === myPlayerId)) {
      chatInput.value = "";
    }
  }

  if (!room.started) {
    phaseInfo.textContent = "Salon";
    speakerInfo.textContent = "La partie n'a pas encore commencé";
  } else {
    phaseInfo.textContent = `Manche ${room.round}`;

    const speaker = room.players.find((p) => p.id === room.currentSpeakerId);

    if (room.phase === "speaking" && speaker) {
      speakerInfo.textContent = `${speaker.name} réfléchit`;
    } else if (room.phase === "voting") {
      speakerInfo.textContent = `Vote en cours (${room.voteCount}/${room.players.filter((p) => !p.eliminated).length})`;
    } else {
      speakerInfo.textContent = "";
    }
  }

  renderPlayers(room);
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
}

function closeAd(adId) {
  const ad = document.querySelector(`[data-ad="${adId}"]`);
  if (!ad) return;
  ad.classList.add("hidden");
  localStorage.setItem(`adClosed:${adId}`, "1");

  ["leftAds", "rightAds"].forEach((columnId) => {
    const column = document.getElementById(columnId);
    if (!column) return;
    const visibleAds = [...column.querySelectorAll(".ad-slot:not(.hidden)")];
    if (visibleAds.length === 0) {
      column.classList.add("hidden");
    }
  });
}

function initAds() {
  document.querySelectorAll("[data-close-ad]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAd(btn.dataset.closeAd);
    });
  });

  document.querySelectorAll("[data-ad]").forEach((ad) => {
    const adId = ad.dataset.ad;
    if (localStorage.getItem(`adClosed:${adId}`) === "1") {
      ad.classList.add("hidden");
    }
  });

  ["leftAds", "rightAds"].forEach((columnId) => {
    const column = document.getElementById(columnId);
    if (!column) return;
    const visibleAds = [...column.querySelectorAll(".ad-slot:not(.hidden)")];
    if (visibleAds.length === 0) {
      column.classList.add("hidden");
    }
  });
}

createBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) return setStatus("Entre un pseudo", true);

  clearSession();
  resetUI();

  socket.emit("createRoom", { name }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de créer la room", true);

    saveSession(res.playerId, res.playerToken, res.room.code);
    renderRoom(res.room);
    updateResumeUI(true);
    playClickSound("success");
    setStatus("Room créée");
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
    updateResumeUI(true);
    playClickSound("join");
    setStatus("Room rejointe");
  });
});

resumeBtn.addEventListener("click", () => {
  if (!myPlayerToken) {
    updateResumeUI(false);
    return setStatus("Aucune session à reprendre", true);
  }

  socket.emit("resumeSession", { playerToken: myPlayerToken }, (res) => {
    if (!res?.ok) {
      clearSession();
      resetUI();
      return setStatus(res?.error || "Impossible de reprendre la session", true);
    }

    saveSession(res.playerId, res.playerToken, res.room.code);
    renderRoom(res.room);
    updateResumeUI(true);
    playClickSound("join");
    setStatus("Reconnexion réussie");
  });
});

startBtn.addEventListener("click", () => {
  const composition = currentRoom ? getSelectedComposition(currentRoom) : null;
  const settings = currentRoom ? getSelectedSettings(currentRoom) : null;

  socket.emit("startGame", { composition, settings }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de lancer", true);
    playClickSound("success");
    setStatus("Partie lancée");
  });
});

restartBtn.addEventListener("click", () => {
  const composition = currentRoom ? getSelectedComposition(currentRoom) : null;
  const settings = currentRoom ? getSelectedSettings(currentRoom) : null;

  socket.emit("restartGame", { composition, settings }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de relancer", true);
    playClickSound("success");
    setStatus("Nouvelle partie lancée");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom", {}, () => {
    resetUI();
    validateStoredSession();
    playClickSound("leave");
    setStatus("Tu as quitté la partie.");
  });
});

sendChatBtn.addEventListener("click", () => {
  const text = normalizeSingleWordInput(chatInput.value);
  if (!text) return;

  socket.emit("sendTurnMessage", { text }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible d'envoyer", true);
    chatInput.value = "";
    sendChatBtn.disabled = true;
    playClickSound("success");
    setStatus("Mot envoyé");
  });
});

confirmVoteBtn.addEventListener("click", () => {
  if (!selectedVoteTargetId || voteAlreadySent) return;

  socket.emit("votePlayer", { targetId: selectedVoteTargetId }, (res) => {
    if (!res?.ok) return setStatus(res?.error || "Impossible de voter", true);

    voteAlreadySent = true;
    confirmVoteBtn.disabled = true;
    selectedVoteText.textContent = `Vote confirmé contre ${selectedVoteTargetName}.`;
    playClickSound("vote");
    setStatus("Vote envoyé", true);
  });
});

chatInput.addEventListener("input", () => {
  const normalized = normalizeSingleWordInput(chatInput.value);
  if (chatInput.value !== normalized) {
    chatInput.value = normalized;
  }

  const isMyTurn =
    currentRoom &&
    currentRoom.phase === "speaking" &&
    currentRoom.currentSpeakerId === myPlayerId &&
    !currentRoom.gameOver;

  sendChatBtn.disabled = !isMyTurn || !normalized;
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !sendChatBtn.disabled) {
    sendChatBtn.click();
  }
});

if (undercoverCountInput) {
  undercoverCountInput.addEventListener("input", () => {
    if (currentRoom) renderComposition(currentRoom);
  });
}

if (mrWhiteCountInput) {
  mrWhiteCountInput.addEventListener("input", () => {
    if (currentRoom) renderComposition(currentRoom);
  });
}

if (turnDurationInput) {
  turnDurationInput.addEventListener("input", () => {
    turnDurationInput.value = String(clampSeconds(turnDurationInput.value, 30));
    if (currentRoom) renderComposition(currentRoom);
  });
}

if (voteDurationInput) {
  voteDurationInput.addEventListener("input", () => {
    voteDurationInput.value = String(clampSeconds(voteDurationInput.value, 30));
    if (currentRoom) renderComposition(currentRoom);
  });
}

if (categorySelect) {
  categorySelect.addEventListener("change", () => {
    if (!currentRoom) return;
    populateSubcategorySelect(currentRoom, categorySelect.value);
    renderComposition(currentRoom);
  });
}

if (subcategorySelect) {
  subcategorySelect.addEventListener("change", () => {
    if (currentRoom) renderComposition(currentRoom);
  });
}

socket.on("roomUpdated", (room) => {
  if (room.phase !== "voting") {
    resetVoteSelection();
  }
  renderRoom(room);
});

socket.on("gameStarted", ({ word }) => {
  secretCard.classList.remove("hidden");
  resultCard.classList.add("hidden");
  endCard.classList.add("hidden");
  waitingCard.classList.add("hidden");
  resetVoteSelection();
  wordText.textContent = word || "Tu n'as pas de mot.";
  playClickSound("success");
  setStatus("La partie commence");
});

socket.on("sessionResumed", ({ word }) => {
  secretCard.classList.remove("hidden");
  wordText.textContent = word || "Tu n'as pas de mot.";
});

socket.on("voteResult", (result) => {
  resultCard.classList.remove("hidden");
  resetVoteSelection();

  if (result.tie) {
    resultText.textContent = "Égalité : personne n'est éliminé.";
  } else {
    resultText.textContent =
      `${result.eliminated.name} est éliminé.` +
      ` Son rôle était ${result.eliminated.role}.`;
  }

  playClickSound("vote");
});

attachUiSounds();
initAds();
validateStoredSession();