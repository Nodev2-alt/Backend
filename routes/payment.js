const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { verifyPayment } = require('../lib/verify')
const { requireAuth } = require('../middleware/auth')
const { affiliateUsdc, INVITE_SLOTS } = require('../lib/points')

// POST /payment/verify
router.post('/verify', requireAuth, async (req, res) => {
  const { tx_hash, tier } = req.body
  const user = req.user

  if (!tx_hash || !tier) {
    return res.status(400).json({ error: 'tx_hash and tier are required' })
  }

  const validTiers = ['silver', 'gold', 'diamond']
  if (!validTiers.includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' })
  }

  const tierRank = { bronze: 0, silver: 1, gold: 2, diamond: 3 }
  if (tierRank[tier] <= tierRank[user.tier]) {
    return res.status(400).json({ error: `Already on ${user.tier} or higher` })
  }

  // Check tx not already used
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, verified')
    .eq('tx_hash', tx_hash)
    .single()

  if (existingTx?.verified) {
    return res.status(409).json({ error: 'Transaction already used' })
  }

  const tierPrices = {
    silver:  parseInt(process.env.SILVER_PRICE_USDC),
    gold:    parseInt(process.env.GOLD_PRICE_USDC),
    diamond: parseInt(process.env.DIAMOND_PRICE_USDC),
  }

  // Log attempt
  await supabase.from('transactions').upsert({
    tx_hash,
    user_id:        user.id,
    from_wallet:    user.wallet,
    to_wallet:      process.env.OWNER_WALLET.toLowerCase(),
    amount_usdc:    tierPrices[tier],
    tier_purchased: tier,
    verified:       false
  }, { onConflict: 'tx_hash' })

  // Verify on-chain
  console.log(`[payment] Verifying ${tx_hash} for fid ${user.fid} → ${tier}`)
  const result = await verifyPayment(tx_hash, user.wallet, tier)

  if (!result.ok) {
    return res.status(400).json({ error: result.error })
  }

  // Mark verified
  await supabase
    .from('transactions')
    .update({ verified: true, verified_at: new Date().toISOString() })
    .eq('tx_hash', tx_hash)

  // Upgrade tier + unlock invite slots
  await supabase
    .from('users')
    .update({
      tier,
      invite_slots: INVITE_SLOTS[tier]
    })
    .eq('id', user.id)

  console.log(`[payment] ✓ fid ${user.fid} upgraded to ${tier}`)

  // Diamond affiliate payout
  if (user.referred_by) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id, tier, fid')
      .eq('id', user.referred_by)
      .single()

    if (referrer?.tier === 'diamond') {
      const usdcCut = affiliateUsdc(result.amount)
      await supabase
        .from('referrals')
        .update({ usdc_earned: supabase.rpc('increment', { x: usdcCut }) })
        .eq('referrer_id', referrer.id)
        .eq('referee_id', user.id)

      console.log(`[affiliate] Diamond fid ${referrer.fid} earned ${usdcCut / 1e6} USDC`)
    }
  }

  return res.json({ success: true, tier, message: `Upgraded to ${tier}` })
})

// GET /payment/status/:txHash
router.get('/status/:txHash', requireAuth, async (req, res) => {
  const { data: tx } = await supabase
    .from('transactions')
    .select('verified, tier_purchased, verified_at')
    .eq('tx_hash', req.params.txHash)
    .eq('user_id', req.user.id)
    .single()

  if (!tx) return res.status(404).json({ error: 'Transaction not found' })
  return res.json(tx)
})

module.exports = router
