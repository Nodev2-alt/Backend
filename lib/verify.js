const axios = require('axios')

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const TIER_PRICES = {
  silver:  parseInt(process.env.SILVER_PRICE_USDC),
  gold:    parseInt(process.env.GOLD_PRICE_USDC),
  diamond: parseInt(process.env.DIAMOND_PRICE_USDC),
}

async function verifyPayment(txHash, fromWallet, tier) {
  const rpc = process.env.ALCHEMY_BASE_RPC
  const ownerWallet = process.env.OWNER_WALLET.toLowerCase()
  const usdcContract = process.env.USDC_CONTRACT.toLowerCase()
  const expectedAmount = TIER_PRICES[tier]

  if (!expectedAmount) return { ok: false, error: 'Invalid tier' }

  try {
    const receiptRes = await axios.post(rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash]
    })

    const receipt = receiptRes.data.result

    if (!receipt) return { ok: false, error: 'Transaction not found or still pending' }
    if (receipt.status !== '0x1') return { ok: false, error: 'Transaction failed on-chain' }
    if (receipt.to?.toLowerCase() !== usdcContract) return { ok: false, error: 'Not a USDC transaction' }

    const transferLog = receipt.logs.find(log =>
      log.address?.toLowerCase() === usdcContract &&
      log.topics[0] === TRANSFER_TOPIC &&
      '0x' + log.topics[1].slice(26).toLowerCase() === fromWallet.toLowerCase() &&
      '0x' + log.topics[2].slice(26).toLowerCase() === ownerWallet
    )

    if (!transferLog) return { ok: false, error: 'No valid USDC transfer found' }

    const transferredAmount = parseInt(transferLog.data, 16)
    if (transferredAmount !== expectedAmount) {
      return { ok: false, error: `Wrong amount. Expected $${expectedAmount / 1e6} got $${transferredAmount / 1e6}` }
    }

    return { ok: true, amount: transferredAmount }

  } catch (err) {
    console.error('[verifyPayment]', err.message)
    return { ok: false, error: 'RPC verification failed' }
  }
}

module.exports = { verifyPayment, TIER_PRICES }
