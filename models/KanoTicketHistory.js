"use strict";

const mongoose = require("mongoose");

const KanoTicketHistorySchema = new mongoose.Schema(
  {
    drawIndex: { type: Number, required: true },
    gameId: { type: String, required: true, uppercase: true },
    telegramId: { type: String, required: true },
    username: { type: String, default: "Player" },
    ticketId: { type: Number, required: true },
    
    pickedNumbers: { type: [Number], required: true },
    matchedNumbers: { type: [Number], default: [] },
    drawnNumbers: { type: [Number], default: [] },
    
    pickedCount: { type: Number, required: true },
    matchedCount: { type: Number, default: 0 },
    
    betAmount: { type: Number, required: true },
    winAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    multiplier: { type: Number, default: 0 },
    
    result: {
      type: String,
      enum: ["win", "lose", "pending"],
      default: "pending"
    },
  },
  { timestamps: true }
);

// Optimized indexes - no duplicates
// Primary queries: by telegramId + date (for daily history)
KanoTicketHistorySchema.index({ telegramId: 1, createdAt: -1 });
KanoTicketHistorySchema.index({ drawIndex: 1, telegramId: 1 });
KanoTicketHistorySchema.index({ gameId: 1 });
KanoTicketHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("KanoTicketHistory", KanoTicketHistorySchema);

