const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const queue = [];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client", "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard", "index.html"));
});

app.get("/api/mymac", (req, res) => {
  const clientIp = (req.ip || "").replace("::ffff:", "");
  try {
    const arp = fs.readFileSync("/proc/net/arp", "utf8");
    const line = arp.split("\n").find(l => l.includes(clientIp));
    if (line) {
      const parts = line.trim().split(/\s+/);
      res.json({ mac: parts[3] });
    } else {
      res.json({ mac: null });
    }
  } catch (e) {
    res.json({ mac: null });
  }
});

app.post("/upload", upload.array("files", 10), (req, res) => {
  const clientName = req.body.name || "Cliente";
  const clientMac = req.body.mac || null;
  const jobId = uuidv4().slice(0, 6).toUpperCase();
  const timestamp = new Date().toISOString();

  const files = req.files.map(f => ({
    originalName: f.originalname,
    savedName: f.filename,
    size: f.size,
    mimetype: f.mimetype
  }));

  const job = { id: jobId, clientName, files, timestamp, status: "pending", clientMac };
  queue.push(job);

  io.emit("new_job", job);

  if (clientMac) {
    try {
      execSync("sudo nft add rule inet printflow forward iif wlan0 ether saddr " + clientMac + " drop");
    } catch (e) {
      console.log("No se pudo bloquear MAC:", e.message);
    }
  }

  res.json({ success: true, jobId });
});

app.get("/api/queue", (req, res) => res.json(queue));

app.post("/api/job/:id/status", (req, res) => {
  const validStatuses = ["pending", "printing", "done"];
  const status = req.body.status;
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: "Estado invalido" });
  }
  const job = queue.find(j => j.id === req.params.id);
  if (job) {
    job.status = status;
    io.emit("job_updated", job);
  }
  res.json({ success: true });
});

app.post("/api/job/:id/done", (req, res) => {
  const job = queue.find(j => j.id === req.params.id);
  if (job) {
    job.status = "done";
    io.emit("job_updated", job);
  }
  res.json({ success: true });
});

app.get("/uploads/:filename", (req, res) => {
  res.sendFile(path.join(__dirname, "uploads", req.params.filename));
});

app.use((req, res) => {
  res.redirect("/");
});

io.on("connection", (socket) => {
  console.log("Dashboard conectado:", socket.id);
  socket.emit("queue_init", queue);
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("PrintFlow corriendo en http://0.0.0.0:" + PORT);
});
