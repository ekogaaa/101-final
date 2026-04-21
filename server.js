const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      mediaState: {
        mode: "none",
        src: "",
        isPlaying: false,
        currentTime: 0,
        updatedAt: Date.now()
      },
      hostId: null
    });
  }
  return rooms.get(roomId);
}

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username || "Anonymous";

    const room = ensureRoom(roomId);
    if (!room.hostId) {
      room.hostId = socket.id;
    }

    socket.emit("room-state", {
      mediaState: room.mediaState,
      hostId: room.hostId
    });

    socket.to(roomId).emit("peer-joined", {
      peerId: socket.id,
      username: socket.data.username
    });

    io.to(roomId).emit("chat-message", {
      system: true,
      text: `${socket.data.username} joined the room.`,
      timestamp: Date.now()
    });
  });

  socket.on("chat-message", (text) => {
    const roomId = socket.data.roomId;
    if (!roomId || typeof text !== "string" || !text.trim()) return;
    io.to(roomId).emit("chat-message", {
      user: socket.data.username,
      text: text.trim(),
      timestamp: Date.now()
    });
  });

  socket.on("host-media-state", (state) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = ensureRoom(roomId);
    if (room.hostId !== socket.id) return;

    room.mediaState = { ...room.mediaState, ...state, updatedAt: Date.now() };
    socket.to(roomId).emit("media-state", room.mediaState);
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("request-host", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = ensureRoom(roomId);
    room.hostId = socket.id;
    io.to(roomId).emit("host-changed", { hostId: socket.id });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    socket.to(roomId).emit("peer-left", { peerId: socket.id });

    if (room.hostId === socket.id) {
      const fallbackPeer = Array.from(io.sockets.adapter.rooms.get(roomId) || [])[0] || null;
      room.hostId = fallbackPeer;
      io.to(roomId).emit("host-changed", { hostId: room.hostId });
    }

    io.to(roomId).emit("chat-message", {
      system: true,
      text: `${socket.data.username || "Someone"} left the room.`,
      timestamp: Date.now()
    });

    if (!io.sockets.adapter.rooms.get(roomId)?.size) {
      rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
