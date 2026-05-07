(function () {
  const themeToggle = document.getElementById("themeToggle");
  const media = document.getElementById("media");
  const btnPlay = document.getElementById("btnPlay");
  const btnMute = document.getElementById("btnMute");
  const btnFs = document.getElementById("btnFs");
  const seek = document.getElementById("seek");
  const volume = document.getElementById("volume");
  const timeCurrent = document.getElementById("timeCurrent");
  const timeDuration = document.getElementById("timeDuration");
  const urlInput = document.getElementById("urlInput");
  const btnLoadUrl = document.getElementById("btnLoadUrl");
  const youtubeFrame = document.getElementById("youtubeFrame");
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const btnDraw = document.getElementById("btnDraw");
  const btnTttInvite = document.getElementById("btnTttInvite");
  const tttWindow = document.getElementById("tttWindow");
  const tttHeader = document.getElementById("tttHeader");
  const btnCloseTtt = document.getElementById("btnCloseTtt");
  const tttStatus = document.getElementById("tttStatus");
  const tttGrid = document.getElementById("tttGrid");
  const drawModal = document.getElementById("drawModal");
  const btnCloseDraw = document.getElementById("btnCloseDraw");
  const drawHeader = document.getElementById("drawHeader");
  const drawCanvas = document.getElementById("drawCanvas");
  const drawColor = document.getElementById("drawColor");
  const drawSize = document.getElementById("drawSize");
  const btnClearDraw = document.getElementById("btnClearDraw");
  const btnSendDraw = document.getElementById("btnSendDraw");
  const displayName = document.getElementById("displayName");
  const roomCode = document.getElementById("roomCode");
  const chatStatus = document.getElementById("chatStatus");

  let activeSource = "html5";
  let ws = null;
  let applyingRemoteControl = false;
  let pendingRemoteControl = null;
  let ytPlayer = null;
  let ytReady = null;
  let ytVideoId = null;
  let ttt = null; // { gameId, you, opponent, board, turn, status, room }

  function getSavedTheme() {
    try {
      return localStorage.getItem("theme") || "";
    } catch (_) {
      return "";
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem("theme", theme);
    } catch (_) {}
  }

  function prefersLight() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    } catch (_) {
      return false;
    }
  }

  function setTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = t;
    if (themeToggle) {
      themeToggle.textContent = t === "light" ? "☀" : "☾";
      themeToggle.setAttribute(
        "aria-label",
        t === "light" ? "Switch to dark mode" : "Switch to light mode"
      );
    }
    saveTheme(t);
  }

  function ensureYouTubeApi() {
    if (ytReady) return ytReady;
    ytReady = new Promise(function (resolve) {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        try {
          if (typeof prev === "function") prev();
        } catch (_) {}
        resolve(window.YT);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    });
    return ytReady;
  }

  // Theme init
  (function initTheme() {
    const saved = getSavedTheme();
    if (saved === "light" || saved === "dark") setTheme(saved);
    else setTheme(prefersLight() ? "light" : "dark");
    themeToggle?.addEventListener("click", function () {
      const cur = document.body.dataset.theme === "light" ? "light" : "dark";
      setTheme(cur === "light" ? "dark" : "light");
    });
  })();

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function setPlayIcon(playing) {
    btnPlay.textContent = playing ? "⏸" : "▶";
    btnPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function setMuteIcon(muted) {
    btnMute.textContent = muted ? "🔇" : "🔊";
    btnMute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  function updateDuration() {
    const d = media.duration;
    timeDuration.textContent = formatTime(d);
    seek.disabled = !Number.isFinite(d) || d <= 0;
  }

  function syncSeekFromVideo() {
    const d = media.duration;
    if (!Number.isFinite(d) || d <= 0) {
      seek.value = 0;
      return;
    }
    if (!seek.dataset.dragging) {
      seek.value = String((media.currentTime / d) * 1000);
    }
    timeCurrent.textContent = formatTime(media.currentTime);
  }

  media.addEventListener("loadedmetadata", function () {
    updateDuration();
    syncSeekFromVideo();
    if (pendingRemoteControl) {
      const fn = pendingRemoteControl;
      pendingRemoteControl = null;
      fn();
    }
  });

  media.addEventListener("timeupdate", syncSeekFromVideo);
  media.addEventListener("play", function () {
    setPlayIcon(true);
  });
  media.addEventListener("pause", function () {
    setPlayIcon(false);
  });
  media.addEventListener("volumechange", function () {
    volume.value = String(media.volume);
    setMuteIcon(media.muted);
  });

  btnPlay.addEventListener("click", function () {
    if (activeSource === "youtube") {
      if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") return;
      const state = ytPlayer.getPlayerState();
      const isPlaying = state === 1;
      const action = isPlaying ? "pause" : "play";
      const t = typeof ytPlayer.getCurrentTime === "function" ? Number(ytPlayer.getCurrentTime()) : 0;
      if (action === "play") ytPlayer.playVideo?.();
      else ytPlayer.pauseVideo?.();

      if (applyingRemoteControl) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "control",
            room: getRoom(),
            source: "youtube",
            videoId: ytVideoId,
            action,
            time: Number.isFinite(t) ? t : 0,
            sentAt: Date.now(),
          })
        );
      }
      return;
    }

    if (media.paused) {
      media.play().catch(function () {});
    } else {
      media.pause();
    }

    if (activeSource !== "html5") return;
    if (applyingRemoteControl) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const action = media.paused ? "play" : "pause";
      ws.send(
        JSON.stringify({
          type: "control",
          room: getRoom(),
          source: "html5",
          action,
          time: Number.isFinite(media.currentTime) ? media.currentTime : 0,
          sentAt: Date.now(),
        })
      );
    }
  });

  btnMute.addEventListener("click", function () {
    media.muted = !media.muted;
  });

  volume.addEventListener("input", function () {
    media.volume = Number(volume.value);
    if (media.volume > 0 && media.muted) media.muted = false;
  });

  seek.addEventListener("pointerdown", function () {
    seek.dataset.dragging = "1";
  });
  seek.addEventListener("pointerup", function () {
    delete seek.dataset.dragging;
  });
  seek.addEventListener("change", function () {
    const d = media.duration;
    if (Number.isFinite(d) && d > 0) {
      media.currentTime = (Number(seek.value) / 1000) * d;
    }
  });
  seek.addEventListener("input", function () {
    const d = media.duration;
    if (Number.isFinite(d) && d > 0) {
      media.currentTime = (Number(seek.value) / 1000) * d;
      timeCurrent.textContent = formatTime(media.currentTime);
    }
  });

  btnFs.addEventListener("click", function () {
    const wrap = media.closest(".video-wrap");
    if (!document.fullscreenElement) {
      (wrap || media).requestFullscreen?.().catch(function () {});
    } else {
      document.exitFullscreen?.();
    }
  });

  function parseYouTubeId(inputUrl) {
    const pattern =
      /(?:youtube\.com\/(?:watch\?[^#\n\r]*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

    try {
      const raw = String(inputUrl || "").trim();
      if (!raw) return null;
      const m = raw.match(pattern);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  function setControlsEnabled(enabled) {
    btnPlay.disabled = !enabled;
    btnMute.disabled = !enabled;
    seek.disabled = !enabled;
    volume.disabled = !enabled;
  }

  function switchToHtml5Mode() {
    activeSource = "html5";
    youtubeFrame.style.display = "none";
    ytVideoId = null;
    media.style.display = "block";
    setControlsEnabled(true);
    updateDuration();
    syncSeekFromVideo();
  }

  function switchToYouTubeMode(videoId) {
    activeSource = "youtube";
    ytVideoId = videoId;
    media.pause();
    media.removeAttribute("src");
    media.load();
    media.style.display = "none";
    youtubeFrame.style.display = "block";
    // With the YouTube API we can support play/pause, but not the HTML5 volume/seek UI.
    btnPlay.disabled = false;
    btnFs.disabled = false;
    btnMute.disabled = true;
    seek.disabled = true;
    volume.disabled = true;
    seek.value = "0";
    timeCurrent.textContent = "0:00";
    timeDuration.textContent = "--:--";
    setPlayIcon(false);
    setMuteIcon(false);

    ensureYouTubeApi()
      .then(function (YT) {
        if (!YT || !YT.Player) return;

        if (!ytPlayer) {
          ytPlayer = new YT.Player("youtubeFrame", {
            height: "100%",
            width: "100%",
            videoId: videoId,
            playerVars: {
              playsinline: 1,
              rel: 0,
            },
            events: {
              onReady: function () {
                // nothing
              },
              onStateChange: function (e) {
                // 1 = playing, 2 = paused
                if (e && e.data === 1) setPlayIcon(true);
                if (e && e.data === 2) setPlayIcon(false);
              },
            },
          });
        } else {
          ytPlayer.loadVideoById(videoId);
        }
      })
      .catch(function () {});
  }

  function sendMediaUrlToRoom(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "media",
          room: getRoom(),
          url: trimmed,
        })
      );
    }
  }

  function loadUrl(u, opts) {
    const trimmed = (u || "").trim();
    if (!trimmed) return;
    const youTubeId = parseYouTubeId(trimmed);
    if (youTubeId) {
      switchToYouTubeMode(youTubeId);
      addSystemMessage("Loaded YouTube video.");
      return;
    }
    if (/youtu\.?be|youtube\.com/i.test(trimmed)) {
      addSystemMessage("Could not read that YouTube link. Try a full watch/share URL.");
      return;
    }
    switchToHtml5Mode();
    media.removeAttribute("poster");
    media.src = trimmed;
    media.load();
    addSystemMessage("Loaded media from URL.");
  }

  btnLoadUrl.addEventListener("click", function () {
    const u = urlInput.value;
    loadUrl(u);
    sendMediaUrlToRoom(u);
  });

  function nowClock() {
    const t = new Date();
    return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function addMessage(text, opts) {
    const div = document.createElement("div");
    div.className = "msg" + (opts && opts.system ? " system" : "");
    if (opts && opts.system) {
      div.textContent = text;
    } else {
      const meta = document.createElement("div");
      meta.className = "meta";
      const who = (opts && opts.who) || "You";
      const when = (opts && opts.when) || nowClock();
      meta.textContent = who + " · " + when;
      const body = document.createElement("div");
      if (opts && opts.htmlNode) {
        body.appendChild(opts.htmlNode);
      } else {
        body.textContent = text;
      }
      div.appendChild(meta);
      div.appendChild(body);
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addSystemMessage(text) {
    addMessage(text, { system: true });
  }

  function openTtt() {
    tttWindow.style.display = "block";
  }

  function closeTtt() {
    tttWindow.style.display = "none";
  }

  function renderTtt() {
    if (!ttt) {
      tttStatus.textContent = "Not in a game.";
      tttGrid.innerHTML = "";
      return;
    }

    const myTurn = ttt.status === "playing" && ttt.turn === ttt.you;
    let statusLine = `You: ${ttt.you} · Opponent: ${ttt.opponent}`;
    if (ttt.status === "playing") statusLine += myTurn ? " · Your turn" : " · Their turn";
    if (ttt.status === "won") statusLine += ` · Winner: ${ttt.winner}`;
    if (ttt.status === "draw") statusLine += " · Draw";
    tttStatus.textContent = statusLine;

    tttGrid.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ttt-cell";
      b.textContent = ttt.board[i] || "";
      const canPlay = myTurn && !ttt.board[i];
      b.disabled = !canPlay;
      b.addEventListener("click", function () {
        if (!ttt || !(ws && ws.readyState === WebSocket.OPEN)) return;
        ws.send(
          JSON.stringify({
            type: "ttt_move",
            room: getRoom(),
            gameId: ttt.gameId,
            idx: i,
          })
        );
      });
      tttGrid.appendChild(b);
    }
  }

  function getSavedName() {
    try {
      return localStorage.getItem("chatName") || "";
    } catch (_) {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem("chatName", name);
    } catch (_) {}
  }

  function getSavedRoom() {
    try {
      return localStorage.getItem("chatRoom") || "";
    } catch (_) {
      return "";
    }
  }

  function saveRoom(room) {
    try {
      localStorage.setItem("chatRoom", room);
    } catch (_) {}
  }

  function getName() {
    const raw = (displayName.value || "").trim();
    return raw ? raw.slice(0, 24) : "Guest";
  }

  function normalizeRoom(input) {
    const raw = String(input || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);
    return raw || "LOBBY";
  }

  function getRoom() {
    return normalizeRoom(roomCode.value);
  }

  function setRoom(room) {
    const r = normalizeRoom(room);
    roomCode.value = r;
    saveRoom(r);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("room", r);
      history.replaceState(null, "", url.toString());
    } catch (_) {}
  }

  function setStatus(text) {
    chatStatus.textContent = text;
    chatStatus.style.color = text === "online" ? "var(--accent-hover)" : "var(--muted)";
  }

  function wsUrl() {
    if (!window.location || !window.location.host) return null;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + window.location.host + "/ws";
  }

  function connectChat() {
    const url = wsUrl();
    if (!url) {
      setStatus("offline");
      addSystemMessage(
        "To use multi-person chat, run the server and open this page from http://localhost:3000 (not file://)."
      );
      return;
    }

    try {
      ws = new WebSocket(url);
    } catch (_) {
      setStatus("offline");
      addSystemMessage("Could not connect to chat server.");
      return;
    }

    setStatus("connecting…");

    ws.addEventListener("open", function () {
      setStatus("online");
      ws.send(
        JSON.stringify({
          type: "join",
          name: getName(),
          room: getRoom(),
        })
      );
    });

    ws.addEventListener("message", function (evt) {
      let data = null;
      try {
        data = JSON.parse(String(evt.data));
      } catch (_) {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "system" && typeof data.text === "string") {
        addSystemMessage(data.text);
        return;
      }

      if (data.type === "chat" && typeof data.text === "string") {
        addMessage(data.text, {
          who: typeof data.name === "string" && data.name.trim() ? data.name : "Someone",
          when: typeof data.time === "string" && data.time ? data.time : nowClock(),
        });
      }

      if (data.type === "media" && typeof data.url === "string") {
        loadUrl(data.url);
        urlInput.value = data.url;
        addSystemMessage("Synced media from room.");
      }

      if (data.type === "control") {
        const source = String(data.source || "html5");
        const action = String(data.action || "");
        const t = Number(data.time);
        const sentAt = Number(data.sentAt);
        if ((action !== "play" && action !== "pause") || !Number.isFinite(t) || t < 0) return;
        if (!Number.isFinite(sentAt) || sentAt <= 0) return;

        const lagSec = Math.max(0, (Date.now() - sentAt) / 1000);
        const targetTime = action === "play" ? t + lagSec : t;

        if (source === "youtube") {
          if (activeSource !== "youtube") return;
          if (!ytPlayer) return;
          const applyYt = function () {
            applyingRemoteControl = true;
            try {
              ytPlayer.seekTo?.(targetTime, true);
              if (action === "play") ytPlayer.playVideo?.();
              else ytPlayer.pauseVideo?.();
            } finally {
              setTimeout(function () {
                applyingRemoteControl = false;
              }, 250);
            }
          };
          applyYt();
          return;
        }

        if (activeSource !== "html5") return;
        if (!media || !media.src) return;

        const apply = function () {
          applyingRemoteControl = true;
          try {
            media.currentTime = targetTime;
            if (action === "play") {
              media.play().catch(function () {});
            } else {
              media.pause();
            }
          } finally {
            setTimeout(function () {
              applyingRemoteControl = false;
            }, 250);
          }
        };

        if (!Number.isFinite(media.duration) || media.duration <= 0) {
          pendingRemoteControl = apply;
          return;
        }
        apply();
      }

      if (data.type === "drawing" && typeof data.dataUrl === "string") {
        const img = document.createElement("img");
        img.className = "drawing";
        img.alt = "Drawing";
        img.src = data.dataUrl;
        addMessage("", {
          who: typeof data.name === "string" && data.name.trim() ? data.name : "Someone",
          when: typeof data.time === "string" && data.time ? data.time : nowClock(),
          htmlNode: img,
        });
      }

      if (data.type === "ttt_invite" && typeof data.gameId === "string") {
        const joinBtn = document.createElement("button");
        joinBtn.type = "button";
        joinBtn.className = "btn primary";
        joinBtn.textContent = "Join";
        joinBtn.style.whiteSpace = "nowrap";
        joinBtn.style.flexShrink = "0";
        joinBtn.addEventListener("click", function () {
          if (!(ws && ws.readyState === WebSocket.OPEN)) return;
          ws.send(
            JSON.stringify({
              type: "ttt_join",
              room: getRoom(),
              gameId: data.gameId,
              name: getName(),
            })
          );
        });

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.justifyContent = "space-between";
        wrap.style.gap = "0.75rem";
        wrap.style.flexWrap = "wrap";
        const txt = document.createElement("div");
        txt.textContent = `${data.hostName || "Someone"} invited you to Tic‑Tac‑Toe.`;
        txt.style.flex = "1 1 auto";
        txt.style.minWidth = "12rem";
        wrap.appendChild(txt);
        wrap.appendChild(joinBtn);

        addMessage("", {
          who: "System",
          when: typeof data.time === "string" && data.time ? data.time : nowClock(),
          htmlNode: wrap,
        });
      }

      if (data.type === "ttt_start" && typeof data.gameId === "string") {
        ttt = {
          room: getRoom(),
          gameId: data.gameId,
          you: data.you,
          opponent: data.opponent,
          board: Array.isArray(data.board) ? data.board.slice(0, 9) : Array(9).fill(""),
          turn: data.turn || "X",
          status: data.status || "playing",
          winner: null,
        };
        openTtt();
        renderTtt();
      }

      if (data.type === "ttt_state" && ttt && data.gameId === ttt.gameId) {
        ttt.board = Array.isArray(data.board) ? data.board.slice(0, 9) : ttt.board;
        ttt.turn = data.turn || ttt.turn;
        ttt.status = data.status || ttt.status;
        ttt.winner = data.winner || null;
        renderTtt();
      }
    });

    ws.addEventListener("close", function () {
      setStatus("offline");
      ws = null;
      addSystemMessage("Disconnected from chat server.");
    });

    ws.addEventListener("error", function () {
      setStatus("offline");
    });
  }

  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "chat",
          name: getName(),
          room: getRoom(),
          text,
        })
      );
    } else {
      addMessage(text, { who: "You" });
      addSystemMessage("Not connected — start the server to chat with others.");
    }
    chatInput.value = "";
    chatInput.focus();
  });

  function openDraw() {
    drawModal.style.display = "block";
  }

  function closeDraw() {
    drawModal.style.display = "none";
  }

  function clearCanvas() {
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  // Basic drawing (mouse/touch/pen)
  (function setupDrawing() {
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;
    clearCanvas();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = drawColor.value || "#111111";
    ctx.lineWidth = Number(drawSize.value) || 8;

    let drawing = false;

    function pos(evt) {
      const r = drawCanvas.getBoundingClientRect();
      return {
        x: ((evt.clientX - r.left) / r.width) * drawCanvas.width,
        y: ((evt.clientY - r.top) / r.height) * drawCanvas.height,
      };
    }

    drawCanvas.addEventListener("pointerdown", function (e) {
      drawing = true;
      drawCanvas.setPointerCapture?.(e.pointerId);
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });

    drawCanvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    function stop(e) {
      if (!drawing) return;
      drawing = false;
      try {
        drawCanvas.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
    }

    drawCanvas.addEventListener("pointerup", stop);
    drawCanvas.addEventListener("pointercancel", stop);

    drawColor.addEventListener("input", function () {
      ctx.strokeStyle = drawColor.value || "#111111";
    });
    drawSize.addEventListener("input", function () {
      const n = Number(drawSize.value);
      ctx.lineWidth = Number.isFinite(n) && n > 0 ? n : 8;
    });
  })();

  btnDraw.addEventListener("click", function () {
    openDraw();
  });
  btnCloseDraw.addEventListener("click", closeDraw);
  btnClearDraw.addEventListener("click", clearCanvas);
  btnSendDraw.addEventListener("click", function () {
    if (!(ws && ws.readyState === WebSocket.OPEN)) {
      addSystemMessage("Not connected — start the server to share drawings.");
      return;
    }
    const dataUrl = drawCanvas.toDataURL("image/png");
    ws.send(
      JSON.stringify({
        type: "drawing",
        room: getRoom(),
        name: getName(),
        dataUrl,
      })
    );
    closeDraw();
  });

  btnTttInvite.addEventListener("click", function () {
    if (!(ws && ws.readyState === WebSocket.OPEN)) {
      addSystemMessage("Not connected — start the server to invite someone.");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "ttt_invite",
        room: getRoom(),
        name: getName(),
      })
    );
    addSystemMessage("Sent a Tic‑Tac‑Toe invite to the room.");
  });

  btnCloseTtt.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  btnCloseTtt.addEventListener("click", function (e) {
    e.stopPropagation();
    closeTtt();
  });

  // Drag TicTacToe window
  (function setupTttDrag() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function px(v) {
      return Math.round(v) + "px";
    }

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function currentLeftTop() {
      const r = tttWindow.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }

    tttHeader.addEventListener("pointerdown", function (e) {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      dragging = true;
      tttHeader.setPointerCapture?.(e.pointerId);
      const cur = currentLeftTop();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = cur.left;
      startTop = cur.top;
      tttHeader.style.cursor = "grabbing";
      tttWindow.style.bottom = "auto";
      tttWindow.style.right = "auto";
      tttWindow.style.left = px(startLeft);
      tttWindow.style.top = px(startTop);
    });

    tttHeader.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = window.innerWidth - tttWindow.offsetWidth - 8;
      const maxTop = window.innerHeight - tttWindow.offsetHeight - 8;
      const nextLeft = clamp(startLeft + dx, 8, Math.max(8, maxLeft));
      const nextTop = clamp(startTop + dy, 8, Math.max(8, maxTop));
      tttWindow.style.left = px(nextLeft);
      tttWindow.style.top = px(nextTop);
    });

    function stopDrag(e) {
      if (!dragging) return;
      dragging = false;
      try {
        tttHeader.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      tttHeader.style.cursor = "grab";
    }

    tttHeader.addEventListener("pointerup", stopDrag);
    tttHeader.addEventListener("pointercancel", stopDrag);
  })();

  // Drag to reposition the drawing window
  (function setupDrawDrag() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function px(v) {
      return Math.round(v) + "px";
    }

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function currentLeftTop() {
      const r = drawModal.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }

    drawHeader.addEventListener("pointerdown", function (e) {
      dragging = true;
      drawHeader.setPointerCapture?.(e.pointerId);
      const cur = currentLeftTop();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = cur.left;
      startTop = cur.top;
      drawHeader.style.cursor = "grabbing";
      // switch from right-anchored to left/top anchored while dragging
      drawModal.style.right = "auto";
      drawModal.style.left = px(startLeft);
      drawModal.style.top = px(startTop);
    });

    drawHeader.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = window.innerWidth - drawModal.offsetWidth - 8;
      const maxTop = window.innerHeight - drawModal.offsetHeight - 8;
      const nextLeft = clamp(startLeft + dx, 8, Math.max(8, maxLeft));
      const nextTop = clamp(startTop + dy, 8, Math.max(8, maxTop));
      drawModal.style.left = px(nextLeft);
      drawModal.style.top = px(nextTop);
    });

    function stopDrag(e) {
      if (!dragging) return;
      dragging = false;
      try {
        drawHeader.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      drawHeader.style.cursor = "grab";
    }

    drawHeader.addEventListener("pointerup", stopDrag);
    drawHeader.addEventListener("pointercancel", stopDrag);
  })();

  setPlayIcon(!media.paused);
  setMuteIcon(media.muted);
  volume.value = String(media.volume);
  displayName.value = getSavedName();
  roomCode.value = getSavedRoom() || "LOBBY";

  try {
    const url = new URL(window.location.href);
    const roomFromUrl = url.searchParams.get("room");
    if (roomFromUrl) setRoom(roomFromUrl);
  } catch (_) {}

  displayName.addEventListener("change", function () {
    saveName(getName());
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join", name: getName(), room: getRoom() }));
    }
  });

  roomCode.addEventListener("change", function () {
    setRoom(getRoom());
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join", name: getName(), room: getRoom() }));
    }
  });

  addSystemMessage("Starting chat… (requires local server)");
  connectChat();

  media.addEventListener("ended", function () {
    addSystemMessage("Playback finished.");
  });
})();
