import "dotenv/config";
import express from "express";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://undercov-production.up.railway.app";
const DEFAULT_TURN_DURATION_MS = 30_000;
const DEFAULT_VOTE_DURATION_MS = 30_000;
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 45;

const app = express();
const server = http.createServer(app);

// ─── SOCKET.IO avec CORS strict ──────────────────────────
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    credentials: true
  }
});

// ─── BASE DE DONNÉES ─────────────────────────────────────
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "game.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_player_id TEXT,
  started INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'lobby',
  round INTEGER NOT NULL DEFAULT 0,
  current_speaker_index INTEGER NOT NULL DEFAULT 0,
  speaking_order TEXT NOT NULL DEFAULT '[]',
  votes TEXT NOT NULL DEFAULT '{}',
  messages TEXT NOT NULL DEFAULT '[]',
  turn_ends_at INTEGER,
  vote_ends_at INTEGER,
  turn_duration_ms INTEGER NOT NULL DEFAULT 30000,
  vote_duration_ms INTEGER NOT NULL DEFAULT 30000,
  selected_category TEXT,
  selected_subcategory TEXT,
  game_over INTEGER NOT NULL DEFAULT 0,
  winner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  player_token TEXT NOT NULL UNIQUE,
  connected INTEGER NOT NULL DEFAULT 0,
  eliminated INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  word TEXT,
  socket_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(room_code) REFERENCES rooms(code)
);
`);

function columnExists(tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

if (!columnExists("rooms", "messages")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN messages TEXT NOT NULL DEFAULT '[]'`);
}
if (!columnExists("rooms", "turn_ends_at")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN turn_ends_at INTEGER`);
}
if (!columnExists("rooms", "vote_ends_at")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN vote_ends_at INTEGER`);
}
if (!columnExists("rooms", "turn_duration_ms")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN turn_duration_ms INTEGER NOT NULL DEFAULT 30000`);
}
if (!columnExists("rooms", "vote_duration_ms")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN vote_duration_ms INTEGER NOT NULL DEFAULT 30000`);
}
if (!columnExists("rooms", "selected_category")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN selected_category TEXT`);
}
if (!columnExists("rooms", "selected_subcategory")) {
  db.exec(`ALTER TABLE rooms ADD COLUMN selected_subcategory TEXT`);
}

// ─── NETTOYAGE DES ROOMS MORTES ──────────────────────────
function cleanupStaleRooms() {
  try {
    // Supprimer les rooms terminées ou en lobby depuis plus de 12h
    db.prepare(`
      DELETE FROM rooms
      WHERE updated_at < datetime('now', '-12 hours')
      AND (game_over = 1 OR started = 0)
    `).run();

    // Supprimer les players sans room valide
    db.prepare(`
      DELETE FROM players
      WHERE room_code NOT IN (SELECT code FROM rooms)
    `).run();

    // Déconnecter les players qui n'ont pas eu d'activité depuis 2h
    db.prepare(`
      UPDATE players SET connected = 0, socket_id = NULL
      WHERE updated_at < datetime('now', '-2 hours')
      AND connected = 1
    `).run();

    console.log(`[cleanup] Rooms mortes nettoyées — ${new Date().toISOString()}`);
  } catch (err) {
    console.error("[cleanup] Erreur :", err.message);
  }
}

// Nettoyage au démarrage puis toutes les heures
cleanupStaleRooms();
setInterval(cleanupStaleRooms, 60 * 60 * 1000);

// ─── RATE LIMITING WEBSOCKET ─────────────────────────────
const socketRateLimits = new Map();

function checkSocketRate(socketId, event, maxPerMinute = 20) {
  const key = `${socketId}:${event}`;
  const now = Date.now();
  const record = socketRateLimits.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 60_000;
  }
  record.count++;
  socketRateLimits.set(key, record);
  return record.count <= maxPerMinute;
}

// Nettoyer la map de rate limit toutes les 5 minutes pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of socketRateLimits.entries()) {
    if (now > record.resetAt) socketRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// ─── MIDDLEWARE HTTP ─────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ─── DONNÉES MOTS ────────────────────────────────────────
const rawWordData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "undercover_word_pairs_1000.json"),
    "utf8"
  )
);

function isValidWordPair(pair) {
  return (
    Array.isArray(pair) &&
    pair.length >= 2 &&
    typeof pair[0] === "string" &&
    typeof pair[1] === "string" &&
    pair[0].trim() &&
    pair[1].trim()
  );
}

function buildWordCatalog(raw) {
  const fallbackCatalog = {
    Sport: {
      Foot: [],
      Basket: []
    },
    "Pop culture": {
      "Animé": [],
      Musique: []
    }
  };

  if (Array.isArray(raw)) {
    return {
      "Toutes catégories": {
        "Général": raw.filter(isValidWordPair)
      }
    };
  }

  const catalog = {};

  if (raw && typeof raw === "object") {
    for (const [categoryName, subcategories] of Object.entries(raw)) {
      if (!subcategories || typeof subcategories !== "object") continue;

      const cleanSubcategories = {};

      for (const [subcategoryName, pairs] of Object.entries(subcategories)) {
        const validPairs = Array.isArray(pairs) ? pairs.filter(isValidWordPair) : [];
        cleanSubcategories[subcategoryName] = validPairs;
      }

      if (Object.keys(cleanSubcategories).length > 0) {
        catalog[categoryName] = cleanSubcategories;
      }
    }
  }

  if (Object.keys(catalog).length === 0) {
    return fallbackCatalog;
  }

  return catalog;
}

const wordCatalog = buildWordCatalog(rawWordData);

const ALL_CATEGORIES_KEY = "Tout";

function getCategoryOptions() {
  const options = [
    { name: ALL_CATEGORIES_KEY, subcategories: [] }
  ];
  for (const [name, subcats] of Object.entries(wordCatalog)) {
    options.push({ name, subcategories: Object.keys(subcats) });
  }
  return options;
}

function getAllWordPairs() {
  const all = [];
  for (const subcats of Object.values(wordCatalog)) {
    for (const pairs of Object.values(subcats)) {
      all.push(...pairs.filter(isValidWordPair));
    }
  }
  return all;
}

function normalizeCategorySelection(category, subcategory) {
  // Option "Tout" : pas de sous-catégorie
  if (category === ALL_CATEGORIES_KEY) {
    return { category: ALL_CATEGORIES_KEY, subcategory: null };
  }

  const categories = Object.keys(wordCatalog);
  if (categories.length === 0) {
    return { category: ALL_CATEGORIES_KEY, subcategory: null };
  }

  const selectedCategory =
    typeof category === "string" && wordCatalog[category]
      ? category
      : ALL_CATEGORIES_KEY;

  if (selectedCategory === ALL_CATEGORIES_KEY) {
    return { category: ALL_CATEGORIES_KEY, subcategory: null };
  }

  const subcategories = Object.keys(wordCatalog[selectedCategory] || {});
  const selectedSubcategory =
    typeof subcategory === "string" &&
    wordCatalog[selectedCategory]?.[subcategory]
      ? subcategory
      : subcategories[0] || null;

  return { category: selectedCategory, subcategory: selectedSubcategory };
}

function getWordPairsForSelection(category, subcategory) {
  if (category === ALL_CATEGORIES_KEY) {
    return getAllWordPairs();
  }
  const selection = normalizeCategorySelection(category, subcategory);
  if (!selection.category || !selection.subcategory) return getAllWordPairs();
  return wordCatalog[selection.category]?.[selection.subcategory] || [];
}

// ─── TIMERS ──────────────────────────────────────────────
const roomTurnTimers = new Map();
const roomVoteTimers = new Map();
const reconnectTimers = new Map(); // timers d'attente de reconnexion (15s)

function nowIso() {
  return new Date().toISOString();
}

function randomString(length = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Joueur";
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 20);
  return cleaned || "Joueur";
}

function sanitizeChatMessage(text) {
  if (typeof text !== "string") return "";
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned.split(" ")[0].slice(0, 24);
}

function normalizeWord(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── DB HELPERS ──────────────────────────────────────────
function getRoom(code) {
  return db.prepare("SELECT * FROM rooms WHERE code = ?").get(code);
}

function getPlayersByRoom(code) {
  return db
    .prepare("SELECT * FROM players WHERE room_code = ? ORDER BY created_at ASC")
    .all(code);
}

function getVisiblePlayersByRoom(code) {
  return getPlayersByRoom(code).filter((p) => p.connected);
}

function getPlayerBySocket(socketId) {
  return db.prepare("SELECT * FROM players WHERE socket_id = ?").get(socketId);
}

function getPlayerByToken(playerToken) {
  return db.prepare("SELECT * FROM players WHERE player_token = ?").get(playerToken);
}

function normalizeDurationSeconds(value, fallbackSeconds = 30) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallbackSeconds;
  return Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, parsed));
}

function normalizeGameSettings(settings = {}, room = null) {
  const selection = normalizeCategorySelection(
    settings.category ?? room?.selected_category,
    settings.subcategory ?? room?.selected_subcategory
  );

  const turnSeconds = normalizeDurationSeconds(
    settings.turnDurationSeconds,
    room?.turn_duration_ms ? Math.round(room.turn_duration_ms / 1000) : 30
  );

  const voteSeconds = normalizeDurationSeconds(
    settings.voteDurationSeconds,
    room?.vote_duration_ms ? Math.round(room.vote_duration_ms / 1000) : 30
  );

  return {
    turnDurationMs: turnSeconds * 1000,
    voteDurationMs: voteSeconds * 1000,
    category: selection.category,
    subcategory: selection.subcategory
  };
}

function updateRoom(code, patch) {
  const room = getRoom(code);
  if (!room) return;

  const next = { ...room, ...patch, updated_at: nowIso() };

  db.prepare(`
    UPDATE rooms
    SET host_player_id = ?,
        started = ?,
        phase = ?,
        round = ?,
        current_speaker_index = ?,
        speaking_order = ?,
        votes = ?,
        messages = ?,
        turn_ends_at = ?,
        vote_ends_at = ?,
        turn_duration_ms = ?,
        vote_duration_ms = ?,
        selected_category = ?,
        selected_subcategory = ?,
        game_over = ?,
        winner = ?,
        updated_at = ?
    WHERE code = ?
  `).run(
    next.host_player_id,
    next.started,
    next.phase,
    next.round,
    next.current_speaker_index,
    next.speaking_order,
    next.votes,
    next.messages,
    next.turn_ends_at,
    next.vote_ends_at,
    next.turn_duration_ms,
    next.vote_duration_ms,
    next.selected_category,
    next.selected_subcategory,
    next.game_over,
    next.winner,
    next.updated_at,
    code
  );
}

function updatePlayer(id, patch) {
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
  if (!player) return;

  const next = { ...player, ...patch, updated_at: nowIso() };

  db.prepare(`
    UPDATE players
    SET name = ?,
        connected = ?,
        eliminated = ?,
        role = ?,
        word = ?,
        socket_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    next.name,
    next.connected,
    next.eliminated,
    next.role,
    next.word,
    next.socket_id,
    next.updated_at,
    id
  );
}

function getAlivePlayers(roomCode) {
  return getPlayersByRoom(roomCode).filter((p) => !p.eliminated);
}

function buildSpeakingOrderFromAlive(roomCode) {
  const alivePlayers = shuffle(getAlivePlayers(roomCode));

  if (alivePlayers.length <= 1) {
    return alivePlayers.map((p) => p.id);
  }

  if (alivePlayers[0]?.role === "mrwhite") {
    const swapIndex = alivePlayers.findIndex((p) => p.role !== "mrwhite");
    if (swapIndex > 0) {
      [alivePlayers[0], alivePlayers[swapIndex]] = [alivePlayers[swapIndex], alivePlayers[0]];
    }
  }

  return alivePlayers.map((p) => p.id);
}

function getCurrentSpeakerId(room) {
  const speakingOrder = safeJsonParse(room.speaking_order, []);
  return speakingOrder[room.current_speaker_index] || null;
}

function countConfiguredRoles(roomCode) {
  const allPlayers = getPlayersByRoom(roomCode);
  return {
    civil: allPlayers.filter((p) => p.role === "civil").length,
    undercover: allPlayers.filter((p) => p.role === "undercover").length,
    mrwhite: allPlayers.filter((p) => p.role === "mrwhite").length
  };
}

function buildPublicRoom(code) {
  const room = getRoom(code);
  if (!room) return null;

  const players = getVisiblePlayersByRoom(code);
  const allPlayers = getPlayersByRoom(code);
  const currentSpeakerId = getCurrentSpeakerId(room);
  const messages = safeJsonParse(room.messages, []);
  const votes = safeJsonParse(room.votes, {});
  const speakingOrder = safeJsonParse(room.speaking_order, []);
  const categoryOptions = getCategoryOptions();
  const roleComposition = countConfiguredRoles(code);

  return {
    code: room.code,
    hostPlayerId: room.host_player_id,
    started: Boolean(room.started),
    phase: room.phase,
    round: room.round,
    currentSpeakerId,
    speakingOrder,
    turnEndsAt: room.turn_ends_at,
    voteEndsAt: room.vote_ends_at,
    turnDurationMs: room.turn_duration_ms || DEFAULT_TURN_DURATION_MS,
    voteDurationMs: room.vote_duration_ms || DEFAULT_VOTE_DURATION_MS,
    turnDurationSeconds: Math.round((room.turn_duration_ms || DEFAULT_TURN_DURATION_MS) / 1000),
    voteDurationSeconds: Math.round((room.vote_duration_ms || DEFAULT_VOTE_DURATION_MS) / 1000),
    selectedCategory: room.selected_category,
    selectedSubcategory: room.selected_subcategory,
    categoryOptions,
    roleComposition,
    gameOver: Boolean(room.game_over),
    winner: room.winner,
    gameId: `${room.code}-${room.round}-${room.winner || "ongoing"}`,
    messages,
    voteCount: Object.keys(votes).length,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: Boolean(p.connected),
      eliminated: Boolean(p.eliminated)
    })),
    reveal: room.game_over
      ? allPlayers
          .filter((p) => p.role)
          .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            word: p.word,
            eliminated: Boolean(p.eliminated)
          }))
      : null
  };
}

function emitRoom(roomCode) {
  const publicRoom = buildPublicRoom(roomCode);
  if (!publicRoom) return;
  io.to(roomCode).emit("roomUpdated", publicRoom);
}

function clearTurnTimer(roomCode) {
  const timer = roomTurnTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    roomTurnTimers.delete(roomCode);
  }
}

function clearVoteTimer(roomCode) {
  const timer = roomVoteTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    roomVoteTimers.delete(roomCode);
  }
}

function clearAllRoomTimers(roomCode) {
  clearTurnTimer(roomCode);
  clearVoteTimer(roomCode);
  clearReconnectTimer(roomCode);
}

function clearReconnectTimer(playerId) {
  const timer = reconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(playerId);
  }
}

function pushSystemMessage(roomCode, text) {
  const room = getRoom(roomCode);
  if (!room) return;

  const messages = safeJsonParse(room.messages, []);
  messages.push({
    id: randomString(10),
    playerId: null,
    playerName: "Système",
    text,
    round: room.round,
    createdAt: nowIso()
  });

  updateRoom(room.code, { messages: JSON.stringify(messages) });
}

function roundHasAtLeastOnePlayerMessage(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return false;

  const messages = safeJsonParse(room.messages, []);
  return messages.some((msg) => msg.round === room.round && msg.playerId);
}

function endGameBecauseNoClue(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.game_over) return;

  clearAllRoomTimers(roomCode);

  pushSystemMessage(
    roomCode,
    "Aucun indice n'a été envoyé pendant toute la manche. La partie est arrêtée."
  );

  updateRoom(roomCode, {
    game_over: 1,
    phase: "finished",
    turn_ends_at: null,
    vote_ends_at: null,
    winner: "aucun"
  });
}

function scheduleTurnTimer(roomCode) {
  clearTurnTimer(roomCode);

  const room = getRoom(roomCode);
  if (!room || room.phase !== "speaking" || room.game_over) return;

  const durationMs = room.turn_duration_ms || DEFAULT_TURN_DURATION_MS;
  const turnEndsAt = Date.now() + durationMs;

  updateRoom(roomCode, { turn_ends_at: turnEndsAt, vote_ends_at: null });
  emitRoom(roomCode);

  const timeout = setTimeout(() => {
    handleTurnTimeout(roomCode);
  }, durationMs);

  roomTurnTimers.set(roomCode, timeout);
}

function scheduleVoteTimer(roomCode) {
  clearVoteTimer(roomCode);

  const room = getRoom(roomCode);
  if (!room || room.phase !== "voting" || room.game_over) return;

  const durationMs = room.vote_duration_ms || DEFAULT_VOTE_DURATION_MS;
  const voteEndsAt = Date.now() + durationMs;

  updateRoom(roomCode, { turn_ends_at: null, vote_ends_at: voteEndsAt });
  emitRoom(roomCode);

  const timeout = setTimeout(() => {
    finishVotingNow(roomCode);
  }, durationMs);

  roomVoteTimers.set(roomCode, timeout);
}

function normalizeComposition(playerCount, rawComposition) {
  if (playerCount < 3) return null;

  if (playerCount === 3) {
    return { undercoverCount: 1, mrwhiteCount: 0, civilCount: 2 };
  }

  const undercoverCount = Number.parseInt(rawComposition?.undercoverCount, 10);
  const mrwhiteCount = Number.parseInt(rawComposition?.mrwhiteCount, 10);

  if (!Number.isInteger(undercoverCount) || undercoverCount < 1) return null;
  if (!Number.isInteger(mrwhiteCount) || ![0, 1].includes(mrwhiteCount)) return null;

  const civilCount = playerCount - undercoverCount - mrwhiteCount;
  if (civilCount < 1) return null;

  return { undercoverCount, mrwhiteCount, civilCount };
}

function assignRoles(roomCode, composition, settings = {}) {
  const room = getRoom(roomCode);
  if (!room) throw new Error("Room introuvable");

  const players = shuffle(getPlayersByRoom(roomCode));
  const normalized = normalizeComposition(players.length, composition);

  if (!normalized) throw new Error("Composition invalide");

  const normalizedSettings = normalizeGameSettings(settings, room);
  const availablePairs = getWordPairsForSelection(
    normalizedSettings.category,
    normalizedSettings.subcategory
  );

  if (!Array.isArray(availablePairs) || availablePairs.length === 0) {
    throw new Error("Aucune paire de mots disponible dans cette sous-catégorie");
  }

  const pair = availablePairs[Math.floor(Math.random() * availablePairs.length)];
  const [civilWord, undercoverWord] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];

  players.forEach((player, index) => {
    let role = "civil";
    let word = civilWord;

    if (index < normalized.undercoverCount) {
      role = "undercover";
      word = undercoverWord;
    } else if (index < normalized.undercoverCount + normalized.mrwhiteCount) {
      role = "mrwhite";
      word = null;
    }

    updatePlayer(player.id, { eliminated: 0, role, word });
  });

  const speakingOrder = buildSpeakingOrderFromAlive(roomCode);

  updateRoom(roomCode, {
    started: 1,
    phase: "speaking",
    round: 1,
    current_speaker_index: 0,
    speaking_order: JSON.stringify(speakingOrder),
    votes: JSON.stringify({}),
    messages: JSON.stringify([]),
    turn_ends_at: null,
    vote_ends_at: null,
    turn_duration_ms: normalizedSettings.turnDurationMs,
    vote_duration_ms: normalizedSettings.voteDurationMs,
    selected_category: normalizedSettings.category,
    selected_subcategory: normalizedSettings.subcategory,
    game_over: 0,
    winner: null
  });

  scheduleTurnTimer(roomCode);
}

function startNewRound(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  const speakingOrder = buildSpeakingOrderFromAlive(roomCode);

  updateRoom(roomCode, {
    phase: "speaking",
    round: room.round + 1,
    current_speaker_index: 0,
    speaking_order: JSON.stringify(speakingOrder),
    votes: JSON.stringify({}),
    messages: JSON.stringify([]),
    turn_ends_at: null,
    vote_ends_at: null
  });

  scheduleTurnTimer(roomCode);
}

function countAliveByRole(roomCode) {
  const alive = getAlivePlayers(roomCode);
  return {
    civil: alive.filter((p) => p.role === "civil").length,
    undercover: alive.filter((p) => p.role === "undercover").length,
    mrwhite: alive.filter((p) => p.role === "mrwhite").length
  };
}

function checkWin(roomCode) {
  const counts = countAliveByRole(roomCode);

  if (counts.undercover === 0 && counts.mrwhite === 0) {
    clearAllRoomTimers(roomCode);
    updateRoom(roomCode, {
      game_over: 1, phase: "finished",
      turn_ends_at: null, vote_ends_at: null, winner: "civils"
    });
    return true;
  }

  if (counts.undercover > 0 && counts.civil <= counts.undercover) {
    clearAllRoomTimers(roomCode);
    updateRoom(roomCode, {
      game_over: 1, phase: "finished",
      turn_ends_at: null, vote_ends_at: null, winner: "undercover"
    });
    return true;
  }

  if (counts.mrwhite > 0 && counts.civil + counts.undercover === 1) {
    clearAllRoomTimers(roomCode);
    updateRoom(roomCode, {
      game_over: 1, phase: "finished",
      turn_ends_at: null, vote_ends_at: null, winner: "mrwhite"
    });
    return true;
  }

  return false;
}

function eliminateFromVotes(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return { tie: true, eliminated: null };

  const votes = safeJsonParse(room.votes, {});
  const tally = {};

  for (const voterId of Object.keys(votes)) {
    const targetId = votes[voterId];
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  let maxVotes = 0;
  let topPlayers = [];

  for (const targetId of Object.keys(tally)) {
    const count = tally[targetId];
    if (count > maxVotes) {
      maxVotes = count;
      topPlayers = [targetId];
    } else if (count === maxVotes) {
      topPlayers.push(targetId);
    }
  }

  if (topPlayers.length !== 1) return { tie: true, eliminated: null };

  const eliminated = db.prepare("SELECT * FROM players WHERE id = ?").get(topPlayers[0]);
  if (!eliminated) return { tie: true, eliminated: null };

  updatePlayer(eliminated.id, { eliminated: 1 });

  return {
    tie: false,
    eliminated: { id: eliminated.id, name: eliminated.name, role: eliminated.role }
  };
}

function sendSecrets(roomCode) {
  const players = getPlayersByRoom(roomCode);
  players.forEach((player) => {
    if (player.socket_id) {
      io.to(player.socket_id).emit("gameStarted", { word: player.word });
    }
  });
}

function sendSecretToPlayer(player) {
  if (!player?.socket_id) return;
  io.to(player.socket_id).emit("sessionResumed", { word: player.word });
}

function requirePlayer(socket, callback) {
  const player = getPlayerBySocket(socket.id);
  if (!player) {
    callback?.({ ok: false, error: "Session invalide" });
    return null;
  }
  return player;
}

function isHost(player, room) {
  return room.host_player_id === player.id;
}

function startVotingPhase(roomCode) {
  clearTurnTimer(roomCode);

  const room = getRoom(roomCode);
  if (!room) return;

  if (!roundHasAtLeastOnePlayerMessage(roomCode)) {
    endGameBecauseNoClue(roomCode);
    emitRoom(roomCode);
    return;
  }

  updateRoom(roomCode, { phase: "voting", turn_ends_at: null, vote_ends_at: null });
  scheduleVoteTimer(roomCode);
}

function advanceTurn(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  const order = safeJsonParse(room.speaking_order, []);
  const nextIndex = room.current_speaker_index + 1;

  if (nextIndex >= order.length) {
    updateRoom(room.code, { current_speaker_index: nextIndex });
    startVotingPhase(room.code);
    return;
  }

  updateRoom(room.code, { current_speaker_index: nextIndex, turn_ends_at: null });
  scheduleTurnTimer(room.code);
}

function handleTurnTimeout(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.phase !== "speaking" || room.game_over) return;

  const currentSpeakerId = getCurrentSpeakerId(room);
  if (!currentSpeakerId) return;

  const currentPlayer = db.prepare("SELECT * FROM players WHERE id = ?").get(currentSpeakerId);

  const messages = safeJsonParse(room.messages, []);
  const alreadySentThisTurn = messages.some(
    (msg) => msg.round === room.round && msg.playerId === currentSpeakerId
  );

  if (currentPlayer && !alreadySentThisTurn) {
    pushSystemMessage(roomCode, `${currentPlayer.name} n'a rien envoyé.`);
  }

  emitRoom(roomCode);
  advanceTurn(roomCode);
}

function finishVotingNow(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.phase !== "voting") return;

  clearVoteTimer(roomCode);

  const result = eliminateFromVotes(room.code);
  io.to(room.code).emit("voteResult", result);

  if (!result.tie && checkWin(room.code)) {
    emitRoom(room.code);
    return;
  }

  startNewRound(room.code);
  emitRoom(room.code);
}

function everyoneAliveHasVoted(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return false;

  const votes = safeJsonParse(room.votes, {});
  const alive = getAlivePlayers(roomCode);
  return Object.keys(votes).length >= alive.length;
}

function handlePlayerDeparture(playerId, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(playerId);
  if (!player) return;

  // Toujours marquer déconnecté
  updatePlayer(player.id, { connected: 0, socket_id: null });

  const players = getPlayersByRoom(room.code);
  const connectedPlayers = players.filter((p) => p.connected);

  // Plus personne → supprimer la room
  if (connectedPlayers.length === 0) {
    clearAllRoomTimers(room.code);
    db.prepare("DELETE FROM players WHERE room_code = ?").run(room.code);
    db.prepare("DELETE FROM rooms WHERE code = ?").run(room.code);
    return;
  }

  // Partie en cours → attendre 15s avant de traiter le départ
  if (room.started && !room.game_over) {

    // Annuler un éventuel timer de reconnexion existant pour ce joueur
    clearReconnectTimer(playerId);

    // Démarrer un timer de 15s pour attendre la reconnexion
    const timer = setTimeout(() => {
      reconnectTimers.delete(playerId);
      handlePlayerFinalDeparture(playerId, roomCode);
    }, 15_000);

    reconnectTimers.set(playerId, timer);

    emitRoom(room.code);
    return;
  }

  // Pas de partie en cours (lobby ou fin) → supprimer le joueur définitivement
  db.prepare("DELETE FROM players WHERE id = ?").run(player.id);

  // Réassigner l'hôte si nécessaire
  if (room.host_player_id === player.id) {
    const remaining = connectedPlayers.filter((p) => p.id !== player.id);
    if (remaining.length > 0) {
      updateRoom(room.code, { host_player_id: remaining[0].id });
    }
  }

  emitRoom(room.code);
}

// Appelée après 15s si le joueur ne s'est pas reconnecté
function handlePlayerFinalDeparture(playerId, roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.game_over) return;

  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(playerId);
  if (!player || player.connected) return; // Le joueur s'est reconnecté entre-temps

  const players = getPlayersByRoom(room.code);
  const connectedPlayers = players.filter((p) => p.connected);

  // Plus personne → supprimer la room
  if (connectedPlayers.length === 0) {
    clearAllRoomTimers(room.code);
    db.prepare("DELETE FROM players WHERE room_code = ?").run(room.code);
    db.prepare("DELETE FROM rooms WHERE code = ?").run(room.code);
    return;
  }

  // Vérifier s'il reste assez de joueurs connectés vivants
  const connectedAlive = players.filter((p) => p.connected && !p.eliminated);
  if (connectedAlive.length <= 1) {
    clearAllRoomTimers(room.code);
    pushSystemMessage(room.code, "Plus assez de joueurs connectés. La partie est arrêtée.");
    updateRoom(room.code, {
      game_over: 1,
      phase: "finished",
      turn_ends_at: null,
      vote_ends_at: null,
      winner: "aucun"
    });
    emitRoom(room.code);
    return;
  }

  // Avancer le tour si c'était ce joueur qui devait parler
  const freshRoom = getRoom(roomCode);
  const currentSpeakerId = getCurrentSpeakerId(freshRoom);
  if (freshRoom.phase === "speaking" && currentSpeakerId === player.id) {
    pushSystemMessage(room.code, `${player.name} a quitté la partie.`);
    advanceTurn(room.code);
    return;
  }

  // Retirer son vote si phase de vote
  if (freshRoom.phase === "voting") {
    const votes = safeJsonParse(freshRoom.votes, {});
    delete votes[player.id];
    updateRoom(room.code, { votes: JSON.stringify(votes) });
    if (everyoneAliveHasVoted(room.code)) {
      finishVotingNow(room.code);
      return;
    }
  }

  emitRoom(room.code);
}

function removeSocketFromPreviousRoom(socket) {
  const existingPlayer = getPlayerBySocket(socket.id);
  if (!existingPlayer) return;

  socket.leave(existingPlayer.room_code);
  handlePlayerDeparture(existingPlayer.id, existingPlayer.room_code);
}

function findDisconnectedPlayerByName(roomCode, name) {
  const cleanName = sanitizeName(name).toLowerCase();
  return getPlayersByRoom(roomCode).find(
    (p) => !p.connected && p.name.trim().toLowerCase() === cleanName
  );
}

// ─── SOCKET.IO EVENTS ────────────────────────────────────
io.on("connection", (socket) => {

  socket.on("checkSession", ({ playerToken, roomCode }, callback) => {
    try {
      if (!playerToken || !roomCode) {
        return callback?.({ ok: false, error: "Session invalide" });
      }

      const player = getPlayerByToken(playerToken);
      if (!player) return callback?.({ ok: false, error: "Session introuvable" });

      const room = getRoom(String(roomCode).toUpperCase().trim());
      if (!room || player.room_code !== room.code) {
        return callback?.({ ok: false, error: "Room introuvable" });
      }

      callback?.({ ok: true, roomCode: room.code, playerId: player.id });
    } catch {
      callback?.({ ok: false, error: "Impossible de vérifier la session" });
    }
  });

  socket.on("resumeSession", ({ playerToken }, callback) => {
    try {
      if (!playerToken) return callback?.({ ok: false, error: "Token manquant" });

      const player = getPlayerByToken(playerToken);
      if (!player) return callback?.({ ok: false, error: "Session introuvable" });

      const room = getRoom(player.room_code);
      if (!room) return callback?.({ ok: false, error: "Room introuvable" });

      updatePlayer(player.id, { connected: 1, socket_id: socket.id });
      clearReconnectTimer(player.id); // Annuler le timer de reconnexion si le joueur revient
      socket.join(player.room_code);

      const freshPlayer = getPlayerByToken(playerToken);

      if (room.started && !room.game_over) {
        sendSecretToPlayer(freshPlayer);
      }

      emitRoom(player.room_code);

      callback?.({
        ok: true,
        room: buildPublicRoom(player.room_code),
        playerId: player.id,
        playerToken: player.player_token
      });
    } catch {
      callback?.({ ok: false, error: "Impossible de reprendre la session" });
    }
  });

  socket.on("createRoom", ({ name }, callback) => {
    // Rate limit : max 5 créations de room par minute par socket
    if (!checkSocketRate(socket.id, "createRoom", 5)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    try {
      removeSocketFromPreviousRoom(socket);

      let code = randomCode();
      while (getRoom(code)) code = randomCode();

      const playerId = randomString(16);
      const playerToken = randomString(32);
      const createdAt = nowIso();
      const defaultSettings = normalizeGameSettings({});

      db.prepare(`
        INSERT INTO rooms (
          code, host_player_id, started, phase, round, current_speaker_index,
          speaking_order, votes, messages, turn_ends_at, vote_ends_at,
          turn_duration_ms, vote_duration_ms, selected_category, selected_subcategory,
          game_over, winner, created_at, updated_at
        ) VALUES (?, ?, 0, 'lobby', 0, 0, '[]', '{}', '[]', NULL, NULL, ?, ?, ?, ?, 0, NULL, ?, ?)
      `).run(
        code, playerId,
        defaultSettings.turnDurationMs, defaultSettings.voteDurationMs,
        defaultSettings.category, defaultSettings.subcategory,
        createdAt, createdAt
      );

      db.prepare(`
        INSERT INTO players (
          id, room_code, name, player_token, connected, eliminated,
          role, word, socket_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, NULL, NULL, ?, ?, ?)
      `).run(playerId, code, sanitizeName(name), playerToken, socket.id, createdAt, createdAt);

      socket.join(code);

      callback({ ok: true, room: buildPublicRoom(code), playerToken, playerId });
    } catch {
      callback({ ok: false, error: "Impossible de créer la room" });
    }
  });

  socket.on("joinRoom", ({ name, code, playerToken }, callback) => {
    // Rate limit : max 10 tentatives de join par minute par socket
    if (!checkSocketRate(socket.id, "joinRoom", 10)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    try {
      removeSocketFromPreviousRoom(socket);

      const roomCode = String(code || "").toUpperCase().trim();
      const cleanName = sanitizeName(name);
      const room = getRoom(roomCode);

      if (!room) return callback({ ok: false, error: "Room introuvable" });

      const tokenPlayer = playerToken ? getPlayerByToken(playerToken) : null;

      if (tokenPlayer && tokenPlayer.room_code === roomCode) {
        updatePlayer(tokenPlayer.id, { name: cleanName, connected: 1, socket_id: socket.id });
        socket.join(roomCode);

        const freshPlayer = db.prepare("SELECT * FROM players WHERE id = ?").get(tokenPlayer.id);

        if (room.started && !room.game_over) {
          sendSecretToPlayer(freshPlayer);
        }

        emitRoom(roomCode);

        return callback({
          ok: true,
          room: buildPublicRoom(roomCode),
          playerToken: freshPlayer.player_token,
          playerId: freshPlayer.id
        });
      }

      if (room.started && !room.game_over) {
        return callback({
          ok: false,
          error: "La partie est déjà en cours. Seuls les anciens joueurs peuvent revenir."
        });
      }

      const reusableDisconnectedPlayer = findDisconnectedPlayerByName(roomCode, cleanName);

      if (reusableDisconnectedPlayer) {
        updatePlayer(reusableDisconnectedPlayer.id, {
          name: cleanName, connected: 1, socket_id: socket.id
        });
        socket.join(roomCode);
        emitRoom(roomCode);

        return callback({
          ok: true,
          room: buildPublicRoom(roomCode),
          playerToken: reusableDisconnectedPlayer.player_token,
          playerId: reusableDisconnectedPlayer.id
        });
      }

      const players = getPlayersByRoom(roomCode);
      if (players.length >= 12) return callback({ ok: false, error: "La room est pleine" });

      const playerId = randomString(16);
      const newPlayerToken = randomString(32);
      const createdAt = nowIso();

      db.prepare(`
        INSERT INTO players (
          id, room_code, name, player_token, connected, eliminated,
          role, word, socket_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, NULL, NULL, ?, ?, ?)
      `).run(playerId, roomCode, cleanName, newPlayerToken, socket.id, createdAt, createdAt);

      socket.join(roomCode);
      emitRoom(roomCode);

      callback({ ok: true, room: buildPublicRoom(roomCode), playerToken: newPlayerToken, playerId });
    } catch {
      callback({ ok: false, error: "Impossible de rejoindre la room" });
    }
  });

  socket.on("startGame", ({ composition, settings } = {}, callback) => {
    // Rate limit : max 5 lancements par minute par socket
    if (!checkSocketRate(socket.id, "startGame", 5)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    const player = requirePlayer(socket, callback);
    if (!player) return;

    const room = getRoom(player.room_code);
    if (!room) return callback({ ok: false, error: "Room introuvable" });
    if (!isHost(player, room)) return callback({ ok: false, error: "Seul l'hôte peut lancer" });

    const players = getPlayersByRoom(player.room_code);
    if (players.length < 3) return callback({ ok: false, error: "Il faut au moins 3 joueurs" });

    const normalized = normalizeComposition(players.length, composition);
    if (!normalized) return callback({ ok: false, error: "Composition invalide" });

    try {
      assignRoles(player.room_code, normalized, settings);
      sendSecrets(player.room_code);
      emitRoom(player.room_code);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error?.message || "Impossible de lancer la partie" });
    }
  });

  socket.on("restartGame", ({ composition, settings } = {}, callback) => {
    // Rate limit : max 5 relances par minute par socket
    if (!checkSocketRate(socket.id, "restartGame", 5)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    const player = requirePlayer(socket, callback);
    if (!player) return;

    const room = getRoom(player.room_code);
    if (!room) return callback({ ok: false, error: "Room introuvable" });
    if (!isHost(player, room)) return callback({ ok: false, error: "Seul l'hôte peut relancer" });

    const players = getPlayersByRoom(player.room_code);
    const normalized = normalizeComposition(players.length, composition);
    if (!normalized) return callback({ ok: false, error: "Composition invalide" });

    try {
      assignRoles(room.code, normalized, settings);
      sendSecrets(room.code);
      emitRoom(room.code);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error?.message || "Impossible de relancer la partie" });
    }
  });

  // Retour au lobby entre deux parties pour que l'hôte puisse changer la config
  socket.on("returnToLobby", (_, callback) => {
    if (!checkSocketRate(socket.id, "returnToLobby", 5)) {
      return callback?.({ ok: false, error: "Trop de requêtes" });
    }

    const player = requirePlayer(socket, callback);
    if (!player) return;

    const room = getRoom(player.room_code);
    if (!room) return callback?.({ ok: false, error: "Room introuvable" });
    if (!isHost(player, room)) return callback?.({ ok: false, error: "Seul l'hôte peut faire ça" });
    if (!room.game_over) return callback?.({ ok: false, error: "La partie n'est pas terminée" });

    // Remettre la room en état de lobby
    updateRoom(room.code, {
      started: 0,
      phase: "lobby",
      round: 0,
      current_speaker_index: 0,
      speaking_order: JSON.stringify([]),
      votes: JSON.stringify({}),
      messages: JSON.stringify([]),
      turn_ends_at: null,
      vote_ends_at: null,
      game_over: 0,
      winner: null
    });

    // Réinitialiser les rôles et mots des joueurs
    const players = getPlayersByRoom(room.code);
    players.forEach(p => {
      db.prepare("UPDATE players SET role = NULL, word = NULL, eliminated = 0 WHERE id = ?").run(p.id);
    });

    emitRoom(room.code);
    callback?.({ ok: true });
  });

  socket.on("sendTurnMessage", ({ text }, callback) => {
    // Rate limit : max 10 messages par minute par socket
    if (!checkSocketRate(socket.id, "sendTurnMessage", 10)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    const player = requirePlayer(socket, callback);
    if (!player) return;

    const room = getRoom(player.room_code);
    if (!room) return callback({ ok: false, error: "Room introuvable" });
    if (room.phase !== "speaking") return callback({ ok: false, error: "Le chat est fermé" });
    if (player.eliminated) return callback({ ok: false, error: "Tu es éliminé" });

    const currentSpeakerId = getCurrentSpeakerId(room);
    if (player.id !== currentSpeakerId) return callback({ ok: false, error: "Ce n'est pas ton tour" });

    const cleanText = sanitizeChatMessage(text);
    if (!cleanText) return callback({ ok: false, error: "Message vide" });

    if (player.word && normalizeWord(cleanText) === normalizeWord(player.word)) {
      return callback({ ok: false, error: "Tu ne peux pas écrire ton mot secret" });
    }

    const messages = safeJsonParse(room.messages, []);
    const alreadySentThisTurn = messages.some(
      (msg) => msg.round === room.round && msg.playerId === player.id
    );

    if (alreadySentThisTurn) {
      return callback({ ok: false, error: "Tu as déjà envoyé ton indice pour ce tour" });
    }

    messages.push({
      id: randomString(10),
      playerId: player.id,
      playerName: player.name,
      text: cleanText,
      round: room.round,
      createdAt: nowIso()
    });

    updateRoom(room.code, { messages: JSON.stringify(messages) });
    emitRoom(room.code);
    callback({ ok: true });

    advanceTurn(room.code);
  });

  socket.on("votePlayer", ({ targetId }, callback) => {
    // Rate limit : max 10 votes par minute par socket
    if (!checkSocketRate(socket.id, "votePlayer", 10)) {
      return callback({ ok: false, error: "Trop de requêtes, attends un moment" });
    }

    const player = requirePlayer(socket, callback);
    if (!player) return;

    const room = getRoom(player.room_code);
    if (!room) return callback({ ok: false, error: "Room introuvable" });
    if (room.phase !== "voting") return callback({ ok: false, error: "Vote fermé" });
    if (player.eliminated) return callback({ ok: false, error: "Tu es éliminé" });

    const target = db
      .prepare("SELECT * FROM players WHERE id = ? AND room_code = ?")
      .get(targetId, room.code);

    if (!target || target.eliminated || !target.connected) {
      return callback({ ok: false, error: "Cible invalide" });
    }

    if (target.id === player.id) {
      return callback({ ok: false, error: "Tu ne peux pas voter contre toi-même" });
    }

    const votes = safeJsonParse(room.votes, {});
    votes[player.id] = target.id;

    updateRoom(room.code, { votes: JSON.stringify(votes) });
    emitRoom(room.code);
    callback({ ok: true });

    if (everyoneAliveHasVoted(room.code)) {
      finishVotingNow(room.code);
    }
  });

  socket.on("leaveRoom", (_, callback) => {
    const player = getPlayerBySocket(socket.id);
    if (!player) {
      callback?.({ ok: true });
      return;
    }

    socket.leave(player.room_code);
    handlePlayerDeparture(player.id, player.room_code);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const player = getPlayerBySocket(socket.id);
    if (!player) return;
    handlePlayerDeparture(player.id, player.room_code);
  });
});

// ─── DÉMARRAGE ───────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
  console.log(`CORS autorisé pour : ${ALLOWED_ORIGIN}`);
  console.log(`Environnement : ${process.env.NODE_ENV}`);
});