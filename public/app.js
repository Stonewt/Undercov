const socket = io();

let currentRoom = null;
let myPlayerId = localStorage.getItem("playerId") || null;
let myPlayerToken = localStorage.getItem("playerToken") || null;

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const statusEl = document.getElementById("status");

const lobby = document.getElementById("lobby");
const roomCodeEl = document.getElementById("roomCode");
const hostInfo = document.getElementById("hostInfo");
const phaseInfo = document.getElementById("phaseInfo");
const speakerInfo = document.getElementById("speakerInfo");
const playersList = document.getElementById("playersList");

const startBtn = document.getElementById("startBtn");
const nextSpeakerBtn = document.getElementById("nextSpeakerBtn");
const finishVotingBtn = document.getElementById("finishVotingBtn");
const restartBtn = document.getElementById("restartBtn");

const secretCard = document.getElementById("secretCard");
const roleText = document.getElementById("roleText");
const wordText = document.getElementById("wordText");
const revealBtn = document.getElementById("revealBtn");

const voteCard = document.getElementById("voteCard");
const voteButtons = document.getElementById("voteButtons");

const resultCard = document.getElementById("resultCard");
const resultText = document.getElementById("resultText");

const endCard = document.getElementById("endCard");
const winnerText = document.getElementById("winnerText");
const revealList = document.getElementById("revealList");

function setStatus(message) {
  statusEl.textContent = message;
}

function saveSession(playerId, playerToken) {
  myPlayerId = playerId;
  myPlayerToken = playerToken;
  localStorage.setItem("playerId", playerId);
  localStorage.setItem("playerToken", playerToken);
}

function hideGameplayButtons() {
  startBtn.classList.add("hidden");
  nextSpeakerBtn.classList.add("hidden");
  finishVotingBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
}

function renderPlayers(room) {
  playersList.innerHTML = "";

  room.players.forEach((player) => {
    const li = document.createElement("li");
    let label = player.name;

    if (!player.connected) label += " (déconnecté)";
    if (player.eliminated) label += " - éliminé";
    if (player.id === room.currentSpeakerId) label += " ← parle";
    if (player.id === myPlayerId) label += " (toi)";

    li.textContent = label;
    if (player.eliminated) li.classList.add("player-dead");
    playersList.appendChild(li);
  });
}

function renderVoteButtons(room) {
  voteButtons.innerHTML = "";

  const me = room.players.find((p) => p.id === myPlayerId);
  if (!me || me.eliminated || room.phase !== "voting" || room.gameOver) {
    voteCard.classList.add("hidden");
    return;
  }

  voteCard.classList.remove("hidden");

  room.players
    .filter((p) => !p.eliminated && p.id !== myPlayerId)
    .forEach((player) => {
      const btn = document.createElement("button");
      btn.className = "vote-btn";
      btn.textContent = `Voter contre ${player.name}`;
      btn.onclick = () => {
        socket.emit("votePlayer", { targetId: player.id }, (res) => {
          if (!res.ok) return setStatus(res.error);
          setStatus(`Vote enregistré contre ${player.name}`);
        });
      };
      voteButtons.appendChild(btn);
    });
}

function renderEndGame(room) {
  if (!room.gameOver) {
    endCard.classList.add("hidden");
    return;
  }

  endCard.classList.remove("hidden");
  winnerText.textContent = `Gagnant : ${room.winner}`;
  revealList.innerHTML = "";

  room.reveal.forEach((player) => {
    const li = document.createElement("li");
    li.textContent =
      `${player.name} : ${player.role}` +
      `${player.word ? ` | mot : ${player.word}` : " | pas de mot"}` +
      `${player.eliminated ? " | éliminé" : ""}`;
    revealList.appendChild(li);
  });
}

function renderRoom(room) {
  currentRoom = room;
  lobby.classList.remove("hidden");
  roomCodeEl.textContent = room.code;

  const host = room.players.find((p) => p.id === room.hostPlayerId);
  hostInfo.textContent = host ? `Hôte : ${host.name}` : "Pas d'hôte";

  if (!room.started) {
    phaseInfo.textContent = "Phase : lobby";
    speakerInfo.textContent = "";
  } else {
    phaseInfo.textContent = `Phase : ${room.phase} | Manche : ${room.round}`;
    const speaker = room.players.find((p) => p.id === room.currentSpeakerId);

    if (room.phase === "speaking" && speaker) {
      speakerInfo.textContent = `C'est à ${speaker.name} de parler`;
    } else if (room.phase === "voting") {
      speakerInfo.textContent = "Tout le monde vote";
    } else {
      speakerInfo.textContent = "";
    }
  }

  renderPlayers(room);
  hideGameplayButtons();

  const isHost = room.hostPlayerId === myPlayerId;

  if (!room.started && isHost) startBtn.classList.remove("hidden");
  if (room.started && !room.gameOver && room.phase === "speaking" && isHost) {
    nextSpeakerBtn.classList.remove("hidden");
  }
  if (room.started && !room.gameOver && room.phase === "voting" && isHost) {
    finishVotingBtn.classList.remove("hidden");
  }
  if (room.gameOver && isHost) restartBtn.classList.remove("hidden");

  renderVoteButtons(room);
  renderEndGame(room);

  if (room.gameOver) {
    voteCard.classList.add("hidden");
  }
}

createBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) return setStatus("Entre un pseudo");

  socket.emit("createRoom", { name }, (res) => {
    if (!res.ok) return setStatus(res.error);

    saveSession(res.playerId, res.playerToken);
    renderRoom(res.room);
    setStatus("Room créée");
  });
});

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();

  if (!name || !code) return setStatus("Entre un pseudo et un code");

  socket.emit("joinRoom", { name, code }, (res) => {
    if (!res.ok) return setStatus(res.error);

    saveSession(res.playerId, res.playerToken);
    renderRoom(res.room);
    setStatus("Room rejointe");
  });
});

startBtn.addEventListener("click", () => {
  socket.emit("startGame", {}, (res) => {
    if (!res.ok) return setStatus(res.error);
    setStatus("Partie lancée");
  });
});

nextSpeakerBtn.addEventListener("click", () => {
  socket.emit("nextSpeaker", {}, (res) => {
    if (!res.ok) return setStatus(res.error);
  });
});

finishVotingBtn.addEventListener("click", () => {
  socket.emit("finishVoting", {}, (res) => {
    if (!res.ok) return setStatus(res.error);
  });
});

restartBtn.addEventListener("click", () => {
  socket.emit("restartGame", {}, (res) => {
    if (!res.ok) return setStatus(res.error);
    resultCard.classList.add("hidden");
    endCard.classList.add("hidden");
    setStatus("Nouvelle partie lancée");
  });
});

revealBtn.addEventListener("click", () => {
  socket.emit("getMySecret", {}, (res) => {
    if (!res.ok) return setStatus(res.error);

    secretCard.classList.remove("hidden");
    roleText.textContent = `Rôle : ${res.role}`;
    wordText.textContent =
      res.role === "mrwhite" ? "Tu n'as pas de mot." : `Mot : ${res.word}`;
  });
});

socket.on("connect", () => {
  if (!myPlayerToken) return;

  socket.emit("reconnectPlayer", { playerToken: myPlayerToken }, (res) => {
    if (!res?.ok) return;
    myPlayerId = res.playerId;
    localStorage.setItem("playerId", myPlayerId);
    renderRoom(res.room);
    setStatus("Reconnecté");
  });
});

socket.on("roomUpdated", (room) => {
  renderRoom(room);
});

socket.on("gameStarted", ({ role, word }) => {
  secretCard.classList.remove("hidden");
  resultCard.classList.add("hidden");
  endCard.classList.add("hidden");

  roleText.textContent = `Rôle : ${role}`;
  wordText.textContent =
    role === "mrwhite" ? "Tu n'as pas de mot." : `Mot : ${word}`;

  setStatus("La partie commence");
});

socket.on("voteResult", (result) => {
  resultCard.classList.remove("hidden");

  if (result.tie) {
    resultText.textContent = "Égalité : personne n'est éliminé.";
  } else {
    resultText.textContent =
      `${result.eliminated.name} est éliminé.` +
      ` Son rôle était ${result.eliminated.role}.`;
  }
});