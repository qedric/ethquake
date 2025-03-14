import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function ensureDirectoryExists(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true })
    }
}

function countAddressesInFiles(files) {
    // Check if 'files' is an array
    if (Array.isArray(files)) {
        files.forEach(file => {
            const data = readDataFromFile(file) // Assuming this is how you're getting 'data'
            
            // Parse the JSON data
            try {
                const jsonData = JSON.parse(data)
                
                if (jsonData && Array.isArray(jsonData.data)) {
                    jsonData.data.forEach(entry => {
                        if (entry.to_address) {
                            const toAddress = entry.to_address
                            if (!addressCount[toAddress]) {
                                addressCount[toAddress] = { toCount: 0, fromCount: 0, fileCount: 0 }
                            }
                            addressCount[toAddress].toCount++
                            addressesInFile.add(toAddress)
                        }

                        if (entry.from_address) {
                            const fromAddress = entry.from_address
                            if (!addressCount[fromAddress]) {
                                addressCount[fromAddress] = { toCount: 0, fromCount: 0, fileCount: 0 }
                            }
                            addressCount[fromAddress].fromCount++
                            addressesInFile.add(fromAddress)
                        }
                    })

                    addressesInFile.forEach(address => {
                        addressCount[address].fileCount++
                    })
                } else {
                    console.error('Parsed data does not contain a valid "data" array:', jsonData)
                }
            } catch (error) {
                console.error('Failed to parse JSON:', error)
            }
        })
    } else {
        console.error('Files is not an array:', files)
    }
}

function generateReport() {
    const dataDir = path.join(__dirname, '..', 'data')
    const controlDir = path.join(__dirname, '..', 'data', 'control')

    const addressCount = countAddressesInFiles(dataDir)
    const controlAddressCount = countAddressesInFiles(controlDir)

    const combinedAddressCount = { ...addressCount }

    for (const [address, counts] of Object.entries(controlAddressCount)) {
        if (!combinedAddressCount[address]) {
            combinedAddressCount[address] = counts
        } else {
            combinedAddressCount[address].toCount += counts.toCount
            combinedAddressCount[address].fromCount += counts.fromCount
            combinedAddressCount[address].fileCount += counts.fileCount
        }
    }

    console.log('Address Report:')
    for (const [address, counts] of Object.entries(combinedAddressCount)) {
        console.log(`Address: ${address}, To Count: ${counts.toCount}, From Count: ${counts.fromCount}, File Count: ${counts.fileCount}`)
    }
}

generateReport()
