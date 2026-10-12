const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    handle: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

// Efficient "load last N messages for a room" reads.
messageSchema.index({ roomId: 1, createdAt: 1 });

// Rooms auto-expire after 2h (see Room model), so messages share the same
// lifecycle. Remove this index if you want chat history kept permanently.
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7200 });

// Emit a flat, client-friendly shape: { id, roomId, handle, message, timestamp }.
messageSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    ret.timestamp = (ret.createdAt || new Date()).toISOString();
    delete ret._id;
    delete ret.__v;
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  },
});

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
