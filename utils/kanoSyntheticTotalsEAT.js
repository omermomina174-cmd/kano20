"use strict";

const { getEATNow } = require("./timeEAT");

/**
 * Clamps a number between min and max
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Linear interpolation
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Adds random jitter (±percent)
 */
function jitter(value, percent = 0.05) {
  const variation = value * percent * (Math.random() * 2 - 1);
  return value + variation;
}

/**
 * Skewed random that favors lower values
 * Returns value between 0 and 1, skewed toward 0
 * Power > 1 means more skew toward lower values
 */
function skewedRandom(power = 2) {
  return Math.pow(Math.random(), power);
}

/**
 * Get day-of-week activity factor
 * Sunday = 0, Saturday = 6
 * 
 * Weekends (Fri, Sat, Sun) = Higher activity
 * Weekdays = Lower activity
 * Monday = Lowest
 */
function getDayOfWeekFactor(dayOfWeek) {
  const factors = {
    0: 0.85,  // Sunday - high (people resting)
    1: 0.45,  // Monday - lowest (work starts)
    2: 0.55,  // Tuesday
    3: 0.60,  // Wednesday
    4: 0.70,  // Thursday
    5: 0.90,  // Friday - high (weekend starts)
    6: 1.00   // Saturday - highest
  };
  return factors[dayOfWeek] ?? 0.60;
}

/**
 * Get hour-based activity factor (EAT timezone)
 * 
 * 00-06: Very low (sleeping)
 * 06-09: Waking up, low
 * 09-12: Morning activity
 * 12-14: Lunch break peak
 * 14-18: Afternoon
 * 18-22: Evening peak
 * 22-24: Night, declining
 */
function getHourFactor(hour) {
  if (hour >= 0 && hour < 6) {
    // Night: 0.15 - 0.25
    return lerp(0.20, 0.15, hour / 6);
  }
  if (hour >= 6 && hour < 9) {
    // Early morning: 0.25 - 0.45
    return lerp(0.25, 0.45, (hour - 6) / 3);
  }
  if (hour >= 9 && hour < 12) {
    // Morning: 0.45 - 0.70
    return lerp(0.45, 0.70, (hour - 9) / 3);
  }
  if (hour >= 12 && hour < 14) {
    // Lunch peak: 0.70 - 0.85
    return lerp(0.70, 0.85, (hour - 12) / 2);
  }
  if (hour >= 14 && hour < 18) {
    // Afternoon: 0.75 - 0.80
    return lerp(0.80, 0.75, (hour - 14) / 4);
  }
  if (hour >= 18 && hour < 21) {
    // Evening peak: 0.85 - 1.00
    return lerp(0.85, 1.00, (hour - 18) / 3);
  }
  if (hour >= 21 && hour < 23) {
    // Late evening: 1.00 - 0.60
    return lerp(1.00, 0.60, (hour - 21) / 2);
  }
  // 23-24: declining
  return lerp(0.60, 0.35, (hour - 23));
}

/**
 * Generates synthetic totals with realistic patterns
 * 
 * Range: 10,000 - 30,000
 * Distribution: Skewed toward lower-mid values (15k-22k most common)
 * Max (30k) rarely touched
 * Factors: Hour of day + Day of week
 */
function generateSyntheticTotals({ 
  min = 10000, 
  max = 30000, 
  targetRtp = 70 
} = {}) {
  const { hour, dayOfWeek } = getEATNow();
  
  const hourFactor = getHourFactor(hour);
  const dayFactor = getDayOfWeekFactor(dayOfWeek);
  
  // Combined factor (weighted: hour matters more during the day)
  // Range: roughly 0.1 to 1.0
  const combinedFactor = (hourFactor * 0.7) + (dayFactor * 0.3);
  
  // Use skewed random to favor lower-mid values
  // skewPower 1.8 means ~70% of values will be in lower 50% of range
  const skewPower = 1.8;
  const randomComponent = skewedRandom(skewPower);
  
  // Base calculation:
  // At factor 0 -> tends toward min
  // At factor 1 -> can reach max (but rarely due to skew)
  const range = max - min; // 20,000
  
  // effectiveMax decreases based on inverse of combined factor
  // This makes max values rare
  const effectiveMax = min + (range * combinedFactor * 0.95);
  
  // Calculate base with skew toward lower values
  const baseValue = min + (randomComponent * (effectiveMax - min));
  
  // Add small jitter (±3%)
  const totalBets = Math.round(clamp(jitter(baseValue, 0.03), min, max));
  
  // Payout follows RTP with jitter
  const rtpDecimal = Number(targetRtp || 70) / 100;
  const payoutBase = totalBets * rtpDecimal;
  const totalPayout = Math.round(clamp(jitter(payoutBase, 0.04), 0, totalBets));
  
  // Tickets follow similar pattern but slightly different
  const ticketBase = min + (skewedRandom(1.6) * (effectiveMax - min));
  const totalTickets = Math.round(clamp(jitter(ticketBase, 0.04), min, max));
  
  // Players derived from tickets
  // More tickets per player during peak hours (people play more)
  const avgTicketsPerPlayer = lerp(2.5, 5.5, combinedFactor);
  const totalPlayers = Math.max(1, Math.round(totalTickets / avgTicketsPerPlayer));
  
  // Actual RTP for this synthetic data
  const actualRtp = totalBets > 0 ? (totalPayout / totalBets) * 100 : 0;
  
  return {
    // Timing info
    hourEAT: hour,
    dayOfWeek,
    hourFactor: Number(hourFactor.toFixed(3)),
    dayFactor: Number(dayFactor.toFixed(3)),
    combinedFactor: Number(combinedFactor.toFixed(3)),
    
    // Synthetic values
    totalBets,
    totalPayout,
    totalTickets,
    totalPlayers,
    
    // RTP
    targetRtp: Number(targetRtp),
    actualRtp: Number(actualRtp.toFixed(2))
  };
}

/**
 * Get current day name for logging
 */
function getDayName(dayOfWeek) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[dayOfWeek] || "Unknown";
}

module.exports = {
  generateSyntheticTotals,
  getDayName,
  getHourFactor,
  getDayOfWeekFactor
};