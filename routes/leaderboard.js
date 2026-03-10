const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')

// GET /leaderboard
router.get('/', requireAuth, async (req, res) => {
  const user = req.user

  const { data: top100, error } = await supabase
    .from('leaderboard')
    .select('fid, username, display_name, pfp_url, tier, points, rank')
    .lte('rank', 100)
    .order('rank', { ascending: true })

  if (error) return res.status(500).json({ error: 'Failed to fetch leaderboard' })

  const { data: myRank } = await supabase
    .from('leaderboard')
    .select('rank, points')
    .eq('fid', user.fid)
    .single()

  return res.json({
    top100,
    me: {
      fid:       user.fid,
      username:  user.username,
      tier:      user.tier,
      points:    user.points,
      rank:      myRank?.rank || null,
      in_top100: myRank ? myRank.rank <= 100 : false
    }
  })
})

// GET /leaderboard/around-me
router.get('/around-me', requireAuth, async (req, res) => {
  const user = req.user

  const { data: myRank } = await supabase
    .from('leaderboard')
    .select('rank')
    .eq('fid', user.fid)
    .single()

  if (!myRank) return res.json({ users: [] })

  const rank    = myRank.rank
  const minRank = Math.max(1, rank - 3)
  const maxRank = rank + 3

  const { data: nearby } = await supabase
    .from('leaderboard')
    .select('fid, username, display_name, pfp_url, tier, points, rank')
    .gte('rank', minRank)
    .lte('rank', maxRank)
    .order('rank', { ascending: true })

  return res.json({ users: nearby, my_rank: rank })
})

module.exports = router
