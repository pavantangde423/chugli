const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");
const { attachChatSocket } = require("./realtime/chatSocket");

dotenv.config();

const app = express();

const server = http.createServer(app);

const corsOrigin = (process.env.CORS_ORIGIN || "*").replace(/\/+$/, "");

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
  },
});

app.set("io", io);

app.use(express.json());

app.use(
  cors({
    origin: corsOrigin,
  })
);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);

const PORT = process.env.PORT || 5000;

// Realtime chat (JWT-authenticated, persisted to MongoDB).
attachChatSocket(io);

(async () => {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
