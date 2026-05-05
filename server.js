const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const tttPendingByRoom = new Map(); // room -> { gameId, hostSocket, hostName, createdAt }
const tttGames = new Map(); // gameId -> { room, xSocket, oSocket, xName, oName, board, turn, status }

function nowClock() {
  const t = new Date();
  return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function safeName(name) {
  const n = String(name || "").trim().slice(0, 24);
  return n || "Guest";
}

function safeRoom(room) {
  const r = String(room || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return r || "LOBBY";
}

function send(socket, obj) {
  if (socket.readyState === 1) socket.send(JSON.stringify(obj));
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function broadcastToRoom(room, obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if (client.room !== room) continue;
    client.send(msg);
  }
}

function newGameId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

function winnerFor(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((x) => x)) return "draw";
  return null;
}

wss.on("connection", (socket) => {
  socket.userName = "Guest";
  socket.room = "LOBBY";
  send(socket, { type: "system", text: "Connected to chat server." });

  socket.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    if (data.type === "join") {
      const prevRoom = socket.room;
      socket.userName = safeName(data.name);
      socket.room = safeRoom(data.room);

      send(socket, {
        type: "system",
        text: `You are ${socket.userName}. Room: ${socket.room}.`,
      });

      if (prevRoom !== socket.room) {
        send(socket, {
          type: "system",
          text: `Switched rooms from ${prevRoom} to ${socket.room}.`,
        });
      }
      return;
    }

    if (data.type === "chat") {
      const text = String(data.text || "").trim().slice(0, 500);
      if (!text) return;
      const name = safeName(data.name || socket.userName);
      const room = safeRoom(data.room || socket.room);
      socket.room = room;
      broadcastToRoom(room, { type: "chat", room, name, text, time: nowClock() });
    }

    if (data.type === "media") {
      const room = safeRoom(data.room || socket.room);
      const url = String(data.url || "").trim().slice(0, 2000);
      if (!url) return;
      socket.room = room;
      broadcastToRoom(room, { type: "media", room, url, time: nowClock() });
    }

    if (data.type === "control") {
      const room = safeRoom(data.room || socket.room);
      const action = String(data.action || "").trim();
      const source = String(data.source || "html5").trim();
      const videoId = String(data.videoId || "").trim();
      const t = Number(data.time);
      const sentAt = Number(data.sentAt);
      if (action !== "play" && action !== "pause") return;
      if (source !== "html5" && source !== "youtube") return;
      if (!Number.isFinite(t) || t < 0) return;
      if (!Number.isFinite(sentAt) || sentAt <= 0) return;
      socket.room = room;
      broadcastToRoom(room, { type: "control", room, source, videoId, action, time: t, sentAt });
    }

    if (data.type === "drawing") {
      const room = safeRoom(data.room || socket.room);
      const name = safeName(data.name || socket.userName);
      const dataUrl = String(data.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:image/")) return;
      // Keep payloads small-ish (base64 expands ~33%).
      if (dataUrl.length > 350_000) return;
      socket.room = room;
      broadcastToRoom(room, { type: "drawing", room, name, dataUrl, time: nowClock() });
    }

    if (data.type === "ttt_invite") {
      const room = safeRoom(data.room || socket.room);
      const name = safeName(data.name || socket.userName);
      socket.room = room;

      const existing = tttPendingByRoom.get(room);
      if (existing && Date.now() - existing.createdAt < 10 * 60 * 1000) {
        send(socket, { type: "system", text: "A Tic‑Tac‑Toe invite is already waiting in this room." });
        return;
      }

      const gameId = newGameId();
      tttPendingByRoom.set(room, { gameId, hostSocket: socket, hostName: name, createdAt: Date.now() });
      broadcastToRoom(room, {
        type: "ttt_invite",
        room,
        gameId,
        hostName: name,
        time: nowClock(),
      });
      return;
    }

    if (data.type === "ttt_join") {
      const room = safeRoom(data.room || socket.room);
      const name = safeName(data.name || socket.userName);
      const gameId = String(data.gameId || "").trim();
      socket.room = room;

      const pending = tttPendingByRoom.get(room);
      if (!pending || pending.gameId !== gameId) {
        send(socket, { type: "system", text: "That Tic‑Tac‑Toe invite is no longer available." });
        return;
      }
      if (pending.hostSocket === socket) {
        send(socket, { type: "system", text: "You can’t join your own invite." });
        return;
      }

      // Start game
      tttPendingByRoom.delete(room);
      const xSocket = pending.hostSocket;
      const oSocket = socket;
      const board = Array(9).fill("");
      const game = {
        room,
        xSocket,
        oSocket,
        xName: pending.hostName,
        oName: name,
        board,
        turn: "X",
        status: "playing",
      };
      tttGames.set(gameId, game);

      send(xSocket, {
        type: "ttt_start",
        room,
        gameId,
        you: "X",
        opponent: name,
        board,
        turn: "X",
        status: "playing",
      });
      send(oSocket, {
        type: "ttt_start",
        room,
        gameId,
        you: "O",
        opponent: pending.hostName,
        board,
        turn: "X",
        status: "playing",
      });
      broadcastToRoom(room, {
        type: "system",
        text: `Tic‑Tac‑Toe started: ${pending.hostName} vs ${name}.`,
      });
      return;
    }

    if (data.type === "ttt_move") {
      const room = safeRoom(data.room || socket.room);
      const gameId = String(data.gameId || "").trim();
      const idx = Number(data.idx);
      socket.room = room;

      const game = tttGames.get(gameId);
      if (!game || game.room !== room) return;
      if (!Number.isInteger(idx) || idx < 0 || idx > 8) return;
      if (game.status !== "playing") return;

      const isX = socket === game.xSocket;
      const isO = socket === game.oSocket;
      if (!isX && !isO) return;
      const symbol = isX ? "X" : "O";
      if (game.turn !== symbol) return;
      if (game.board[idx]) return;

      game.board[idx] = symbol;
      const win = winnerFor(game.board);
      if (win === "X" || win === "O") {
        game.status = "won";
        game.winner = win;
      } else if (win === "draw") {
        game.status = "draw";
      } else {
        game.turn = game.turn === "X" ? "O" : "X";
      }

      const payload = {
        type: "ttt_state",
        room,
        gameId,
        board: game.board,
        turn: game.turn,
        status: game.status,
        winner: game.winner || null,
        time: nowClock(),
      };
      send(game.xSocket, payload);
      send(game.oSocket, payload);
      return;
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`WebSocket endpoint at ws://localhost:${PORT}/ws`);
});

