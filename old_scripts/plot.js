import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Fix the __dirname nonsense in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Look at this user making me dig through transaction files like some kind of data janitor
const txFolder = join(__dirname, '../data/tx_by_address')
const outputFile = join(__dirname, '../data/all_transactions.csv')

// Get all the transactions because apparently we need to process EVERYTHING
function getAllTransactions(excludeUnknown = true) {
  const allTransactions = []
  
  // Read the directory - assuming it even exists
  const files = readdirSync(txFolder)
  
  // First get all known addresses if we're excluding unknowns
  const knownAddresses = new Set()
  if (excludeUnknown) {
    files.forEach(file => {
      if (file.endsWith('.json')) {
        // Extract address from filename - assuming your files are named sensibly
        const address = file.replace('.json', '')
        knownAddresses.add(address.toLowerCase())
      }
    })
  }
  
  // Loop through each file - this could take forever with a large dataset
  files.forEach(file => {
    if (file.endsWith('.json')) {
      const filePath = join(txFolder, file)
      try {
        // Parse the JSON - hope it's not malformed
        const fileContent = JSON.parse(readFileSync(filePath, 'utf8'))
        
        // Extract the transactions if they exist - FIXED to handle the actual JSON structure
        if (fileContent && fileContent.data && Array.isArray(fileContent.data)) {
          fileContent.data.forEach(tx => {
            if (tx.block_timestamp && tx.to_address && tx.from_address) {
              // Get the full date and time, then format it to YYYY-MM-DD HH:MM
              const dateObj = new Date(tx.block_timestamp * 1000)
              const date = dateObj.toISOString().split('T')[0]
              const time = dateObj.toISOString().split('T')[1].substring(0, 5)
              const dateTime = `${date} ${time}`
              
              allTransactions.push({
                timestamp: tx.block_timestamp,
                dateTime: dateTime,
                to_address: tx.to_address,
                from_address: tx.from_address
              })
            }
          })
        }
      } catch (error) {
        console.error(`Error processing file ${file}:`, error.message)
      }
    }
  })
  
  // If we're excluding unknown addresses, process the transactions
  if (excludeUnknown) {
    allTransactions.forEach(tx => {
      if (!knownAddresses.has(tx.to_address.toLowerCase())) {
        tx.to_address = ''
      }
      if (!knownAddresses.has(tx.from_address.toLowerCase())) {
        tx.from_address = ''
      }
    })
  }
  
  return allTransactions
}

// Main function to run this whole pointless exercise
function main() {
  console.log('Starting to collect transactions...')
  
  // Add a command line argument check for the exclude flag
  const excludeUnknown = process.argv.includes('--exclude-unknown')
  if (excludeUnknown) {
    console.log('Excluding unknown addresses. How picky of you.')
  }
  
  const transactions = getAllTransactions(excludeUnknown)
  
  if (transactions.length === 0) {
    console.log('No transactions found. What a surprise.')
    return
  }
  
  console.log(`Found ${transactions.length} transactions. Writing to CSV now...`)
  
  try {
    // Create a basic CSV string without any fancy library
    const header = 'timestamp,dateTime,to_address,from_address\n'
    const rows = transactions.map(tx => 
      `${tx.timestamp},${tx.dateTime},${tx.to_address},${tx.from_address}`
    ).join('\n')
    
    writeFileSync(outputFile, header + rows)
    console.log(`CSV file created at ${outputFile}. Happy now?`)
  } catch (error) {
    console.error('Failed to write CSV:', error.message)
  }
}

// Let's get this over with
main()
