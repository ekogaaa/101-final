# Media Player + Chat

This project is a single-page media player (HTML5 video/audio + basic YouTube embed loading) with a simple **multi-person chat** powered by a local WebSocket server.

## Live deployment (Render)

This repo includes `render.yaml` so Render can deploy it easily as a **live webpage with live WebSockets**.

### Steps

1. Push this project to a GitHub repo.
2. In Render, create a new **Web Service** from your GitHub repo.
   - Render should detect `render.yaml` automatically.
3. Click **Deploy**.
4. When it finishes, Render will give you a public URL like:
   - `https://your-app-name.onrender.com`

### Rooms on the live site

- You can share a room link like:
  - `https://your-app-name.onrender.com/?room=ABC123`
- Anyone with that link will join the same chat room.

## What was already made (before today)

- **Media player UI**: play/pause, mute/volume, seek bar, fullscreen
- **Load sources**:
  - URL-based audio/video loading
  - local file loading
  - basic YouTube link parsing + embed mode
- **Chat UI (local-only at the time)**: messages rendered in the sidebar, system messages, timestamps

## What was made today

- **Real multi-person chat** (shared between everyone connected to the same server)
  - WebSocket server that broadcasts messages to all connected clients
  - browser chat now connects to `/ws` and displays messages from others
  - display name field (saved in `localStorage`)
- **Rooms (room codes)** so one server can host multiple group chats
  - room code input in the UI
  - room can be shared via a link like `http://localhost:3000/?room=ABC123`
- **Local dev server** so the chat works from `http://localhost:3000` (not `file://`)
- **Code organization (no behavior change)**: moved inline CSS/JS out of `index.html` into `style.css` + `app.js`
- **UI simplification**: removed local file picker since it can’t be shared/synced across screens; URL loading is the supported workflow

## How to run

1. Install Node.js (LTS is fine).
2. In this project folder, install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open the app at `http://localhost:3000`.

## How to test multi-person chat

- Open `http://localhost:3000` in two different browser windows (or different devices on the same network, using your computer's IP and the same port).
- Type messages in one window; they should appear in the other.

## Notes

- If you deploy on a free tier, the service may “sleep” when idle. The first load after inactivity can take a bit longer.

