# Collaboration (Built-in)

Real-time collaborative editing using Yjs. This is a **built-in** VS Code extension (non-removable).

## Features
- ✅ Real-time text synchronization via WebSocket
- ✅ Connect / Disconnect commands
- ✅ Status bar indicator with connection state
- ✅ Auto-reconnect with exponential backoff (max 5 attempts, capped at 30s delay)
- ✅ Configurable collaboration server URL and user name
- 🚧 Remote cursor/selection decorations (planned)
- 🚧 Incremental diff application (planned - currently full doc replace)

## Configuration

Open Settings and search for "Collaboration":

- `collaboration.enabled` (boolean, default: `true`) - Enable/disable collaboration feature
- `collaboration.serverUrl` (string, default: `ws://localhost:1234`) - WebSocket server endpoint
- `collaboration.userName` (string, default: auto-generated) - Your display name in collaboration sessions
- `collaboration.autoConnect` (boolean, default: `false`) - Automatically connect on VS Code startup

## Usage

### 1. Start your collaboration server
Ensure you have a Yjs-compatible WebSocket server running at the configured URL (default: `ws://localhost:4003`).

### 2. Connect to server
- Open Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)
- Run `Collaboration: Connect`
- Watch the status bar (bottom-left) for connection status

### 3. Disconnect
- Run `Collaboration: Disconnect` from Command Palette
- Or disable `collaboration.enabled` in settings

## Status Bar Indicators

- `$(globe) Disconnected` - Not connected
- `$(globe) Connecting...` - Attempting to connect
- `$(globe) Connected` - Successfully connected to server
- `$(globe) Connection Error` - Connection failed (check server availability)
- `$(globe) Reconnecting (X/5)...` - Auto-retry in progress
- `$(globe) Disconnected (max retries)` - Stopped retrying; manually connect to retry
- `$(globe) Disabled` - Feature disabled in settings

## Troubleshooting

**"Cannot connect to collaboration server... Is the server running?"**
- Verify the server is running at the configured URL
- Check firewall/network settings
- Ensure the server supports the Yjs WebSocket protocol

**Extension keeps retrying even after manual disconnect**
- This is expected for the first 5 attempts if `autoConnect` is enabled
- After 5 failed attempts, auto-reconnect stops automatically
- To prevent auto-reconnect on startup: set `collaboration.autoConnect` to `false`

**No errors but changes don't sync**
- Ensure multiple clients are connected to the **same** server
- Check that documents use compatible Yjs room/document IDs
- Verify network connectivity between clients and server

## Development

### Install dependencies
```bash
cd extensions/collaboration
npm install
```

### Compile
```bash
npx gulp compile-extension:collaboration
```

### Watch mode
```bash
npx gulp watch-extension:collaboration
```

## Architecture Notes

- Extension runs in Node.js extension host (not browser)
- Uses `ws` library for WebSocket client
- Yjs `Doc` and `Y.Text` for CRDT-based synchronization
- Currently applies full document replacement on remote updates (inefficient for large docs)

## Next Steps (Roadmap)

1. **Incremental edits** - Compute minimal diff from Yjs updates instead of full replace
2. **Remote cursors** - Show other users' selections as decorations
3. **Awareness protocol** - Broadcast/display user presence (colors, names, active file)
4. **Binary encoding** - Use Yjs binary updates for efficiency (currently using default)
5. **Room management** - Explicit document/room ID strategy
6. **Tests** - Activation smoke test, document sync roundtrip test
7. **Performance** - Throttle outbound updates, batch inbound changes

