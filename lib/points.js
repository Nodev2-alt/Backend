const TIER_PPT = {
  bronze:  parseInt(process.env.BRONZE_PPT)  || 1,
  silver:  parseInt(process.env.SILVER_PPT)  || 5,
  gold:    parseInt(process.env.GOLD_PPT)    || 10,
  diamond: parseInt(process.env.DIAMOND_PPT) || 30,
}

const CLAIM_WINDOWS = {
  bronze:  parseInt(process.env.BRONZE_CLAIM_MS)  || 21600000,
  silver:  parseInt(process.env.SILVER_CLAIM_MS)  || 43200000,
  gold:    parseInt(process.env.GOLD_CLAIM_MS)    || 86400000,
  diamond: null,
}

const INVITE_SLOTS = {
  bronze:  0,
  silver:  5,
  gold:    10,
  diamond: 20,
}

function calcPoints(tier, uptimeMs) {
  const ticks = Math.floor((uptimeMs / 1000) / 4)
  return ticks * TIER_PPT[tier]
}

function nextClaimAt(tier) {
  const window = CLAIM_WINDOWS[tier]
  if (!window) return null
  return new Date(Date.now() + window)
}

function affiliatePoints(pointsEarned) {
  return Math.floor(pointsEarned * (parseInt(process.env.AFFILIATE_POINTS_PCT) || 5) / 100)
}

function affiliateUsdc(amountUsdc) {
  return Math.floor(amountUsdc * (parseInt(process.env.AFFILIATE_USDC_PCT) || 10) / 100)
}

module.exports = { calcPoints, nextClaimAt, affiliatePoints, affiliateUsdc, CLAIM_WINDOWS, TIER_PPT, INVITE_SLOTS }
