const net = require("net");
const dns = require("dns");

const ALLOWED_DOMAINS = [
  "mercadopago.com",
  "mercadopago.com.ar",
  "mercadolibre.com",
  "mercadolibre.com.ar",
  "mlstatic.com"
];

const PORT = 8443;
const MAX_BUFFER = 16384;
const HANDSHAKE_TIMEOUT_MS = 8000;

function isAllowed(hostname) {
  if (!hostname) return false;
  hostname = hostname.toLowerCase();
  return ALLOWED_DOMAINS.some(function (domain) {
    return hostname === domain || hostname.endsWith("." + domain);
  });
}

function extractSNI(buf) {
  try {
    if (buf.length < 5) return undefined;
    if (buf[0] !== 0x16) return null;
    const recordLen = buf.readUInt16BE(3);
    if (buf.length < 5 + recordLen) return undefined;

    let i = 5;
    if (buf[i] !== 0x01) return null;
    i += 4;
    i += 2;
    i += 32;

    const sessionIdLen = buf[i];
    i += 1 + sessionIdLen;

    const cipherSuitesLen = buf.readUInt16BE(i);
    i += 2 + cipherSuitesLen;

    const compressionLen = buf[i];
    i += 1 + compressionLen;

    if (i + 2 > buf.length) return null;
    const extensionsLen = buf.readUInt16BE(i);
    i += 2;
    const extensionsEnd = i + extensionsLen;

    while (i + 4 <= extensionsEnd) {
      const extType = buf.readUInt16BE(i);
      i += 2;
      const extLen = buf.readUInt16BE(i);
      i += 2;

      if (extType === 0x00) {
        let j = i + 2;
        const nameType = buf[j];
        j += 1;
        const nameLen = buf.readUInt16BE(j);
        j += 2;
        if (nameType === 0x00) {
          return buf.toString("utf8", j, j + nameLen);
        }
      }
      i += extLen;
    }
    return null;
  } catch (e) {
    return null;
  }
}

const server = net.createServer(function (clientSocket) {
  let buffered = Buffer.alloc(0);
  let resolved = false;

  clientSocket.setTimeout(HANDSHAKE_TIMEOUT_MS, function () {
    clientSocket.destroy();
  });
  clientSocket.on("error", function () {});
  clientSocket.on("data", onData);

  function onData(chunk) {
    if (resolved) return;
    buffered = Buffer.concat([buffered, chunk]);

    if (buffered.length > MAX_BUFFER) {
      clientSocket.destroy();
      return;
    }

    const sni = extractSNI(buffered);
    if (sni === undefined) return;

    resolved = true;
    clientSocket.removeListener("data", onData);
    clientSocket.pause();

    if (!isAllowed(sni)) {
      console.log("[sni-proxy] BLOQUEADO: " + (sni || "(sin SNI)"));
      clientSocket.destroy();
      return;
    }

    console.log("[sni-proxy] PERMITIDO: " + sni);

    dns.lookup(sni, function (err, address) {
      if (err || !clientSocket.writable) {
        clientSocket.destroy();
        return;
      }
      const upstream = net.connect(443, address, function () {
        upstream.write(buffered);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
        clientSocket.resume();
      });
      upstream.on("error", function () {
        clientSocket.destroy();
      });
      clientSocket.on("close", function () {
        upstream.destroy();
      });
    });
  }
});

server.on("error", function (e) {
  console.error("[sni-proxy] Error del servidor:", e.message);
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("SNI proxy escuchando en 0.0.0.0:" + PORT);
});
