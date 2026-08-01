const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const http = require("http");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dataDir = path.join(__dirname, "data");
const configPath = path.join(dataDir, "config.json");
const defaultConfig = { ssid: "uPrint", pass: "" };

function loadConfig() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (fs.existsSync(configPath)) {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
    }
  } catch (e) {
    console.error("Error leyendo config.json:", e.message);
  }
  return { ...defaultConfig };
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Error guardando config.json:", e.message);
  }
}

let config = loadConfig();
const queue = [];

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx", ".doc", ".xls", ".txt"
]);

function safeExt(originalname) {
  const ext = path.extname(originalname || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const ext = safeExt(file.originalname);
    cb(null, uuidv4() + (ext || ""));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!safeExt(file.originalname)) {
      return cb(new Error("Tipo de archivo no permitido: " + file.originalname));
    }
    cb(null, true);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client", "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard", "index.html"));
});

app.post("/upload", upload.array("files", 10), (req, res) => {
  const clientName = req.body.name || "Cliente";
  const jobId = uuidv4().slice(0, 6).toUpperCase();
  const timestamp = new Date().toISOString();

  const files = req.files.map(f => ({
    originalName: f.originalname,
    savedName: f.filename,
    size: f.size,
    mimetype: f.mimetype
  }));

  const job = { id: jobId, clientName, files, timestamp, status: "pending" };
  queue.push(job);

  io.emit("new_job", job);
  res.json({ success: true, jobId });
});

app.get("/api/queue", (req, res) => res.json(queue));

app.get("/api/config", (req, res) => {
  res.json(config);
});

app.get("/api/qr", (req, res) => {
  let qrString;
  if (req.query.text) {
    qrString = req.query.text;
  } else {
    const ssid = req.query.ssid || config.ssid || "uPrint";
    const pass = req.query.pass !== undefined ? req.query.pass : config.pass;
    qrString = pass ? "WIFI:T:WPA;S:" + ssid + ";P:" + pass + ";;" : "WIFI:T:nopass;S:" + ssid + ";;";
    config.ssid = ssid;
    config.pass = pass;
    saveConfig(config);
  }
  try {
    const png = execFileSync("qrencode", ["-o", "-", "-s", "8", qrString], { encoding: "buffer" });
    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: "Error al generar QR" });
  }
});

app.post("/api/job/:id/status", (req, res) => {
  const validStatuses = ["pending", "done"];
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

app.get("/api/job/:id/download", (req, res) => {
  const job = queue.find(j => j.id === req.params.id);
  if (!job || job.files.length === 0) return res.status(404).json({ error: "Trabajo no encontrado" });

  const uploadsDir = path.join(__dirname, "uploads");
  const zipName = "trabajo-" + job.id + ".zip";
  const zipPath = path.join("/tmp", zipName);

  try {
    const fileArgs = job.files.map(f => path.join(uploadsDir, f.savedName));
    execFileSync("zip", ["-j", zipPath, ...fileArgs]);
    res.download(zipPath, zipName, () => {
      try { fs.unlinkSync(zipPath); } catch (e) {}
    });
  } catch (e) {
    res.status(500).json({ error: "Error al crear ZIP" });
  }
});

app.get("/uploads/:filename", (req, res) => {
  res.sendFile(path.join(__dirname, "uploads", path.basename(req.params.filename)));
});

io.on("connection", (socket) => {
  console.log("Dashboard conectado:", socket.id);
  socket.emit("queue_init", queue);
});

app.use((err, req, res, next) => {
  console.error("Error en request:", err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, error: err.message || "Error en la solicitud" });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("uPrint corriendo en http://0.0.0.0:" + PORT);
});
