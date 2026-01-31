"use strict";

const mongoose = require("mongoose");

const KanoDrawHistorySchema = new mongoose.Schema(
  {
    drawIndex: { 
      type: Number, 
      required: true, 
      unique: true,
      min: 1,
      max: 100 
    },
    gameId: { 
      type: String, 
      required: true, 
      uppercase: true 
      // Removed unique: true since gameId changes when drawIndex cycles
    },
    drawnNumbers: { type: [Number], required: true },
    
    // Synthetic stats (for display)
    totalBets: { type: Number, default: 0 },
    totalPayout: { type: Number, default: 0 },
    totalPlayers: { type: Number, default: 0 },
    totalTickets: { type: Number, default: 0 },
    
    targetRtp: { type: Number, default: 70 },
    actualRtp: { type: Number, default: 0 },
    
    simulationsRun: { type: Number, default: 100 },
    selectedSimulationIndex: { type: Number, default: 0 },
    
    // Real stats
    realTotalBets: { type: Number, default: 0 },
    realTotalPayout: { type: Number, default: 0 },
    realTotalPlayers: { type: Number, default: 0 },
    realActualRtp: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Only indexes needed - drawIndex already has unique:true (creates index automatically)
KanoDrawHistorySchema.index({ createdAt: -1 });
KanoDrawHistorySchema.index({ gameId: 1 });

module.exports = mongoose.model("KanoDrawHistory", KanoDrawHistorySchema);