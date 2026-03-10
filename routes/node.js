const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { calcPoints, nextClaimAt, affiliatePoints, CLAIM_WINDOWS } = require('../lib/points')

// POST /node/start
router.post('/start', requireAuth, async (req, res) => {
  const user = req.user

  await supabase
    .from('node_sessions')
    .update({ is_active: false, stopped_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_active', true)

  const { data: session, error } = await supabase
    .from('node_sessions')
    .insert({
      user_id:       user.id,
      started_at:    new Date().toISOString(),
      last_tick_at:  new Date().toISOString(),
      points_earned: 0,
      is_active:     true
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to start node' })
  return res.json({ success: true, session_id: session.id })
})

// POST /node/stop
router.post('/stop', requireAuth, async (req, res) => {
  const user = req.user

  const { data: session } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!session) return res.status(400).json({ error: 'No active session' })

  const uptimeMs  = Date.now() - new Date(session.started_at)
  const ptsEarned = calcPoints(user.tier, uptimeMs)

  await supabase
    .from('node_sessions')
    .update({ is_active: false, stopped_at: new Date().toISOString(), points_earned: ptsEarned })
    .eq('id', session.id)

  return res.json({ success: true, uptime_ms: uptimeMs, points_earned: ptsEarned })
})

// POST /node/tick
router.post('/tick', requireAuth, async (req, res) => {
  const user = req.user

  const { data: session } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!session) return res.status(400).json({ error: 'No active session' })

  const now          = new Date()
  const sinceLastTick = now - new Date(session.last_tick_at)

  if (sinceLastTick < 10000) return res.status(429).json({ error: 'Tick too fast' })

  const cappedMs     = Math.min(sinceLastTick, 300000)
  const ptsThisTick  = calcPoints(user.tier, cappedMs)

  await supabase
    .from('node_sessions')
    .update({
      last_tick_at:  now.toISOString(),
      points_earned: session.points_earned + ptsThisTick
    })
    .eq('id', session.id)

  // Diamond auto-credit
  if (user.tier === 'diamond') {
    await supabase
      .from('users')
      .update({ points: user.points + ptsThisTick })
      .eq('id', user.id)

    if (user.referred_by) {
      await creditAffiliatePoints(user.referred_by, ptsThisTick)
    }
  }

  return res.json({ success: true, pts_this_tick: ptsThisTick })
})

// POST /node/claim
router.post('/claim', requireAuth, async (req, res) => {
  const user = req.user

  if (user.tier === 'diamond') {
    return res.status(400).json({ error: 'Diamond uses auto-claim' })
  }

  const { data: lastClaim } = await supabase
    .from('claims')
    .select('next_claim_at')
    .eq('user_id', user.id)
    .order('claimed_at', { ascending: false })
    .limit(1)
    .single()

  if (lastClaim && new Date(lastClaim.next_claim_at) > new Date()) {
    const msLeft = new Date(lastClaim.next_claim_at) - new Date()
    const hLeft  = Math.ceil(msLeft / 3600000)
    return res.status(400).json({ error: `${hLeft}h remaining until next claim`, next_claim_at: lastClaim.next_claim_at })
  }

  const { data: session } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const sessionPts = session?.points_earned || 0
  if (sessionPts === 0) return res.status(400).json({ error: 'No points to claim' })

  // Stop node
  if (session) {
    await supabase
      .from('node_sessions')
      .update({ is_active: false, stopped_at: new Date().toISOString() })
      .eq('id', session.id)
  }

  // Credit points
  const { data: updatedUser } = await supabase
    .from('users')
    .update({ points: user.points + sessionPts })
    .eq('id', user.id)
    .select()
    .single()

  const nextClaim = nextClaimAt(user.tier)

  await supabase.from('claims').insert({
    user_id:        user.id,
    points_claimed: sessionPts,
    tier_at_claim:  user.tier,
    next_claim_at:  nextClaim.toISOString()
  })

  // Affiliate points
  if (user.referred_by) {
    await creditAffiliatePoints(user.referred_by, sessionPts)
  }

  return res.json({
    success:        true,
    points_claimed: sessionPts,
    total_points:   updatedUser.points,
    next_claim_at:  nextClaim
  })
})

// GET /node/status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user

  const { data: session } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const { data: lastClaim } = await supabase
    .from('claims')
    .select('claimed_at, next_claim_at, points_claimed')
    .eq('user_id', user.id)
    .order('claimed_at', { ascending: false })
    .limit(1)
    .single()

  return res.json({
    node: {
      is_active:   !!session,
      started_at:  session?.started_at || null,
      session_pts: session?.points_earned || 0
    },
    claim: {
      can_claim:     lastClaim ? new Date(lastClaim.next_claim_at) <= new Date() : !!session,
      next_claim_at: lastClaim?.next_claim_at || null
    }
  })
})

async function creditAffiliatePoints(referrerId, ptsEarned) {
  const bonus = affiliatePoints(ptsEarned)
  if (bonus <= 0) return

  const { data: referrer } = await supabase
    .from('users')
    .select('id, tier, points')
    .eq('id', referrerId)
    .single()

  if (!referrer || referrer.tier !== 'diamond') return

  await supabase
    .from('users')
    .update({ points: referrer.points + bonus })
    .eq('id', referrerId)
}

module.exports = router
