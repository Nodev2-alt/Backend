require('dotenv').config()

const express   = require('express')
const cors      = require('cors')
const rateLimit = require('express-rate-limit')

const userRouter        = require('./routes/user')
const paymentRouter     = require('./routes/payment')
const nodeRouter        = require('./routes/node')
const leaderboardRouter = require('./routes/leaderboard')
const referralRouter    = require('./routes/referral')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(cors({
  origin: ['https://praxis-indol.vercel.app', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'x-fid', 'x-wallet']
}))

app.use(express.json())

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
}))

app.use('/payment/verify', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many payment attempts' }
}))

app.use('/node/tick', rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Tick rate limited' }
}))

app.use('/user',        userRouter)
app.use('/payment',     paymentRouter)
app.use('/node',        nodeRouter)
app.use('/leaderboard', leaderboardRouter)
app.use('/referral',    referralRouter)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'node-backend', time: new Date().toISOString() })
})

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

app.use((err, req, res, next) => {
  console.error('[error]', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`\n🔷 Node backend running on port ${PORT}`)
  console.log(`   Owner wallet: ${process.env.OWNER_WALLET}`)
  console.log(`   Supabase:     ${process.env.SUPABASE_URL}\n`)
})
