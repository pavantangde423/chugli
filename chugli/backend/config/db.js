const mongoose = require("mongoose");
const dns = require("dns");

// Use public DNS to resolve MongoDB Atlas SRV records
dns.setServers(["8.8.8.8", "1.1.1.1"]);

async function connectDB() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("Missing MONGO_URI in environment variables");
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");
}

module.exports = connectDB;
