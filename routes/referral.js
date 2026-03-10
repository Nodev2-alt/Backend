const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')

// GET /referral/my
router.get('/my', requireAuth, async (req, res) => {
  const user = req.user

  const { data: refs } = await supabase
    .from('referrals')
    .select(`
      usdc_earned,
      points_earned,
      created_at,
      referee:users!referrals_referee_id_fkey (
        fid, username, display_name, pfp_url, tier, points
      )
    `)
    .eq('referrer_id', user.id)
    .order('created_at', { ascending: false })

  const totalUsdc   = refs?.reduce((s, r) => s + r.usdc_earned, 0) || 0
  const totalPoints = refs?.reduce((s, r) => s + r.points_earned, 0) || 0

  return res.json({
    referral_code:        user.referral_code,
    referral_link:        `https://node.praxis.app/r/${user.referral_code}`,
    slots_total:          user.invite_slots,
    slots_used:           user.invites_used,
    slots_left:           user.invite_slots - user.invites_used,
    total_referrals:      refs?.length || 0,
    total_usdc_earned:    totalUsdc,
    total_points_earned:  totalPoints,
    is_diamond_affiliate: user.tier === 'diamond',
    referrals: refs?.map(r => ({
      user:          r.referee,
      usdc_earned:   r.usdc_earned,
      points_earned: r.points_earned,
      joined_at:     r.created_at
    })) || []
  })
})

// GET /referral/resolve/:code
router.get('/resolve/:code', async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('fid, username, display_name, pfp_url, tier, invite_slots, invites_used')
    .eq('referral_code', req.params.code.toUpperCase())
    .single()

  if (!user) return res.status(404).json({ error: 'Invalid referral code' })

  const slotsLeft = user.invite_slots - user.invites_used
  if (slotsLeft <= 0) return res.status(403).json({ error: 'This code has no slots remaining' })

  return res.json({ valid: true, slots_left: slotsLeft, referrer: user })
})

module.exports = router
