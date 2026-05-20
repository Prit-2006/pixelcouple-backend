/**
 * PixelCouple Backend — server.js
 * Features: Status, Mood Note, Daily Streak
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
    last_seen_date: new Date().toISOString().slice(0, 10),
  },
  user_2: {
    id: "user_2",
    name: "Girlfriend",
    status: "Chilling",
    gif_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    location: "Home",
    mood_note: "",
    updated_at: new Date().toISOString(),
    last_seen_date: new Date().toISOString().slice(0, 10),
  },
  streak: {
    count: 0,
    last_both_active_date: "",
  },
};

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return JSON.parse(JSON.stringify(DEFAULT_STATE));
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // make sure streak and mood_note exist on old saves
    if (!parsed.streak) parsed.streak = { count: 0, last_both_active_date: "" };
    if (!parsed.user_1.mood_note) parsed.user_1.mood_note = "";
    if (!parsed.user_2.mood_note) parsed.user_2.mood_note = "";
    if (!parsed.user_1.last_seen_date) parsed.user_1.last_seen_date = "";
    if (!parsed.user_2.last_seen_date) parsed.user_2.last_seen_date = "";
    return parsed;
  } catch (err) {
    console.error("[DB] Failed to read data.json, using defaults:", err.message);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function writeState(state) {
  try {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error("[DB] Failed to write data.json:", err.message);
  }
}

// Updates streak when a user opens/connects
function updateStreak(state, userId) {
  const today = new Date().toISOString().slice(0, 10);
  state[userId].last_seen_date = today;

  const u1Today = state.user_1.last_seen_date === today;
  const u2Today = state.user_2.last_seen_date === today;

  if (u1Today && u2Today) {
    const lastBoth = state.streak.last_both_active_date;
    if (lastBoth !== today) {
      // Check if yesterday both were active (streak continues)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (lastBoth === yesterday) {
        state.streak.count += 1;
      } else if (lastBoth === "") {
        state.streak.count = 1;
      } else {
        // Streak broken
        state.streak.count = 1;
      }
      state.streak.last_both_active_date = today;
    }
  }
  return state;
}

let appState = readState();
console.log("[DB] State loaded from disk:", appState);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.use(cors({ origin: ALLOWED_ORIGINS, methods: ["GET"] }));
app.use(express.json());

app.get("/api/status", (req, res) => {
  res.json(appState);
});

app.get("/health", (req, res) => res.send("ok"));

io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.emit("state_update", appState);

  // User opened the app — update their last_seen and recalculate streak
  socket.on("user_active", (payload) => {
    const { userId } = payload;
    if (!appState[userId]) return;
    appState = updateStreak(appState, userId);
    writeState(appState);
    io.emit("state_update", appState);
  });

  socket.on("update_status", (payload) => {
    const { userId, status, gif_url, location } = payload;
    if (!appState[userId]) return;

    appState[userId] = {
      ...appState[userId],
      status,
      gif_url,
      location,
      updated_at: new Date().toISOString(),
    };

    writeState(appState);
    console.log(`[WS] ${userId} updated → ${status} @ ${location}`);
    io.emit("state_update", appState);
  });

  // New: update mood note
  socket.on("update_mood", (payload) => {
    const { userId, mood_note } = payload;
    if (!appState[userId]) return;

    appState[userId] = {
      ...appState[userId],
      mood_note,
      updated_at: new Date().toISOString(),
    };

    writeState(appState);
    console.log(`[WS] ${userId} mood → "${mood_note}"`);
    io.emit("state_update", appState);
  });

  // Send flowers to partner
  socket.on("send_flowers", (payload) => {
    const { fromUserId, toUserId } = payload;
    console.log(`[WS] 🌸 ${fromUserId} sent flowers to ${toUserId}`);
    // Broadcast to ALL clients — frontend filters by toUserId
    io.emit("send_flowers", { fromUserId, toUserId });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} — ${reason}`);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
