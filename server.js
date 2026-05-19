/**
 * PixelCouple Backend — server.js
 * Node.js + Express + Socket.io + flat-file JSON persistence
 *
 * Architecture:
 *  - Express serves a REST fallback  GET /api/status
 *  - Socket.io handles real-time bidirectional updates
 *  - data.json acts as a lightweight persistent store so state
 *    survives Render.com cold-starts / sleep cycles
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

// Comma-separated list of allowed frontend origins.
// Set the ALLOWED_ORIGINS env var on Render to your Vercel/Netlify URL.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:5173", // Vite dev server default
      "http://localhost:3000",
    ];

// ─── Flat-file DB ─────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, "data.json");

/** Default state — used when data.json doesn't exist yet */
const DEFAULT_STATE = {
  user_1: {
    id: "user_1",
    name: "Boyfriend",
    status: "Chilling",
    gif_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    location: "Home",
    updated_at: new Date().toISOString(),
  },
  user_2: {
    id: "user_2",
    name: "Girlfriend",
    status: "Chilling",
    gif_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    location: "Home",
    updated_at: new Date().toISOString(),
  },
};

/**
 * Reads state from data.json.
 * Falls back to DEFAULT_STATE if the file is missing or malformed.
 */
function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { ...DEFAULT_STATE };
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[DB] Failed to read data.json, using defaults:", err.message);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Writes the current state object to data.json atomically-ish.
 * Uses a temp-file + rename to avoid a partially-written file on crash.
 */
function writeState(state) {
  try {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error("[DB] Failed to write data.json:", err.message);
  }
}

// Initialise in-memory state from disk on startup
let appState = readState();
console.log("[DB] State loaded from disk:", appState);

// ─── Express + Socket.io Setup ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  // Helps on flaky mobile connections
  pingTimeout: 20000,
  pingInterval: 10000,
});

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET"],
  })
);
app.use(express.json());

// ─── REST fallback ─────────────────────────────────────────────────────────
/**
 * GET /api/status
 * Called by the frontend on initial mount and after every reconnect
 * so the UI is never stuck displaying stale data.
 */
app.get("/api/status", (req, res) => {
  res.json(appState);
});

// Simple health-check so Render uptime monitors can ping us
app.get("/health", (req, res) => res.send("ok"));

// ─── Socket.io Events ────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send the current full state immediately on connect so the new client
  // is in sync right away (important after iOS wakes from background).
  socket.emit("state_update", appState);

  /**
   * update_status — emitted by a user when they change their status.
   *
   * Expected payload:
   * {
   *   userId: "user_1" | "user_2",
   *   status: string,
   *   gif_url: string,
   *   location: string
   * }
   */
  socket.on("update_status", (payload) => {
    const { userId, status, gif_url, location } = payload;

    if (!appState[userId]) {
      console.warn(`[WS] Unknown userId: ${userId}`);
      return;
    }

    // Merge update into in-memory state
    appState[userId] = {
      ...appState[userId],
      status,
      gif_url,
      location,
      updated_at: new Date().toISOString(),
    };

    // Persist to disk so the state survives cold-starts
    writeState(appState);

    console.log(`[WS] ${userId} updated → ${status} @ ${location}`);

    // Broadcast full state to ALL connected clients (both partners update)
    io.emit("state_update", appState);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} — ${reason}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
