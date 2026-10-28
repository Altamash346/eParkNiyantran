/**
 * Smart Parking Management System - Billing & Tariff Engine
 * Implements Section 8 of the Implementation Plan and College Parking System Flow.
 */

// Default standard tariff table according to specification
const DEFAULT_TARIFF = {
  version: 'v1.0.0',
  name: 'Standard Marketplace / College Tariff',
  freeGracePeriodSeconds: 15 * 60, // < 15 min = Nil
  tiers: [
    { maxSeconds: 15 * 60 - 1, label: '< 15 minutes', basicCharge: 0, pendingFineCharge: 50, banDays: 0 },
    { maxSeconds: 60 * 60, label: 'Up to 60 minutes', basicCharge: 100, pendingFineCharge: 200, banDays: 0 },
    { maxSeconds: 90 * 60, label: 'Up to 90 minutes', basicCharge: 250, pendingFineCharge: 500, banDays: 0 },
    { maxSeconds: 180 * 60, label: 'Up to 180 minutes', basicCharge: 500, pendingFineCharge: 1000, banDays: 0 },
    { maxSeconds: Infinity, label: '> 180 minutes', basicCharge: 1000, pendingFineCharge: 2000, banDays: 10 }
  ],
  latePaymentFinePerDay: 100, // ₹100-per-day late payment fine
  agencyFeePercentage: 10,   // 10% paid to parking personnel agency
  twoWheelerDiscountFactor: 0.5 // Optional 50% concession for two-wheelers
};

/**
 * Calculate parking charges based on duration, pending fine flag, and vehicle category.
 *
 * @param {number} durationSeconds - Duration parked in seconds
 * @param {boolean} hasPendingFine - Whether vehicle has an existing unpaid violation
 * @param {string} vehicleCategory - '2W' (two-wheeler) or '4W' (four-wheeler)
 * @param {object} customTariff - Optional custom tariff overriding defaults
 * @returns {object} Calculated charges and ban status
 */
function calculateParkingCharge(durationSeconds, hasPendingFine = false, vehicleCategory = '4W', customTariff = DEFAULT_TARIFF) {
  const seconds = Math.max(0, Math.floor(durationSeconds));
  const tariff = customTariff || DEFAULT_TARIFF;
  
  // Find applicable tier
  let matchedTier = tariff.tiers[tariff.tiers.length - 1];
  for (const tier of tariff.tiers) {
    if (seconds <= tier.maxSeconds) {
      matchedTier = tier;
      break;
    }
  }

  // Base charge based on whether there is an existing pending fine
  let baseCharge = hasPendingFine ? matchedTier.pendingFineCharge : matchedTier.basicCharge;
  
  // Apply vehicle category modifier (e.g., 2-wheelers get a concession if configured)
  const categoryMultiplier = vehicleCategory === '2W' ? (tariff.twoWheelerDiscountFactor || 1.0) : 1.0;
  const adjustedBaseCharge = Math.round(baseCharge * categoryMultiplier);

  // Agency share: 10% of basic charge (calculated on standard basic charge rate)
  const agencyShare = Math.round(adjustedBaseCharge * (tariff.agencyFeePercentage / 100));
  const facilityShare = adjustedBaseCharge - agencyShare;

  // Ban flag: if duration > 180 minutes, propose 10-day parking ban
  const appliesBan = matchedTier.banDays > 0;
  const banDays = matchedTier.banDays || 0;

  return {
    durationSeconds: seconds,
    durationFormatted: formatDuration(seconds),
    tierLabel: matchedTier.label,
    hasPendingFine: !!hasPendingFine,
    vehicleCategory,
    basicCharge: adjustedBaseCharge,
    rawStandardCharge: baseCharge,
    agencyShare,
    facilityShare,
    appliesBan,
    banDays,
    tariffVersion: tariff.version
  };
}

/**
 * Calculate late fine for overdue unpaid sessions
 * @param {number} daysOverdue
 * @param {object} customTariff
 */
function calculateOverdueFine(daysOverdue, customTariff = DEFAULT_TARIFF) {
  const days = Math.max(0, Math.floor(daysOverdue));
  const rate = customTariff.latePaymentFinePerDay || 100;
  return days * rate;
}

/**
 * Determine if a 5-minute reminder should be scheduled or sent
 * 5 minutes before the next tier boundary.
 *
 * @param {number} currentDurationSeconds
 * @param {object} customTariff
 */
function checkFiveMinuteReminder(currentDurationSeconds, customTariff = DEFAULT_TARIFF) {
  const reminderWindowSeconds = 5 * 60; // 5 minutes before tier end
  const tariff = customTariff || DEFAULT_TARIFF;

  for (const tier of tariff.tiers) {
    if (tier.maxSeconds !== Infinity) {
      const reminderThreshold = tier.maxSeconds - reminderWindowSeconds;
      if (currentDurationSeconds >= reminderThreshold && currentDurationSeconds < tier.maxSeconds) {
        const remainingSeconds = tier.maxSeconds - currentDurationSeconds;
        return {
          shouldTrigger: true,
          approachingTier: tier.label,
          remainingSeconds,
          remainingMinutes: Math.ceil(remainingSeconds / 60),
          message: `Your vehicle is 5 minutes away from exceeding the ${tier.label} parking slab. Please exit or prepare for the next tariff tier.`
        };
      }
    }
  }

  return { shouldTrigger: false };
}

/**
 * Format seconds into HH:MM:SS or readable text
 */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

module.exports = {
  DEFAULT_TARIFF,
  calculateParkingCharge,
  calculateOverdueFine,
  checkFiveMinuteReminder,
  formatDuration
};
