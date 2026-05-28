/**
 * PixelCouple Backend — server.js
 * Features: Status, Mood Note, Streak, Flowers, Compliments, Canvas, Playlist
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5173", "http://localhost:3000"];

const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_STATE = {
  user_1: {
    id: "user_1",
    name: "Boyfriend",
    status: "Chilling",
    gif_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    location: "Home",
    mood_note: "",
    updated_at: new Date().toISOString(),
    last_seen_date: "",
    canvas: null, // base64 image data
  },
  user_2: {
    id: "user_2",
    name: "Girlfriend",
    status: "Chilling",
    gif_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    location: "Home",
    mood_note: "",
    updated_at: new Date().toISOString(),
    last_seen_date: "",
    canvas: null,
  },
  streak: {
    count: 0,
    last_both_active_date: "",
    user_1_last_date: "",
    user_2_last_date: "",
  },
  pending_flowers: null,
  compliments: {
    user_1_to_2: null,
    user_2_to_1: null,
  },
  // Playlist: array of { id, addedBy, song, artist, youtubeUrl, note, addedAt }
  playlist: [],
};

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const s = JSON.parse(JSON.stringify(DEFAULT_STATE));
      writeState(s);
      return s;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.streak) parsed.streak = DEFAULT_STATE.streak;
    if (!parsed.streak.user_1_last_date) parsed.streak.user_1_last_date = "";
    if (!parsed.streak.user_2_last_date) parsed.streak.user_2_last_date = "";
    if (parsed.pending_flowers === undefined) parsed.pending_flowers = null;
    if (!parsed.compliments) parsed.compliments = DEFAULT_STATE.compliments;
    if (!parsed.user_1.mood_note) parsed.user_1.mood_note = "";
    if (!parsed.user_2.mood_note) parsed.user_2.mood_note = "";
    if (!parsed.user_1.last_seen_date) parsed.user_1.last_seen_date = "";
    if (!parsed.user_2.last_seen_date) parsed.user_2.last_seen_date = "";
    if (parsed.user_1.canvas === undefined) parsed.user_1.canvas = null;
    if (parsed.user_2.canvas === undefined) parsed.user_2.canvas = null;
    if (!parsed.playlist) parsed.playlist = [];
    return parsed;
  } catch (err) {
    console.error("[DB] Failed to read, using defaults:", err.message);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function writeState(state) {
  try {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error("[DB] Failed to write:", err.message);
  }
}

function updateStreak(state, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (userId === "user_1") state.streak.user_1_last_date = today;
  if (userId === "user_2") state.streak.user_2_last_date = today;
  state[userId].last_seen_date = today;
  const u1Today = state.streak.user_1_last_date === today;
  const u2Today = state.streak.user_2_last_date === today;
  if (u1Today && u2Today) {
    const lastBoth = state.streak.last_both_active_date;
    if (lastBoth !== today) {
      if (lastBoth === yesterday) state.streak.count += 1;
      else if (!lastBoth) state.streak.count = 1;
      else state.streak.count = 1;
      state.streak.last_both_active_date = today;
    }
  }
  return state;
}

let appState = readState();
console.log("[DB] Loaded. Status:", appState.user_1.status, "/", appState.user_2.status);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 10000,
  maxHttpBufferSize: 5e6, // 5MB for canvas data
});

app.use(cors({ origin: ALLOWED_ORIGINS, methods: ["GET"] }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/status", (req, res) => res.json(appState));
app.get("/health", (req, res) => res.send("ok"));
app.get("/ping", (req, res) => res.send("pong"));

io.on("connection", (socket) => {
  console.log(`[WS] Connected: ${socket.id}`);
  socket.emit("state_update", appState);

  socket.on("user_active", ({ userId }) => {
    if (!appState[userId]) return;
    appState = updateStreak(appState, userId);
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("update_status", ({ userId, status, gif_url, location }) => {
    if (!appState[userId]) return;
    appState[userId] = { ...appState[userId], status, gif_url, location, updated_at: new Date().toISOString() };
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("update_mood", ({ userId, mood_note }) => {
    if (!appState[userId]) return;
    appState[userId] = { ...appState[userId], mood_note, updated_at: new Date().toISOString() };
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("send_flowers", ({ fromUserId, toUserId }) => {
    appState.pending_flowers = { fromUserId, toUserId, sentAt: new Date().toISOString() };
    writeState(appState);
    io.emit("state_update", appState);
    io.emit("send_flowers", { fromUserId, toUserId });
  });

  socket.on("clear_flowers", () => {
    appState.pending_flowers = null;
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("send_compliment", ({ fromUserId, toUserId, text }) => {
    const key = `${fromUserId}_to_${toUserId.replace("user_", "")}`;
    appState.compliments[key] = { from: fromUserId, to: toUserId, text, sentAt: new Date().toISOString() };
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("dismiss_compliment", ({ key }) => {
    appState.compliments[key] = null;
    writeState(appState);
    io.emit("state_update", appState);
  });

  // Canvas — save drawing (base64 image)
  socket.on("update_canvas", ({ userId, canvasData }) => {
    if (!appState[userId]) return;
    appState[userId] = { ...appState[userId], canvas: canvasData };
    writeState(appState);
    io.emit("state_update", appState);
    console.log(`[WS] 🎨 ${userId} updated canvas`);
  });

  // Clear canvas
  socket.on("clear_canvas", ({ userId }) => {
    if (!appState[userId]) return;
    appState[userId] = { ...appState[userId], canvas: null };
    writeState(appState);
    io.emit("state_update", appState);
  });

  // Add song to playlist
  socket.on("add_song", ({ addedBy, song, artist, youtubeUrl, note }) => {
    const newSong = {
      id: Date.now().toString(),
      addedBy,
      song,
      artist,
      youtubeUrl,
      note,
      addedAt: new Date().toISOString(),
    };
    appState.playlist = [newSong, ...appState.playlist];
    writeState(appState);
    io.emit("state_update", appState);
    console.log(`[WS] 🎵 ${addedBy} added "${song}"`);
  });

  // Delete song — only by person who added it
  socket.on("delete_song", ({ songId, userId }) => {
    const song = appState.playlist.find((s) => s.id === songId);
    if (!song) return;
    if (song.addedBy !== userId) return; // can only delete own songs
    appState.playlist = appState.playlist.filter((s) => s.id !== songId);
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[WS] Disconnected: ${socket.id} — ${reason}`);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Port ${PORT} | Origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
