/**
 * Prompts the user to select a database instance in development mode
 * @returns {Promise<string>} The selected database name
 */
async function selectDatabase(): Promise<string> {
  // Env override always wins (useful for staging/prod split)
  if (process.env.MONGO_DB_NAME && process.env.MONGO_DB_NAME.trim().length > 0) {
    const envDb = process.env.MONGO_DB_NAME.trim()
    console.log(`[Strategy: ethquake] Using database from MONGO_DB_NAME: ${envDb}`)
    return envDb
  }

  if (process.env.NODE_ENV === 'production') {
    console.log('[Strategy: ethquake] Production mode - using ethquake database')
    return 'ethquake' // Always use A in production
  }

  return new Promise((resolve) => {
    console.log('\n[Strategy: ethquake] Development Mode: Select Database Instance')
    console.log('[Strategy: ethquake] 1. ethquake (A) - Production database')
    console.log('[Strategy: ethquake] 2. ethquake_b (B) - Testing database')
    console.log('[Strategy: ethquake] Select database (1 or 2): ')

    // Use raw mode to get single character input
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const onData = (key: string) => {
      if (key === '1' || key === '2') {
        // Echo the character
        process.stdout.write(key + '\n')
        
        // Clean up
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', onData)

        const dbName = key === '2' ? 'ethquake_b' : 'ethquake'
        console.log(`[Strategy: ethquake] Selected database: ${dbName}`)
        resolve(dbName)
      } else if (key === '\u0003') { // Ctrl+C
        process.exit()
      }
    }

    process.stdin.on('data', onData)
  })
}

export { selectDatabase } 