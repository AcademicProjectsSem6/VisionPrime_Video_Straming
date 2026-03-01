const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Only use HTTPS when started via start-https.js (so "npm start" is always HTTP)
// On Render you should use HTTP behind Render's TLS proxy.
const startedViaHttpsScript =
  require.main && path.basename(require.main.filename) === "start-https.js";

let selfsigned;
if (startedViaHttpsScript) {
  try {
    selfsigned = require("selfsigned");
  } catch (e) {
    console.error(
      "HTTPS mode requires the 'selfsigned' package. In the server folder run: npm install"
    );
    process.exit(1);
  }
}
const useHttpsForReal = startedViaHttpsScript;

const app = express();

// Render sits behind a proxy (TLS termination). This helps if you ever check req.secure etc.
app.set("trust proxy", 1);

// ——— CORS ———
// For quick testing we keep "*" (works for most Socket.IO setups without credentials).
// If you later need credentials/cookies, set an explicit origin instead of "*".
app.use(cors());
app.use(express.json());

// ——— Security headers ———
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  if (useHttpsForReal) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
});

// Health check
app.get("/ping", (req, res) => res.json({ ok: true, message: "Server is running" }));

// Serve client (video/client) for local run and deployment
const clientDir = path.join(__dirname, "..", "client");
app.use(express.static(clientDir));


let server;

if (useHttpsForReal) {
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    algorithm: "sha256",
    keySize: 2048,
  });

  server = https.createServer({ key: pems.private, cert: pems.cert }, app);

  console.log(
    "HTTPS mode: use https://<this-pc-ip>:" +
      (process.env.PORT || 3000) +
      " (accept the certificate warning for camera/mic to work)"
  );
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

function sanitizeRoomId(roomId) {
  if (typeof roomId !== "string" || !roomId.trim()) return null;
  const s = roomId.trim().slice(0, 64);
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function sanitizeMessage(msg) {
  if (typeof msg !== "string") return "";
  return msg.trim().slice(0, 2000);
}
function sanitizeDisplayName(name) {
  if (typeof name !== "string") return "Participant";
  return name.trim().slice(0, 32) || "Participant";
}

const peerInfo = new Map();
const roomHost = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", async (data) => {
    const room = sanitizeRoomId(
      typeof data === "string" ? data : data && data.roomId
    );
    if (!room) {
      socket.emit("error", { message: "Room ID is required" });
      return;
    }
    const displayName = sanitizeDisplayName(data && data.displayName);

    peerInfo.set(socket.id, { room, displayName });
    if (!roomHost.has(room)) roomHost.set(room, socket.id);

    socket.join(room);

    const roomSockets = await io.in(room).fetchSockets();
    const existing = roomSockets
      .filter((s) => s.id !== socket.id)
      .map((s) => {
        const info = peerInfo.get(s.id) || {};
        return {
          id: s.id,
          displayName: info.displayName || s.id.slice(0, 8),
          isHost: s.id === roomHost.get(room),
        };
      });

    socket.emit("existing-peers", existing);
    socket.emit("room-joined", { isHost: socket.id === roomHost.get(room) });
    socket
      .to(room)
      .emit("user-joined", { id: socket.id, displayName, isHost: false });
  });

  socket.on("set-display-name", (data) => {
    const name = sanitizeDisplayName(data && data.name);
    const info = peerInfo.get(socket.id);
    if (!info) return;
    info.displayName = name;
    socket.to(info.room).emit("user-renamed", { id: socket.id, displayName: name });
  });

  socket.on("leave-room", async (roomId) => {
    const room = sanitizeRoomId(roomId);
    if (!room) return;
    
    const info = peerInfo.get(socket.id);
    if (info) {
      socket.leave(room);
      socket.to(room).emit("user-left", { id: socket.id });
      peerInfo.delete(socket.id);
    }

    const wasHost = roomHost.get(room) === socket.id;
    if (wasHost) {
      const sockets = await io.in(room).fetchSockets();
      const newHost = sockets[0] && sockets[0].id;
      if (newHost) {
        roomHost.set(room, newHost);
        io.to(room).emit("host-changed", { hostId: newHost });
      } else {
        roomHost.delete(room);
      }
    }
  });

  // WebRTC signaling events
  socket.on("offer", (data) => {
    if (!data || !data.to) return;
    socket.to(data.to).emit("offer", { from: socket.id, offer: data.offer });
  });

  socket.on("answer", (data) => {
    if (!data || !data.to) return;
    socket.to(data.to).emit("answer", { from: socket.id, answer: data.answer });
  });

  socket.on("ice-candidate", (data) => {
    if (!data || !data.to) return;
    socket
      .to(data.to)
      .emit("ice-candidate", { from: socket.id, candidate: data.candidate });
  });

  // Chat
  socket.on("chat-message", (data) => {
    if (!data) return;
    const room = sanitizeRoomId(data.room);
    const message = sanitizeMessage(data.message);
    if (!message) return;

    const info = peerInfo.get(socket.id) || {};
    const isHost = roomHost.get(room) === socket.id;

    io.to(room).emit("chat-message", {
      from: socket.id,
      displayName: info.displayName || socket.id.slice(0, 8),
      isHost,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on("disconnect", async () => {
    const info = peerInfo.get(socket.id);
    if (info) {
      const room = info.room;
      socket.to(room).emit("user-left", { id: socket.id });
      peerInfo.delete(socket.id);

      const wasHost = roomHost.get(room) === socket.id;
      if (wasHost) {
        const sockets = await io.in(room).fetchSockets();
        const newHost = sockets[0] && sockets[0].id;
        if (newHost) {
          roomHost.set(room, newHost);
          io.to(room).emit("host-changed", { hostId: newHost });
        } else {
          roomHost.delete(room);
        }
      }
    }

    console.log("User disconnected:", socket.id);
  });
});

// Render provides PORT. Default to 10000 for local parity with Render.
const PORT = process.env.PORT || 10000;

server
  .listen(PORT, "0.0.0.0", () => {
    const scheme = useHttpsForReal ? "https" : "http";
    console.log(`Server running on port ${PORT} (${useHttpsForReal ? "HTTPS" : "HTTP"})`);

    // On Render your public URL will be https://<your-service>.onrender.com
    console.log(`Local: ${scheme}://localhost:${PORT}`);
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });