const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { calcPoints, affiliatePoints } = require('../lib/points')

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

  await supabase
    .from('node_sessions')
    .update({ is_active: false, stopped_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_active', true)

  return res.json({ success: true })
})

// POST /node/tick — real-time points for ALL tiers
router.post('/tick', requireAuth, async (req, res) => {
  const user = req.user

  const { data: session } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!session) return res.status(400).json({ error: 'No active session' })

  const now           = new Date()
  const sinceLastTick = now - new Date(session.last_tick_at)

  if (sinceLastTick < 10000) return res.status(429).json({ error: 'Tick too fast' })

  const cappedMs    = Math.min(sinceLastTick, 300000)
  const ptsThisTick = calcPoints(user.tier, cappedMs)

  // Update session
  await supabase
    .from('node_sessions')
    .update({
      last_tick_at:  now.toISOString(),
      points_earned: session.points_earned + ptsThisTick
    })
    .eq('id', session.id)

  // Credit points to user immediately — ALL tiers
  await supabase
    .from('users')
    .update({ points: user.points + ptsThisTick })
    .eq('id', user.id)

  // Affiliate points for referrer
  if (user.referred_by) {
    await creditAffiliatePoints(user.referred_by, ptsThisTick)
  }

  return res.json({ success: true, pts_this_tick: ptsThisTick })
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

  return res.json({
    node: {
      is_active:   !!session,
      started_at:  session?.started_at || null,
      session_pts: session?.points_earned || 0
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
