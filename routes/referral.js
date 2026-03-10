const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { generateReferralCode } = require('../lib/referral')

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
    active_invite_code:   user.active_invite_code,
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
  const code = req.params.code.toUpperCase()

  // Check invite_codes table first
  const { data: invite } = await supabase
    .from('invite_codes')
    .select('id, owner_fid, is_used')
    .eq('code', code)
    .single()

  if (invite) {
    if (invite.is_used) return res.status(403).json({ valid: false, error: 'This code has already been used' })
    return res.json({ valid: true, slots_left: 1, invite_id: invite.id, owner_fid: invite.owner_fid })
  }

  // Fall back to active_invite_code on users table
  const { data: user } = await supabase
    .from('users')
    .select('fid, username, display_name, pfp_url, tier, invite_slots, invites_used, active_invite_code')
    .eq('active_invite_code', code)
    .single()

  if (!user) return res.status(404).json({ valid: false, error: 'Invalid invite code' })

  const slotsLeft = user.invite_slots - user.invites_used
  if (slotsLeft <= 0) return res.status(403).json({ valid: false, error: 'This code has no slots remaining' })

  return res.json({ valid: true, slots_left: slotsLeft, referrer: user })
})

// POST /referral/refresh — user manually refreshes their invite code
router.post('/refresh', requireAuth, async (req, res) => {
  const user = req.user

  const slotsLeft = user.invite_slots - user.invites_used
  if (slotsLeft <= 0) {
    return res.status(403).json({ error: 'No invite slots remaining' })
  }

  // Generate new unique code
  let newCode, tries = 0
  do {
    newCode = generateReferralCode()
    const { data: clash } = await supabase
      .from('users')
      .select('id')
      .eq('active_invite_code', newCode)
      .single()
    if (!clash) break
    tries++
  } while (tries < 5)

  await supabase
    .from('users')
    .update({ active_invite_code: newCode })
    .eq('id', user.id)

  return res.json({ success: true, active_invite_code: newCode })
})

module.exports = router
