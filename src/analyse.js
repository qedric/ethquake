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

function countAddressesInFiles(directory) {
    ensureDirectoryExists(directory)
    const files = fs.readdirSync(directory)
    const addressCount = {}

    files.forEach(file => {
        const filePath = path.join(directory, file)
        if (fs.statSync(filePath).isFile() && filePath.endsWith('.json')) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            const addressesInFile = new Set()

            data.forEach(entry => {
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
        }
    })

    return addressCount
}

function generateReport() {
    const dataDir = path.join(__dirname, 'data')
    const controlDir = path.join(__dirname, 'data', 'control')

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
