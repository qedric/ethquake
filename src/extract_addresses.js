import fs from 'fs'
import path from 'path'

const subDir = 'control'

// Function to extract addresses from a JSON file
function extractAddresses(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const jsonData = JSON.parse(fileContent)
    
    // Check if the file has the expected structure
    if (!jsonData.data || !Array.isArray(jsonData.data)) {
      console.error(`Invalid file structure in ${filePath}`)
      return { fromAddresses: [], toAddresses: [] }
    }
    
    // Extract all from_addresses and to_addresses
    const fromAddresses = []
    const toAddresses = []
    
    jsonData.data.forEach(item => {
      if (item && item.from_address) {
        fromAddresses.push(item.from_address.toLowerCase())
      }
      if (item && item.to_address) {
        toAddresses.push(item.to_address.toLowerCase())
      }
    })
    
    return { fromAddresses, toAddresses }
  } catch (error) {
    console.error(`Error processing ${filePath}: ${error.message}`)
    return { fromAddresses: [], toAddresses: [] }
  }
}

// Function to recursively get all JSON files in a directory
function getAllJsonFiles(dirPath, fileList = []) {
  const files = fs.readdirSync(dirPath)
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file)
    const stat = fs.statSync(filePath)
    
    if (stat.isDirectory()) {
      getAllJsonFiles(filePath, fileList)
    } else if (file.endsWith('.json')) {
      fileList.push(filePath)
    }
  })
  
  return fileList
}

// Main function
function main() {
  const dataDir = `./data/${subDir}`
  const addressData = {}
  
  // Get all JSON files
  const jsonFiles = getAllJsonFiles(dataDir)
  console.log(`Found ${jsonFiles.length} JSON files to process`)
  
  // Process each file
  jsonFiles.forEach(filePath => {
    const { fromAddresses, toAddresses } = extractAddresses(filePath)
    const fileName = path.basename(filePath)
    
    // Count occurrences of each address in this file (from)
    const fromCountsInFile = {}
    fromAddresses.forEach(addr => {
      fromCountsInFile[addr] = (fromCountsInFile[addr] || 0) + 1
    })
    
    // Count occurrences of each address in this file (to)
    const toCountsInFile = {}
    toAddresses.forEach(addr => {
      toCountsInFile[addr] = (toCountsInFile[addr] || 0) + 1
    })
    
    // Update the global address data
    // First process "from" addresses
    Object.entries(fromCountsInFile).forEach(([addr, count]) => {
      if (!addressData[addr]) {
        addressData[addr] = {
          address: addr,
          total_file_count: 0,
          from_file_count: 0,
          to_file_count: 0,
          total_occurrences: 0,
          from_occurrences: 0,
          to_occurrences: 0,
          files: {}
        }
      }
      
      if (!addressData[addr].files[fileName]) {
        addressData[addr].files[fileName] = { from: 0, to: 0 }
        addressData[addr].total_file_count += 1
      }
      
      if (addressData[addr].files[fileName].from === 0) {
        addressData[addr].from_file_count += 1
      }
      
      addressData[addr].files[fileName].from = count
      addressData[addr].from_occurrences += count
      addressData[addr].total_occurrences += count
    })
    
    // Then process "to" addresses
    Object.entries(toCountsInFile).forEach(([addr, count]) => {
      if (!addressData[addr]) {
        addressData[addr] = {
          address: addr,
          total_file_count: 0,
          from_file_count: 0,
          to_file_count: 0,
          total_occurrences: 0,
          from_occurrences: 0,
          to_occurrences: 0,
          files: {}
        }
      }
      
      if (!addressData[addr].files[fileName]) {
        addressData[addr].files[fileName] = { from: 0, to: 0 }
        addressData[addr].total_file_count += 1
      }
      
      if (addressData[addr].files[fileName].to === 0) {
        addressData[addr].to_file_count += 1
      }
      
      addressData[addr].files[fileName].to = count
      addressData[addr].to_occurrences += count
      addressData[addr].total_occurrences += count
    })
  })
  
  // Convert to array and sort by total occurrences
  const result = Object.values(addressData)
    .sort((a, b) => b.total_occurrences - a.total_occurrences)
  
  // Write results to file
  fs.writeFileSync(`addresses_comprehensive_${subDir}.json`, JSON.stringify(result, null, 2))
  console.log(`Extracted ${result.length} unique addresses with comprehensive stats`)
  
  // Also output top 10 most frequent addresses
  console.log('\nTop 10 addresses by total occurrences:')
  result.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.address}:
    - Total occurrences: ${item.total_occurrences}
    - As sender (from): ${item.from_occurrences} in ${item.from_file_count} files
    - As receiver (to): ${item.to_occurrences} in ${item.to_file_count} files`)
  })
}

main()