# Watch Party Player (MVP)

Browser-based media room with:

- room join by ID
- synchronized playback controls
- real-time chat
- YouTube synchronized playback
- direct MP3/MP4 URL synchronized playback
- local file co-watch via host live stream (WebRTC)

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000` in multiple browser windows/devices on the same network.

## Notes on supported sources

- **YouTube**: supported in synchronized mode.
- **Spotify / Apple Music**: these services are DRM and API restricted in browsers, so full shared playback is not included in this MVP.
  - You can still share those links via chat.
- **Local files**: host can choose a local file and stream it to viewers live.
