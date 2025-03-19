import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const DATA_DIR = path.join(__dirname, '../data')
const MONITOR_DIR = path.join(DATA_DIR, 'monitor')

function analyzeHourlyTransactionsForFile(filePath) {
  try {
    console.log(`Reading transactions from: ${filePath}`)
    const data = fs.readFileSync(filePath, 'utf8')
    const transactions = JSON.parse(data)
    
    console.log(`Processing ${transactions.length} transactions from ${path.basename(filePath)}`)
    
    // Count transactions by date and hour
    const dateHourCounts = {}
    
    transactions.forEach(tx => {
      // Extract date and hour from block_timestamp (Unix timestamp)
      const date = new Date(tx.block_timestamp * 1000)
      const year = date.getUTCFullYear()
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const day = String(date.getUTCDate()).padStart(2, '0')
      const hour = String(date.getUTCHours()).padStart(2, '0')
      
      const dateKey = `${day}/${month}/${String(year).slice(2)}`
      const dateHourKey = `${dateKey} ${hour}`
      
      // Initialize or increment count
      dateHourCounts[dateHourKey] = (dateHourCounts[dateHourKey] || 0) + 1
    })
    
    return dateHourCounts
  } catch (error) {
    console.error(`Error analyzing transactions in ${filePath}:`, error)
    return {}
  }
}

function analyzeAllMonitorFiles() {
  try {
    // Check if monitor directory exists
    if (!fs.existsSync(MONITOR_DIR)) {
      console.error(`Monitor directory does not exist: ${MONITOR_DIR}`)
      return
    }
    
    // Get all JSON files in the monitor directory
    const files = fs.readdirSync(MONITOR_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(MONITOR_DIR, file))
    
    if (files.length === 0) {
      console.log(`No JSON files found in ${MONITOR_DIR}`)
      return
    }
    
    console.log(`Found ${files.length} JSON files to process`)
    
    // Process each file and combine results
    const combinedDateHourCounts = {}
    
    files.forEach(file => {
      const dateHourCounts = analyzeHourlyTransactionsForFile(file)
      
      // Merge into combined counts
      Object.entries(dateHourCounts).forEach(([dateHour, count]) => {
        combinedDateHourCounts[dateHour] = (combinedDateHourCounts[dateHour] || 0) + count
      })
    })
    
    // Sort by date and hour
    const sortedDateHours = Object.keys(combinedDateHourCounts).sort((a, b) => {
      // Parse DD/MM/YY HH format for proper date sorting
      const [dateA, hourA] = a.split(' ')
      const [dayA, monthA, yearA] = dateA.split('/')
      
      const [dateB, hourB] = b.split(' ')
      const [dayB, monthB, yearB] = dateB.split('/')
      
      // Create comparable date strings: YYMMDD HH
      const comparableA = `${yearA}${monthA}${dayA} ${hourA}`
      const comparableB = `${yearB}${monthB}${dayB} ${hourB}`
      
      return comparableA.localeCompare(comparableB)
    })
    
    // Output to console
    console.log('\ndate-hour,count')
    sortedDateHours.forEach(dateHour => {
      const [date, hour] = dateHour.split(' ')
      console.log(`${date} - ${hour},${combinedDateHourCounts[dateHour]}`)
    })
    
  } catch (error) {
    console.error('Error analyzing monitor files:', error)
    throw error
  }
}

function analyzeHourlyTransactions(inputFile) {
  // If no specific file is provided, process all monitor files
  if (!inputFile) {
    return analyzeAllMonitorFiles()
  }
  
  // Process a specific file
  try {
    const fullInputPath = path.isAbsolute(inputFile) 
      ? inputFile 
      : path.join(DATA_DIR, inputFile)
    
    const dateHourCounts = analyzeHourlyTransactionsForFile(fullInputPath)
    
    // Sort by date and hour
    const sortedDateHours = Object.keys(dateHourCounts).sort((a, b) => {
      // Parse DD/MM/YY HH format for proper date sorting
      const [dateA, hourA] = a.split(' ')
      const [dayA, monthA, yearA] = dateA.split('/')
      
      const [dateB, hourB] = b.split(' ')
      const [dayB, monthB, yearB] = dateB.split('/')
      
      // Create comparable date strings: YYMMDD HH
      const comparableA = `${yearA}${monthA}${dayA} ${hourA}`
      const comparableB = `${yearB}${monthB}${dayB} ${hourB}`
      
      return comparableA.localeCompare(comparableB)
    })
    
    // Output to console
    console.log('\ndate-hour,count')
    sortedDateHours.forEach(dateHour => {
      const [date, hour] = dateHour.split(' ')
      console.log(`${date} - ${hour},${dateHourCounts[dateHour]}`)
    })
    
  } catch (error) {
    console.error('Error analyzing transactions:', error)
    throw error
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const inputFile = process.argv[2]
  analyzeHourlyTransactions(inputFile)
}

export { analyzeHourlyTransactions }
