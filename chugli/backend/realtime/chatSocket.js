const jwt = require("jsonwebtoken");

const Message = require("../models/Message");
const User = require("../models/User");

const HISTORY_LIMIT = 50;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Socket.IO handshake authentication.
 * The client passes the JWT via `io(url, { auth: { token } })`.
 */
function authenticateSocket(socket, next) {
  const headerToken = socket.handshake.headers?.authorization;
  const token =
    socket.handshake.auth?.token ||
    (typeof headerToken === "string" ? headerToken.replace(/^Bearer\s+/i, "") : "");

  if (!token) {
    return next(new Error("UNAUTHORIZED"));
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return next(new Error("SERVER_CONFIG_ERROR"));
  }

  try {
    const decoded = jwt.verify(token, secret);
    socket.data.user = decoded; // { userId, email }
  } catch (err) {
    return next(new Error("UNAUTHORIZED"));
  }

  next();
}

/**
 * Registers all realtime chat handlers on the given Socket.IO server.
 * Messages are persisted to MongoDB and history is replayed from the DB,
 * so chat survives server restarts and works across multiple instances.
 */
function attachChatSocket(io) {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const user = socket.data.user;
    const joinedRooms = new Set();

    // Resolve the sender's anonymous handle lazily (once) from the DB so we
    // never trust a client-supplied identity. Done lazily so that listener
    // registration is fully synchronous and no early events are dropped.
    let handlePromise = null;
    const getHandle = () => {
      if (!handlePromise) {
        handlePromise = User.findById(user.userId)
          .select("anonymousHandle")
          .lean()
          .then((account) => account?.anonymousHandle || "@Anonymous")
          .catch((err) => {
            console.error("Failed to resolve handle for user:", err);
            return "@Anonymous";
          });
      }
      return handlePromise;
    };

    const emitRoomUsers = (roomId) => {
      const room = io.sockets.adapter.rooms.get(roomId);
      const count = room ? room.size : 0;
      io.to(roomId).emit("room_users", { roomId, count });
    };

    socket.on("join_room", async ({ roomId } = {}, ack) => {
      if (!roomId) return;
      const rid = String(roomId);

      try {
        socket.join(rid);
        joinedRooms.add(rid);

        // Load the most recent messages, then return them chronologically.
        const docs = await Message.find({ roomId: rid })
          .sort({ createdAt: -1 })
          .limit(HISTORY_LIMIT);

        const messages = docs.reverse().map((doc) => doc.toJSON());
        socket.emit("chat_history", { roomId: rid, messages });
        emitRoomUsers(rid);

        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("join_room error:", err);
        if (typeof ack === "function") ack({ ok: false, error: "JOIN_FAILED" });
      }
    });

    socket.on("leave_room", ({ roomId } = {}) => {
      if (!roomId) return;
      const rid = String(roomId);
      socket.leave(rid);
      joinedRooms.delete(rid);
      emitRoomUsers(rid);
    });

    socket.on("send_message", async (payload = {}, ack) => {
      const respond = (res) => {
        if (typeof ack === "function") ack(res);
      };

      try {
        const rid = String(payload.roomId || "");
        const text =
          typeof payload.message === "string" ? payload.message.trim() : "";

        if (!rid || !text) {
          return respond({ ok: false, error: "INVALID_MESSAGE" });
        }
        if (text.length > MAX_MESSAGE_LENGTH) {
          return respond({ ok: false, error: "MESSAGE_TOO_LONG" });
        }
        // Only accept messages for rooms this socket actually joined.
        if (!joinedRooms.has(rid)) {
          return respond({ ok: false, error: "NOT_IN_ROOM" });
        }

        const saved = await Message.create({
          roomId: rid,
          sender: user.userId,
          handle: await getHandle(),
          message: text,
        });

        const outgoing = saved.toJSON();
        io.to(rid).emit("receive_message", outgoing);
        respond({ ok: true, id: outgoing.id });
      } catch (err) {
        console.error("send_message error:", err);
        respond({ ok: false, error: "SEND_FAILED" });
      }
    });

    socket.on("disconnect", () => {
      for (const rid of joinedRooms) {
        emitRoomUsers(rid);
      }
    });
  });
}

module.exports = { attachChatSocket };
