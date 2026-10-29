# Running the ATLAS demo across multiple devices

The 4-party surplus-matching demo (`atlas-lobby.html` → `atlas-party.wasm`)
can run with each party on a **different computer**, as long as all of them
are connected to the **same local network** (e.g. the same Wi-Fi in the same
room). No tunnel or VPN is needed for that case.

## How the networking works

```
                 ┌──────────────── server laptop ────────────────┐
                 │  web server        https://<IP>:8000  (HTML, .js, .wasm)
                 │  signaling server  wss://<IP>:8080    (lobby + WebRTC handshake)
                 └───────────────────────────────────────────────┘
                        ▲   ▲   ▲   ▲    only setup traffic
                        │   │   │   │    (no input values)
                     P0 ┴── P1 ─┴── P2 ─┴── P3     browsers on 4 devices
                      └─────── WebRTC data channels ───────┘
                          direct peer-to-peer, carry the MPC
```

1. **Web server** (`https-server.py`, port 8000) serves the page and the
   WebAssembly module. It also sends the `Cross-Origin-*` headers the
   multi-threaded WASM build needs.
2. **Signaling server** (`signaling_wss_server.js`, port 8080) runs the lobby
   (seat assignment and the ready check) and relays the WebRTC handshake
   (offer/answer/ICE candidates). It never sees any party's private input.
3. **WebRTC data channels**: after the handshake, the browsers talk to each
   other **directly**. The MPC protocol messages go only between the peers.
   Google's public STUN server (`stun.1.google.com:19302`, in
   `Networking/WebRTCConnection.h`) helps the peers find their addresses. On
   one LAN they connect with their local addresses.

## What had to change (and why)

| Change | Why |
|---|---|
| `atlas-lobby.html` passes `-ss <page hostname>:8080` to the party | `-ss` defaults to `localhost:8080` (`Processor/OnlineOptions.cpp`). On any device except the server, `localhost` is that device itself, so its party couldn't reach the signaling server. It's a runtime argument, so the `.wasm` didn't need recompiling. |
| `run-servers.sh` takes an optional bind address | Servers bound to `localhost` only accept connections from the same machine. `0.0.0.0` accepts them from the network. |
| `docker-compose.yml`: `pull_policy: never` on `signaling` | That service reuses the image `web` builds locally. Without this, Compose first tried to pull `webspdz-demo:local` from Docker Hub and printed `pull access denied`. |

## Running it

### Option A: Docker (recommended, no Node/Python setup on the host)

On the server laptop:

```bash
docker compose up --build
hostname -I        # first address = <IP> to share, e.g. 10.22.220.246
```

The compose file already binds both servers to `0.0.0.0` and publishes ports
8000/8080 on all host interfaces. Use `--build` again after changing any
`*.html`/`*.js`/`*.wasm`, because the image holds a copy of them.

### Option B: native

Requires Python 3 and Node.js (`sudo apt install nodejs npm`, then
`npm install` in the repo for the `ws` package):

```bash
bash run-servers.sh 0.0.0.0     # prints the lobby URLs to share
```

Without an argument it binds to `localhost` (single-machine mode, as before).

### On every participating device

1. Open `https://<IP>:8000` **and** `https://<IP>:8080` once each and accept
   the self-signed-certificate warning. Both are required: the signaling
   connection (`wss://`) fails silently if its certificate wasn't accepted.
2. Open `https://<IP>:8000/atlas-lobby.html`, enter the private input, and
   press ready. The computation starts when all 4 seats are filled and ready.

The direct `atlas-party.html?arguments=...` links still work, but from another
device you must add the signaling server yourself, e.g.
`...?arguments=-N,4,-T,1,-w,0,-ss,<IP>:8080,1,surplus_matching_private,-OF,.`

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Other devices can't open `https://<IP>:8000` at all | Wi-Fi **client isolation** (common on campus, office and guest networks) blocks device-to-device traffic. Test with `ping <IP>`. Workaround: use a phone hotspot or your own router. Otherwise check the server's firewall for ports 8000/8080. |
| Lobby says it can't reach the signaling server | Certificate for `:8080` not accepted on that device (see step 1), or port 8080 blocked. |
| `bind: address already in use` on 8000/8080 | Another program/container is using the port. Find it with `docker ps` / `ss -ltnp \| grep 8000`. |
| Docker build: `lookup registry-1.docker.io on 192.168.1.1:53 ... i/o timeout` | The active **buildx builder** is a `docker-container` builder that kept the DNS server of the network it was created on. Switch with `docker buildx use default`, or run `BUILDX_BUILDER=default docker compose up --build`. |
| `nodejs: command not found` with `run-servers.sh` | Node isn't installed. Install it or use Docker (Option A). |
| Party tab stalls mid-computation | One device locked its screen or switched away, and the browser suspended the tab. All 4 tabs must stay open in front until the result appears. |

## Which devices work

The WASM build uses `-sMEMORY64`, pthreads (`SharedArrayBuffer`), 500 MB of
initial memory and WASM exceptions.

- **Laptops/desktops** with Chrome ≥ 133 or Firefox ≥ 134: supported.
- **Android** with a current Chrome: should work. Low-RAM phones may refuse
  the 500 MB allocation. Keep the screen on.
- **iPhone/iPad**: unlikely. Every iOS browser uses Safari's engine, which
  lacked Memory64 support as of this writing. Supporting it would need a
  non-Memory64 rebuild, and the bundled `local/wasm64/` libraries are 64-bit
  only.

## Beyond one network

- **Different networks, simplest:** an overlay VPN such as Tailscale/ZeroTier
  puts all machines on one virtual LAN. Use the server's VPN IP as `<IP>`;
  nothing else changes.
- **Public tunnels (ngrok, Cloudflare Tunnel):** they give each port its own
  hostname, which breaks the lobby's "same hostname, port 8080" assumption.
  This needs code changes.
- **Strict NATs without a VPN:** STUN alone may fail, and a TURN server (e.g.
  coturn) would have to be added to the ICE configuration in
  `Networking/WebRTCConnection.h` (requires a rebuild).
