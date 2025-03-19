import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/*  usage
  node src/plot.js transactions_by_address_addresses_of_interest_6pct.json
*/

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const INPUT_DIR = path.join(__dirname, '../data')
const OUTPUT_DIR = path.join(__dirname, '../output')

async function plotTransactions(inputFilePath) {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    }
    
    // Read transactions file
    const fullInputPath = path.isAbsolute(inputFilePath) 
      ? inputFilePath 
      : path.join(INPUT_DIR, inputFilePath)
    
    console.log(`Reading transactions from: ${fullInputPath}`)
    const data = fs.readFileSync(fullInputPath, 'utf8')
    const transactions = JSON.parse(data)
    
    console.log(`Processing ${transactions.length} transactions`)
    
    // Create a set of addresses of interest for faster lookups
    const addressesOfInterest = new Set()
    transactions.forEach(tx => {
      if (tx.addressOfInterest) {
        addressesOfInterest.add(tx.addressOfInterest.toLowerCase())
      }
    })
    
    // Create CSV content
    let csvContent = 'timestamp,dateTimeUTC,fromAddress,toAddress,addressType,valueETH\n'
    
    transactions.forEach(tx => {
      const timestamp = tx.block_timestamp
      
      // Replace date-fns with manual date formatting like in the old script
      const dateObj = new Date(timestamp * 1000)
      const date = dateObj.toISOString().split('T')[0]
      const time = dateObj.toISOString().split('T')[1].substring(0, 8)
      const dateTimeUTC = `${date.split('-').reverse().join('/')} ${time}`
      
      const fromAddress = tx.from_address
      const toAddress = tx.to_address
      const valueETH = tx.valueInEth
      
      // Determine if addresses are of interest
      const fromIsInterest = addressesOfInterest.has(fromAddress?.toLowerCase())
      const toIsInterest = addressesOfInterest.has(toAddress?.toLowerCase())
      
      let addressType = 'none'
      if (fromIsInterest && toIsInterest) {
        addressType = 'both'
      } else if (fromIsInterest) {
        addressType = 'from'
      } else if (toIsInterest) {
        addressType = 'to'
      }
      
      csvContent += `${timestamp},${dateTimeUTC},${fromAddress},${toAddress},${addressType},${valueETH}\n`
    })
    
    // Create output filename based on input
    const baseName = path.basename(inputFilePath, '.json')
    const outputPath = path.join(OUTPUT_DIR, `${baseName}_plot.csv`)
    
    // Write CSV file
    fs.writeFileSync(outputPath, csvContent)
    console.log(`CSV file created at: ${outputPath}`)
    
    return outputPath
  } catch (error) {
    console.error('Error plotting transactions:', error)
    throw error
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const inputFilePath = process.argv[2]
  
  if (!inputFilePath) {
    console.error('Please provide path to the transactions JSON file')
    console.error('Example: node src/plot.js transactions_by_address_addresses_of_interest_6pct.json')
    process.exit(1)
  }
  
  plotTransactions(inputFilePath)
    .then(outputPath => console.log(`Done! Output saved to ${outputPath}`))
    .catch(err => {
      console.error('Failed to plot transactions:', err)
      process.exit(1)
    })
}

export { plotTransactions }
