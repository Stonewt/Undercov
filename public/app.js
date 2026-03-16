const socket = io();

let currentRoom = null;
let myPlayerId = localStorage.getItem("playerId") || null;
let myPlayerToken = localStorage.getItem("playerToken") || null;
let timerInterval = null;
let selectedVoteTargetId = null;
let selectedVoteTargetName = null;
let voteAlreadySent = false;

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");

const statusBanner = document.getElementById("statusBanner");

const startWrap = document.getElementById("startWrap");
const roomSetupCard = document.getElementById("roomSetupCard");
const leaveWrap = document.getElementById("leaveWrap");
const leaveBtn = document.getElementById("leaveBtn");

const lobby = document.getElementById("lobby");
const roomCodeEl = document.getElementById("roomCode");
const hostInfo = document.getElementById("hostInfo");
const phaseInfo = document.getElementById("phaseInfo");
const speakerInfo = document.getElementById("speakerInfo");
const playersList = document.getElementById("playersList");

const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");

const secretCard = document.getElementById("secretCard");
const wordText = document.getElementById("wordText");

const chatCard = document.getElementById("chatCard");
const messagesList = document.getElementById("messagesList");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatHelp = document.getElementById("chatHelp");

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

function saveSession(playerId, playerToken) {
  myPlayerId = playerId;
  myPlayerToken = playerToken;
  localStorage.setItem("playerId", playerId);
  localStorage.setItem("playerToken", playerToken);
}

function clearSession() {
  myPlayerId = null;
  myPlayerToken = null;
  localStorage.removeItem("playerId");
  localStorage.removeItem("playerToken");
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
  lobby.classList.add("hidden");
  secretCard.classList.add("hidden");
  chatCard.classList.add("hidden");
  voteCard.classList.add("hidden");
  resultCard.classList.add("hidden");
  endCard.classList.add("hidden");
  leaveWrap.classList.add("hidden");
  startWrap.classList.remove("hidden");
  roomSetupCard.classList.remove("hidden");

  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  voteButtons.innerHTML = "";
  revealList.innerHTML = "";

  roomCodeEl.textContent = "";
  hostInfo.textContent = "";
  phaseInfo.textContent = "";
  speakerInfo.textContent = "";
  wordText.textContent = "";
  resultText.textContent = "";
  winnerText.textContent = "";

  resetVoteSelection();
  stopTimer();
}

function hideGameplayButtons() {
  startBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
}

function renderPlayers(room) {
  playersList.innerHTML = "";

  room.players.forEach((player) => {
    const li = document.createElement("li");
    let label = player.name;

    if (!player.connected) label += " (déconnecté)";
    if (player.eliminated) label += " - éliminé";
    if (player.id === room.currentSpeakerId) label += " ← joue";
    if (player.id === myPlayerId) label += " (toi)";

    li.textContent = label;

    if (player.eliminated) {
      li.classList.add("player-dead");
    }

    playersList.appendChild(li);
  });
}

function renderMessages(room) {
  messagesList.innerHTML = "";
  const messages = room.messages || [];

  messages.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "message";
    div.textContent = `${msg.playerName} : ${msg.text}`;
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
  renderMessages(room);

  const me = room.players.find((p) => p.id === myPlayerId);

  const isMyTurn =
    room.phase === "speaking" &&
    room.currentSpeakerId === myPlayerId &&
    me &&
    !me.eliminated;

  chatInput.disabled = !isMyTurn;
  sendChatBtn.disabled = !isMyTurn;

  if (room.phase === "voting") {
    chatHelp.textContent = "Vote en cours.";
  } else if (isMyTurn) {
    chatHelp.textContent = "C'est ton tour : envoie ton indice avant la fin du timer.";
  } else {
    chatHelp.textContent = "Ce n'est pas ton tour. Tu peux lire.";
  }
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
      `${player.word ? ` | mot : ${player.word}` : " | pas de mot"}`;
    revealList.appendChild(li);
  });
}

function renderTimer(room) {
  stopTimer();

  let endAt = null;
  let total = null;

  if (room.phase === "speaking" && room.turnEndsAt) {
    endAt = room.turnEndsAt;
    total = room.turnDurationMs || 20000;
  } else if (room.phase === "voting" && room.voteEndsAt) {
    endAt = room.voteEndsAt;
    total = room.voteDurationMs || 20000;
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

    if (remaining <= 0) {
      stopTimer();
    }
  };

  tick();
  timerInterval = setInterval(tick, 200);
}

function renderRoom(room) {
  currentRoom = room;

  lobby.classList.remove("hidden");
  leaveWrap.classList.remove("hidden");
  startWrap.classList.add("hidden");

  roomCodeEl.textContent = room.code;

  const host = room.players.find((p) => p.id === room.hostPlayerId);
  hostInfo.textContent = host ? `Hôte : ${host.name}` : "Pas d'hôte";

  if (!room.started) {
    phaseInfo.textContent = "Manche 0";
    speakerInfo.textContent = "";
  } else {
    phaseInfo.textContent = `Manche ${room.round}`;

    const speaker = room.players.find((p) => p.id === room.currentSpeakerId);

    if (room.phase === "speaking" && speaker) {
      speakerInfo.textContent = `Tour de ${speaker.name}`;
    } else if (room.phase === "voting") {
      speakerInfo.textContent = `Vote en cours (${room.voteCount}/${room.players.filter(p => !p.eliminated).length})`;
    } else {
      speakerInfo.textContent = "";
    }
  }

  renderPlayers(room);
  renderChat(room);
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
  if (!name) return setStatus("Entre un pseudo");

  clearSession();
  resetUI();

  socket.emit("createRoom", { name }, (res) => {
    if (!res.ok) return setStatus(res.error, true);

    saveSession(res.playerId, res.playerToken);
    renderRoom(res.room);
    setStatus("Room créée");
  });
});

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();

  if (!name || !code) return setStatus("Entre un pseudo et un code", true);

  clearSession();
  resetUI();

  socket.emit("joinRoom", { name, code }, (res) => {
    if (!res.ok) return setStatus(res.error, true);

    saveSession(res.playerId, res.playerToken);
    renderRoom(res.room);
    setStatus("Room rejointe");
  });
});

startBtn.addEventListener("click", () => {
  socket.emit("startGame", {}, (res) => {
    if (!res.ok) return setStatus(res.error, true);
    setStatus("Partie lancée");
  });
});

restartBtn.addEventListener("click", () => {
  socket.emit("restartGame", {}, (res) => {
    if (!res.ok) return setStatus(res.error, true);
    setStatus("Nouvelle partie lancée");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom", {}, () => {
    clearSession();
    resetUI();
    setStatus("Tu as quitté la partie.");
  });
});

sendChatBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit("sendTurnMessage", { text }, (res) => {
    if (!res.ok) return setStatus(res.error, true);
    chatInput.value = "";
    setStatus("Indice envoyé");
  });
});

confirmVoteBtn.addEventListener("click", () => {
  if (!selectedVoteTargetId || voteAlreadySent) return;

  socket.emit("votePlayer", { targetId: selectedVoteTargetId }, (res) => {
    if (!res.ok) return setStatus(res.error, true);

    voteAlreadySent = true;
    confirmVoteBtn.disabled = true;
    selectedVoteText.textContent = `Vote confirmé contre ${selectedVoteTargetName}.`;
    setStatus("Vote envoyé", true);
  });
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !sendChatBtn.disabled) {
    sendChatBtn.click();
  }
});

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
  resetVoteSelection();
  wordText.textContent = word ? `Mot : ${word}` : "Tu n'as pas de mot.";
  setStatus("La partie commence");
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
});

initAds();