const socket = io();

const usernameInput = document.getElementById("usernameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const hostBtn = document.getElementById("hostBtn");
const statusEl = document.getElementById("status");
const sourceInput = document.getElementById("sourceInput");
const localFileInput = document.getElementById("localFileInput");
const loadSourceBtn = document.getElementById("loadSourceBtn");
const modeUrlBtn = document.getElementById("modeUrl");
const modeYoutubeBtn = document.getElementById("modeYoutube");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const seekBackBtn = document.getElementById("seekBackBtn");
const seekForwardBtn = document.getElementById("seekForwardBtn");
const nativePlayer = document.getElementById("nativePlayer");
const remoteStreamPlayer = document.getElementById("remoteStreamPlayer");
const youtubeHolder = document.getElementById("youtubeHolder");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let roomId = "";
let username = "";
let isHost = false;
let sourceMode = "url";
let suppressMediaEvents = false;
let pendingYouTubeVideoId = null;
let ytPlayer = null;

const peerConnections = new Map();
let localStream = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function appendMessage({ user, text, system, timestamp }) {
  const item = document.createElement("div");
  item.className = "msg";
  const date = new Date(timestamp || Date.now()).toLocaleTimeString();
  const who = system ? "System" : user || "Anon";
  item.innerHTML = `<div class="meta">${who} - ${date}</div><div>${text}</div>`;
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showOnly(type) {
  nativePlayer.style.display = "none";
  youtubeHolder.style.display = "none";
  remoteStreamPlayer.style.display = "none";
  if (type === "native") nativePlayer.style.display = "block";
  if (type === "youtube") youtubeHolder.style.display = "block";
  if (type === "remote") remoteStreamPlayer.style.display = "block";
}

function extractYouTubeId(input) {
  const match = input.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function broadcastState(partial) {
  if (!isHost || !roomId) return;
  socket.emit("host-media-state", partial);
}

function currentNativeState() {
  return {
    mode: "url",
    src: nativePlayer.currentSrc || sourceInput.value,
    currentTime: nativePlayer.currentTime || 0,
    isPlaying: !nativePlayer.paused
  };
}

function applyRemoteNativeState(state) {
  suppressMediaEvents = true;
  nativePlayer.src = state.src || "";
  showOnly("native");
  const sync = () => {
    nativePlayer.currentTime = state.currentTime || 0;
    if (state.isPlaying) nativePlayer.play().catch(() => {});
    else nativePlayer.pause();
    suppressMediaEvents = false;
  };
  nativePlayer.onloadedmetadata = sync;
}

function setupYouTubePlayer(videoId) {
  pendingYouTubeVideoId = videoId;
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
    return;
  }
  if (window.YT && YT.Player) {
    ytPlayer = new YT.Player("youtubeHolder", {
      videoId,
      playerVars: { autoplay: 0, controls: 1 },
      events: {
        onStateChange: (event) => {
          if (!isHost || suppressMediaEvents) return;
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
            broadcastState({
              mode: "youtube",
              src: ytPlayer.getVideoUrl(),
              currentTime: ytPlayer.getCurrentTime(),
              isPlaying: event.data === YT.PlayerState.PLAYING
            });
          }
        }
      }
    });
  }
}

window.onYouTubeIframeAPIReady = () => {
  if (pendingYouTubeVideoId) {
    setupYouTubePlayer(pendingYouTubeVideoId);
  }
};

function applyRemoteYouTubeState(state) {
  const id = extractYouTubeId(state.src || "");
  if (!id) return;
  showOnly("youtube");
  setupYouTubePlayer(id);
  const trySync = () => {
    if (!ytPlayer || !ytPlayer.seekTo) return false;
    suppressMediaEvents = true;
    ytPlayer.seekTo(state.currentTime || 0, true);
    if (state.isPlaying) ytPlayer.playVideo();
    else ytPlayer.pauseVideo();
    setTimeout(() => {
      suppressMediaEvents = false;
    }, 200);
    return true;
  };
  const timer = setInterval(() => {
    if (trySync()) clearInterval(timer);
  }, 250);
  setTimeout(() => clearInterval(timer), 4000);
}

async function createPeerConnection(peerId, isOfferer) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peerConnections.set(peerId, pc);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { to: peerId, data: { candidate: event.candidate } });
    }
  };

  pc.ontrack = (event) => {
    if (!isHost) {
      remoteStreamPlayer.srcObject = event.streams[0];
      showOnly("remote");
    }
  };

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: peerId, data: { sdp: pc.localDescription } });
  }
  return pc;
}

async function initLocalFileStream(file) {
  const url = URL.createObjectURL(file);
  nativePlayer.src = url;
  nativePlayer.muted = true;
  showOnly("native");
  await nativePlayer.play().catch(() => {});
  localStream = nativePlayer.captureStream();

  for (const [peerId, pc] of peerConnections.entries()) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: peerId, data: { sdp: pc.localDescription } });
  }

  broadcastState({
    mode: "local-stream",
    src: file.name,
    currentTime: 0,
    isPlaying: true
  });
}

joinBtn.addEventListener("click", () => {
  username = usernameInput.value.trim() || "Anonymous";
  roomId = roomInput.value.trim() || "default-room";
  socket.emit("join-room", { roomId, username });
  setStatus(`Connected to room "${roomId}" as ${username}`);
});

hostBtn.addEventListener("click", () => {
  socket.emit("request-host");
});

modeUrlBtn.addEventListener("click", () => {
  sourceMode = "url";
  setStatus("Source mode: Direct MP3/MP4 URL");
});

modeYoutubeBtn.addEventListener("click", () => {
  sourceMode = "youtube";
  setStatus("Source mode: YouTube link");
});

loadSourceBtn.addEventListener("click", async () => {
  if (!isHost) {
    setStatus("Only host can load source");
    return;
  }
  const localFile = localFileInput.files?.[0];
  if (localFile) {
    await initLocalFileStream(localFile);
    return;
  }
  if (sourceMode === "youtube") {
    const videoId = extractYouTubeId(sourceInput.value.trim());
    if (!videoId) {
      setStatus("Invalid YouTube URL");
      return;
    }
    showOnly("youtube");
    setupYouTubePlayer(videoId);
    broadcastState({
      mode: "youtube",
      src: sourceInput.value.trim(),
      currentTime: 0,
      isPlaying: false
    });
    return;
  }
  const url = sourceInput.value.trim();
  if (!url) return;
  nativePlayer.src = url;
  showOnly("native");
  nativePlayer.load();
  nativePlayer.onloadedmetadata = () => {
    nativePlayer.pause();
    broadcastState(currentNativeState());
  };
});

playBtn.addEventListener("click", () => {
  if (!isHost) return;
  if (sourceMode === "youtube" && ytPlayer?.playVideo) {
    ytPlayer.playVideo();
    return;
  }
  nativePlayer.play().catch(() => {});
});

pauseBtn.addEventListener("click", () => {
  if (!isHost) return;
  if (sourceMode === "youtube" && ytPlayer?.pauseVideo) {
    ytPlayer.pauseVideo();
    return;
  }
  nativePlayer.pause();
});

seekBackBtn.addEventListener("click", () => {
  if (!isHost) return;
  if (sourceMode === "youtube" && ytPlayer?.seekTo) {
    ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - 10), true);
    return;
  }
  nativePlayer.currentTime = Math.max(0, nativePlayer.currentTime - 10);
});

seekForwardBtn.addEventListener("click", () => {
  if (!isHost) return;
  if (sourceMode === "youtube" && ytPlayer?.seekTo) {
    ytPlayer.seekTo(ytPlayer.getCurrentTime() + 10, true);
    return;
  }
  nativePlayer.currentTime += 10;
});

["play", "pause", "seeked"].forEach((eventName) => {
  nativePlayer.addEventListener(eventName, () => {
    if (!isHost || suppressMediaEvents) return;
    broadcastState(currentNativeState());
  });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", text);
  chatInput.value = "";
});

socket.on("room-state", async ({ mediaState, hostId }) => {
  isHost = socket.id === hostId;
  setStatus(isHost ? "You are host" : "You are viewer");
  if (mediaState.mode === "url" && mediaState.src) {
    applyRemoteNativeState(mediaState);
  } else if (mediaState.mode === "youtube" && mediaState.src) {
    applyRemoteYouTubeState(mediaState);
  }
});

socket.on("host-changed", ({ hostId }) => {
  isHost = socket.id === hostId;
  setStatus(isHost ? "You are host" : "Viewer mode");
});

socket.on("chat-message", appendMessage);

socket.on("media-state", (state) => {
  if (isHost) return;
  if (state.mode === "url") {
    sourceMode = "url";
    applyRemoteNativeState(state);
  } else if (state.mode === "youtube") {
    sourceMode = "youtube";
    applyRemoteYouTubeState(state);
  } else if (state.mode === "local-stream") {
    setStatus("Host started local-file stream");
  }
});

socket.on("peer-joined", async ({ peerId }) => {
  if (!isHost) return;
  await createPeerConnection(peerId, true);
});

socket.on("peer-left", ({ peerId }) => {
  const pc = peerConnections.get(peerId);
  if (pc) pc.close();
  peerConnections.delete(peerId);
});

socket.on("signal", async ({ from, data }) => {
  const pc = await createPeerConnection(from, false);
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
    }
  }
  if (data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});
