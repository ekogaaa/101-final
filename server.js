const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

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
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`WebSocket endpoint at ws://localhost:${PORT}/ws`);
});

