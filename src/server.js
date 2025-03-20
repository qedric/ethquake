import express from 'express'
import cron from 'node-cron'
import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress.js'
import { analyzeTransactions } from './scripts/analyse.js'
import { executeTradeStrategy } from './trading/strategy.js'
import { getDbClient } from './lib/mongodb.js'
import dotenv from 'dotenv'

// Load those pesky environment variables that you can't seem to organize properly
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Basic health check endpoint so Railway knows the server is alive
app.get('/', (req, res) => {
  res.send('EthQuake Trading Server is running... unfortunately')
})

// Status endpoint - might be useful someday, who knows
app.get('/status', async (req, res) => {
  try {
    const db = await getDbClient()
    const txCount = await db.collection('transactions').countDocuments()
    const analysisCount = await db.collection('analysis_results').countDocuments()
    res.json({
      status: 'operational',
      transactions: txCount,
      analysisResults: analysisCount,
      lastUpdate: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Main cron job that runs your data pipeline every 15 minutes
// because you clearly think the market needs to be monitored *that* frequently
cron.schedule('*/15 * * * *', async () => {
  console.log('Running scheduled task:', new Date().toISOString())
  
  try {
    // Update transactions data
    console.log('Updating transactions data...')
    const txResult = await updateTransactionsByAddressesOfInterest()
    console.log(`Added ${txResult.newTransactionsCount} new transactions`)
    
    // Run analysis
    console.log('Running transaction analysis...')
    const analysisResults = await analyzeTransactions()
    console.log(`Analysis complete with ${analysisResults?.length || 0} hourly results`)
    
    // Execute trading strategy based on the latest analysis
    console.log('Executing trading strategy...')
    await executeTradeStrategy()
    
  } catch (error) {
    console.error('Error in scheduled task:', error)
  }
})

// Start the server
app.listen(PORT, () => {
  console.log(`EthQuake Trading Server running on port ${PORT}. Not that you'll ever look at it.`)
}) 