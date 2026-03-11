const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { generateReferralCode } = require('../lib/referral')
const { INVITE_SLOTS } = require('../lib/points')

// POST /user/register
router.post('/register', async (req, res) => {
  const { fid, wallet, username, display_name, pfp_url, invite_code } = req.body

  if (!fid || !wallet) {
    return res.status(400).json({ error: 'fid and wallet are required' })
  }

  const walletLower = wallet.toLowerCase()

  // Check already registered
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('fid', fid)
    .single()

  if (existing) {
    return res.status(409).json({ error: 'Already registered', user_id: existing.id })
  }

  // Invite code is REQUIRED
  if (!invite_code) {
    return res.status(403).json({ error: 'Invite code required — get one from an existing member' })
  }

  // Validate invite code against active_invite_code
  const { data: referrer } = await supabase
    .from('users')
    .select('id, tier, invite_slots, invites_used, active_invite_code')
    .eq('active_invite_code', invite_code.toUpperCase())
    .single()

  if (!referrer) {
    return res.status(403).json({ error: 'Invalid invite code' })
  }

  // Check referrer has slots available
  if (referrer.invites_used >= referrer.invite_slots) {
    return res.status(403).json({ error: 'This invite code has no slots remaining' })
  }

  // Generate unique referral_code for new user (permanent, for their profile)
  let myCode, tries = 0
  do {
    myCode = generateReferralCode()
    const { data: clash } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', myCode)
      .single()
    if (!clash) break
    tries++
  } while (tries < 5)

  // New user starts with 0 invite slots (Bronze)
  const newInviteSlots = INVITE_SLOTS['bronze'] || 0

  // Generate active_invite_code for new user if they have slots
  let newActiveCode = null
  if (newInviteSlots > 0) {
    let atries = 0
    do {
      newActiveCode = generateReferralCode()
      const { data: clash } = await supabase
        .from('users')
        .select('id')
        .eq('active_invite_code', newActiveCode)
        .single()
      if (!clash) break
      atries++
    } while (atries < 5)
  }

  // Insert new user
  const { data: user, error } = await supabase
    .from('users')
    .insert({
      fid,
      wallet:             walletLower,
      username:           username || null,
      display_name:       display_name || null,
      pfp_url:            pfp_url || null,
      tier:               'bronze',
      points:             0,
      referral_code:      myCode,
      active_invite_code: newActiveCode,
      referred_by:        referrer.id,
      invite_slots:       newInviteSlots,
      invites_used:       0
    })
    .select()
    .single()

  if (error) {
    console.error('[register]', error)
    return res.status(500).json({ error: 'Failed to register' })
  }

  // Burn referrer's current active_invite_code and generate new one for next slot
  const newSlotsUsed = referrer.invites_used + 1
  const slotsRemaining = referrer.invite_slots - newSlotsUsed

  let newReferrerCode = null
  if (slotsRemaining > 0) {
    let rtries = 0
    do {
      newReferrerCode = generateReferralCode()
      const { data: clash } = await supabase
        .from('users')
        .select('id')
        .eq('active_invite_code', newReferrerCode)
        .single()
      if (!clash) break
      rtries++
    } while (rtries < 5)
  }

  await supabase
    .from('users')
    .update({
      invites_used:       newSlotsUsed,
      active_invite_code: newReferrerCode  // null if no slots left
    })
    .eq('id', referrer.id)

  // Create referral record
  await supabase.from('referrals').insert({
    referrer_id:   referrer.id,
    referee_id:    user.id,
    usdc_earned:   0,
    points_earned: 0
  })

  return res.json({ success: true, user })
})

// GET /user/me
router.get('/me', requireAuth, async (req, res) => {
  const user = req.user

  const { data: lastClaim } = await supabase
    .from('claims')
    .select('*')
    .eq('user_id', user.id)
    .order('claimed_at', { ascending: false })
    .limit(1)
    .single()

  const { data: activeSession } = await supabase
    .from('node_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  const { count: refCount } = await supabase
    .from('referrals')
    .select('id', { count: 'exact' })
    .eq('referrer_id', user.id)

  return res.json({
    user,
    node: {
      is_active:   !!activeSession,
      started_at:  activeSession?.started_at || null,
      session_pts: activeSession?.points_earned || 0
    },
    claim: {
      last_claimed_at: lastClaim?.claimed_at || null,
      next_claim_at:   lastClaim?.next_claim_at || null,
      can_claim:       lastClaim ? new Date(lastClaim.next_claim_at) <= new Date() : false
    },
    referrals: {
      count:      refCount || 0,
      slots_left: user.invite_slots - user.invites_used
    }
  })
})

// GET /user/:fid
router.get('/:fid', async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('fid, username, display_name, pfp_url, tier, points')
    .eq('fid', req.params.fid)
    .single()

  if (!user) return res.status(404).json({ error: 'User not found' })
  return res.json({ user })
})

module.exports = router

// POST /user/link-referrer
router.post('/link-referrer', requireAuth, async (req, res) => {
  const user = req.user
  if (user.referred_by) return res.status(400).json({ error: 'Already linked to a referrer' })

  const { invite_code } = req.body
  if (!invite_code) return res.status(400).json({ error: 'invite_code required' })

  // Check invite_codes table
  const { data: invite } = await supabase
    .from('invite_codes')
    .select('id, owner_fid, is_used')
    .eq('code', invite_code.trim().toUpperCase())
    .single()

  let referrer = null
  if (invite && !invite.is_used) {
    const { data: owner } = await supabase
      .from('users')
      .select('id')
      .eq('fid', invite.owner_fid)
      .single()
    referrer = owner
    await supabase.from('invite_codes').update({ is_used: true, used_by_fid: user.fid, used_at: new Date().toISOString() }).eq('id', invite.id)
  } else {
    const { data: userRef } = await supabase
      .from('users')
      .select('id, invite_slots, invites_used, active_invite_code')
      .eq('active_invite_code', invite_code.trim().toUpperCase())
      .single()
    if (!userRef) return res.status(403).json({ error: 'Invalid or already used code' })
    if (userRef.invites_used >= userRef.invite_slots) return res.status(403).json({ error: 'No slots remaining' })
    referrer = userRef
    await supabase.from('users').update({ invites_used: userRef.invites_used + 1 }).eq('id', userRef.id)
  }

  await supabase.from('users').update({ referred_by: referrer.id }).eq('id', user.id)
  await supabase.from('referrals').insert({ referrer_id: referrer.id, referee_id: user.id, usdc_earned: 0, points_earned: 0 })

  return res.json({ success: true })
})
