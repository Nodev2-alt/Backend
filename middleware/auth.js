const supabase = require('../lib/supabase')

async function requireAuth(req, res, next) {
  const fid    = parseInt(req.headers['x-fid'])
  const wallet = req.headers['x-wallet']?.toLowerCase()

  if (!fid || !wallet) {
    return res.status(401).json({ error: 'Missing x-fid or x-wallet headers' })
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('fid', fid)
    .eq('wallet', wallet)
    .single()

  if (error || !user) {
    return res.status(401).json({ error: 'User not found — register first' })
  }

  req.user = user
  next()
}

module.exports = { requireAuth }
