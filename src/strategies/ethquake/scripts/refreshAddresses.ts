import dotenv from 'dotenv'
import { getDb } from '../../../lib/mongodb.js'
import { fetchTransactions } from '../../../lib/getTWTransactions.js'

dotenv.config()

type Tx = {
  from_address: string
  to_address: string
  block_timestamp: number
  value: string | number | bigint
}

type BuildOptions = {
  lookbackHours: number
  weeklyControls: number
  randomControls: number
  minEth: number
  fromTimestamp?: number | null
  toTimestamp?: number | null
  cohort?: string
}

const LIMIT = 200
const WEI = BigInt(1e18)

const toWei = (eth: number) => (BigInt(Math.floor(eth)) * WEI).toString()

async function fetchPaged(opts: Record<string, string | number>) {
  let page = 0
  let total: Tx[] = []
  let hasMore = true
  while (hasMore) {
    const txs = await fetchTransactions({ ...opts, page })
    total = total.concat(txs as Tx[])
    hasMore = txs.length === LIMIT
    page++
    if (page > 500) break
  }
  return total
}

function weeklyOffsets(ts: number, weeks: number, lookbackHours: number) {
  const res: Array<{ start: number, end: number }> = []
  for (let k = 1; k <= weeks; k++) {
    const end = ts - k * 7 * 24 * 3600
    const start = end - lookbackHours * 3600
    res.push({ start, end })
  }
  return res
}

function randomControls(ts: number, lookbackHours: number, count: number) {
  // random in [-72h, -24h] prior to movement
  const res: Array<{ start: number, end: number }> = []
  for (let i = 0; i < count; i++) {
    const offset = -24 * 3600 - Math.floor(Math.random() * (48 * 3600))
    const end = ts + offset
    const start = end - lookbackHours * 3600
    res.push({ start, end })
  }
  return res
}

function collectAddresses(txs: Tx[]) {
  const s = new Set<string>()
  for (const t of txs) {
    if (t.from_address) s.add(t.from_address.toLowerCase())
    if (t.to_address) s.add(t.to_address.toLowerCase())
  }
  return s
}

async function buildCohort({
  lookbackHours,
  weeklyControls,
  randomControls: randCtrls,
  minEth,
  fromTimestamp,
  toTimestamp,
  cohort
}: BuildOptions) {
  const db = await getDb(process.env.MONGO_DB_NAME || 'ethquake')
  const minWei = toWei(minEth)
  const nowSec = Math.floor(Date.now() / 1000)

  const fromTs = fromTimestamp ?? 0
  const toTs = toTimestamp ?? nowSec

  const movements = await db.collection('price_movements')
    .find({ timestamp: { $gte: fromTs, $lte: toTs } })
    .sort({ timestamp: -1 })
    .toArray()

  if (movements.length === 0) {
    console.log('[Strategy: ethquake] No price movements to process')
    return
  }

  const addrStats = new Map<string, { target_hits: number, control_hits: number }>()
  for (const m of movements) {
    const T = m.timestamp as number
    const tgtStart = T - lookbackHours * 3600
    const tgtEnd = T

    const target = await fetchPaged({
      filter_block_timestamp_gte: tgtStart,
      filter_block_timestamp_lte: tgtEnd,
      filter_value_gte: minWei
    })
    const targetSet = collectAddresses(target)

    const ctrlWindows = [
      ...weeklyOffsets(T, weeklyControls, lookbackHours),
      ...randomControls(T, lookbackHours, randCtrls)
    ]

    const controlSet = new Set<string>()
    for (const w of ctrlWindows) {
      const ctrl = await fetchPaged({
        filter_block_timestamp_gte: w.start,
        filter_block_timestamp_lte: w.end,
        filter_value_gte: minWei
      })
      for (const a of collectAddresses(ctrl)) controlSet.add(a)
      // Be gentle with the API
      await new Promise(r => setTimeout(r, 200))
    }

    // update stats
    for (const a of targetSet) {
      const s = addrStats.get(a) || { target_hits: 0, control_hits: 0 }
      s.target_hits += 1
      addrStats.set(a, s)
    }
    for (const a of controlSet) {
      const s = addrStats.get(a) || { target_hits: 0, control_hits: 0 }
      s.control_hits += 1
      addrStats.set(a, s)
    }
  }

  const cohortName = cohort || new Date().toISOString().slice(0, 10)
  const candidates = Array.from(addrStats.entries()).map(([address, s]) => ({
    address,
    target_hits: s.target_hits,
    control_hits: s.control_hits,
    score: s.target_hits - s.control_hits,
    movement_count: movements.length,
    cohort: cohortName,
    built_at: new Date()
  }))

  // write to candidates collection
  if (candidates.length > 0) {
    await db.collection('addresses_of_interest_candidates').deleteMany({ cohort: cohortName })
    await db.collection('addresses_of_interest_candidates').insertMany(candidates)
  }

  console.log(`[Strategy: ethquake] Built cohort '${cohortName}' with ${candidates.length} candidates from ${movements.length} movements`)
}

async function promoteCohort({ cohort, minScore, yes }: { cohort: string, minScore: number, yes: boolean }) {
  const db = await getDb(process.env.MONGO_DB_NAME || 'ethquake')
  const list = await db.collection('addresses_of_interest_candidates')
    .find({ cohort, score: { $gte: minScore } })
    .toArray()

  console.log(`[Strategy: ethquake] Promoting ${list.length} addresses with score >= ${minScore} from cohort '${cohort}'`)
  if (!yes) {
    console.log('[Strategy: ethquake] Add --yes to confirm')
    return
  }

  if (list.length > 0) {
    const ops = list.map(a => ({
      updateOne: {
        filter: { address: a.address },
        update: {
          $set: {
            address: a.address,
            sent_count: a.target_hits, // retained for compatibility
            received_count: 0,
            movement_count: a.movement_count,
            last_promoted: new Date(),
            cohort
          }
        },
        upsert: true
      }
    }))
    await db.collection('addresses_of_interest').bulkWrite(ops)
  }
  console.log('[Strategy: ethquake] Promotion complete')
}

async function main() {
  const cmd = process.argv[2]

  if (cmd === 'build') {
    const lookbackHours = parseInt(process.env.REFRESH_LOOKBACK_HOURS || '2')
    const weeklyControls = parseInt(process.env.REFRESH_WEEKLY_CONTROLS || '4')
    const randomCtrls = parseInt(process.env.REFRESH_RANDOM_CONTROLS || '2')
    const minEth = parseInt(process.env.REFRESH_MIN_ETH || '100')
    const fromTimestamp = process.env.REFRESH_FROM_TS ? parseInt(process.env.REFRESH_FROM_TS) : undefined
    const toTimestamp = process.env.REFRESH_TO_TS ? parseInt(process.env.REFRESH_TO_TS) : undefined
    const cohort = process.env.REFRESH_COHORT

    await buildCohort({ lookbackHours, weeklyControls, randomControls: randomCtrls, minEth, fromTimestamp, toTimestamp, cohort })
  } else if (cmd === 'promote') {
    const cohort = process.env.REFRESH_COHORT || new Date().toISOString().slice(0, 10)
    const minScore = parseInt(process.env.REFRESH_MIN_SCORE || '2')
    const yes = process.env.REFRESH_YES === '1' || process.env.REFRESH_YES === 'true'
    await promoteCohort({ cohort, minScore, yes })
  } else {
    console.log('Usage:')
    console.log('  build cohort:   REFRESH_COHORT=YYYY-MM-DD REFRESH_FROM_TS=... REFRESH_TO_TS=... npm run refresh-addresses:build')
    console.log('  promote cohort: REFRESH_COHORT=YYYY-MM-DD REFRESH_MIN_SCORE=2 REFRESH_YES=1 npm run refresh-addresses:promote')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
