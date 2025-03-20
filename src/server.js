// Update the checkEthquakeSignal function to use MongoDB
async function checkEthquakeSignal() {
  try {
    const db = await getDbClient()
    
    // Get the most recent 2 hourly counts
    const recentResults = await db.collection('analysis_results')
      .find({})
      .sort({ datetime: -1 })
      .limit(2)
      .toArray()
    
    if (recentResults.length < 2) return false
    
    // Check if both are over threshold
    return recentResults[0].count > 20 && recentResults[1].count > 20
    
  } catch (error) {
    console.error('Error checking EthQuake signal:', error)
    return false
  }
} 