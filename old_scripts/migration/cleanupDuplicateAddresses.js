import { getDbClient } from '../../src/lib/mongodb.js'

async function cleanupDuplicateAddresses() {
  const db = await getDbClient()
  const collection = db.collection('addresses_of_interest')
  
  // Get all addresses
  const addresses = await collection.find({}).toArray()
  console.log(`Total addresses in MongoDB: ${addresses.length}`)
  
  // Find duplicates by creating a map of address to _id
  const addressMap = new Map()
  const duplicateIds = []
  
  for (const doc of addresses) {
    const address = doc.address?.toLowerCase()
    
    if (!address) {
      console.log(`WARNING: Found document without valid address: ${JSON.stringify(doc)}`)
      continue
    }
    
    if (addressMap.has(address)) {
      // This is a duplicate, mark for deletion
      duplicateIds.push(doc._id)
    } else {
      // First time seeing this address
      addressMap.set(address, doc._id)
    }
  }
  
  console.log(`Found ${duplicateIds.length} duplicate addresses`)
  
  if (duplicateIds.length > 0) {
    // Delete the duplicates
    const result = await collection.deleteMany({ _id: { $in: duplicateIds } })
    console.log(`Deleted ${result.deletedCount} duplicate addresses`)
  }
  
  // Also normalize addresses to lowercase if needed
  const normalizeOps = []
  for (const [address, id] of addressMap.entries()) {
    if (address !== addresses.find(a => a._id.toString() === id.toString()).address) {
      normalizeOps.push({
        updateOne: {
          filter: { _id: id },
          update: { $set: { address: address } }
        }
      })
    }
  }
  
  if (normalizeOps.length > 0) {
    const result = await collection.bulkWrite(normalizeOps)
    console.log(`Normalized ${result.modifiedCount} addresses to lowercase`)
  }
  
  console.log(`Cleanup complete. Now have ${addressMap.size} unique addresses.`)
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupDuplicateAddresses()
    .then(() => {
      console.log('Address cleanup completed successfully')
      process.exit(0)
    })
    .catch(err => {
      console.error('Failed to clean up addresses:', err)
      process.exit(1)
    })
}

export { cleanupDuplicateAddresses } 