# uPrint

Print shop file drop system. Customers scan a QR, connect to the shop's WiFi hotspot, upload files from their phone's browser, and the employee receives them in real time on a dashboard. Replaces WhatsApp.

## Architecture

```
Customer phone                CachyOS (server)              Windows 11 (dashboard)
     │                              │                              │
     ├─ WiFi captive portal ──────►│                              │
     ├─ upload files ─────────────►│                              │
     │                              ├─ Socket.io real-time ──────►│
     │                              │   (http://IP:3000/dashboard/)│
     │                              │                              │
     │  QR 1: WiFi connection       │                              │
     │  QR 2: http://192.168.10.1:3000                             │
```

## How it works

1. **Customer scans QR 1** → phone connects to `uPrint` WiFi (open network, no password)
2. **Customer scans QR 2** → browser opens `http://192.168.10.1:3000` (without QR, the captive portal auto-popup also opens the upload page)
3. **Upload** → files are sent via POST to the Node.js server with progress indicator
4. **Job code** → customer receives a 6-character alphanumeric code to tell the employee
5. **Dashboard** → employee's screen shows new job in real time with sound notification
6. **Actions** → employee can mark as "done"
7. **MAC block** → after upload, `nftables` blocks the customer's MAC so they can't keep using the WiFi

## Network stack

| Component | Role |
|---|---|
| `hostapd` | Converts USB WiFi adapter into an access point (SSID: uPrint) |
| `dnsmasq` | DHCP server (192.168.10.100-200) + DNS hijack (all domains → 192.168.10.1) |
| `nftables` | Firewall: blocks internet access, redirects HTTP port 80 → 3000, blocks MAC after upload |
| `enp1s0` | Ethernet — internet uplink |
| `wlan0` | USB WiFi adapter — customer hotspot |

No internet access for customers — they can only reach uPrint.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| File upload | Multer (up to 50MB, up to 10 files) |
| Real-time | Socket.io (WebSocket) |
| Client UI | HTML/CSS/JS — no frameworks, no build step |
| Dashboard | HTML/CSS/JS — same approach, Socket.io for live updates |
| Firewall | nftables (Linux kernel) |
| Hotspot | hostapd + dnsmasq |
| Server OS | CachyOS (Arch Linux) |
| Shell | Fish |

## Project structure

```
printflow/
├── server/
│   ├── index.js           # Express + Socket.io + Multer backend
│   ├── package.json
│   ├── uploads/           # Files uploaded by customers (gitignored)
│   └── public/
│       ├── client/
│       │   └── index.html # Mobile upload page (customer-facing)
│       └── dashboard/
│           └── index.html # Employee dashboard with real-time queue
├── .gitignore
└── README.md
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Customer upload page |
| `GET` | `/dashboard/` | Employee dashboard |
| `GET` | `/api/mymac` | Detect client MAC via ARP table |
| `POST` | `/upload` | Upload files (multipart, max 10 files, 50MB each) |
| `GET` | `/api/queue` | Get full job queue |
| `POST` | `/api/job/:id/status` | Update job status (`pending` / `done`) |
| `POST` | `/api/job/:id/done` | Mark job as done (legacy) |
| `GET` | `/uploads/:filename` | Serve uploaded file for preview |
| `*` | `*` | Catch-all → redirect to `/` (captive portal detection) |

## System files (not in repo)

```
/etc/hostapd/hostapd.conf   # WiFi access point config
/etc/dnsmasq.conf           # DHCP + DNS hijack
/etc/nftables.conf          # Firewall rules
/etc/sudoers.d/printflow    # Passwordless sudo for /usr/sbin/nft
```

## Dependencies

**System (pacman):**
- `hostapd` — WiFi access point
- `dnsmasq` — DHCP + DNS
- `nftables` — Linux kernel firewall (built-in)

**Node.js (npm):**
- `express` — HTTP server
- `multer` — File upload handling
- `socket.io` — Real-time communication
- `cors` — Cross-origin requests
- `uuid` — Unique file names

## Running the server

```bash
cd server
export PATH="$HOME/.local/share/mise/installs/node/26.4.0/bin:$PATH"
setsid node index.js >> /tmp/printflow.log 2>&1 &

# Check if running
ss -tlnp | grep 3000
curl -s http://localhost:3000/ | head -3
```

## Docker

### Build and run locally

```bash
# Build image
docker build -t rluccadev/uprint:latest .

# Run with persistent data and uploads
mkdir -p data uploads
docker run -d --name uprint -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -v "$PWD/uploads:/app/uploads" \
  --restart unless-stopped \
  rluccadev/uprint:latest
```

### Docker Compose

```bash
mkdir -p data uploads
docker compose up -d
```

### Push to Docker Hub

```bash
# Login (only once per machine)
docker login

# Build and push
docker build -t rluccadev/uprint:latest .
docker push rluccadev/uprint:latest
```

### Pull and run on the server

```bash
mkdir -p uprint && cd uprint

curl -o docker-compose.yml https://raw.githubusercontent.com/Rlucca224/printflow/main/docker-compose.yml
mkdir -p data uploads

docker compose pull
docker compose up -d
```

## License

MIT
