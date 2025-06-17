/**
 * Prompts the user to select a database instance in development mode
 * @returns {Promise<string>} The selected database name
 */
async function selectDatabase() {
  if (process.env.NODE_ENV === 'production') {
    return 'ethquake' // Always use A in production
  }

  return new Promise((resolve) => {
    console.log('\nDevelopment Mode: Select Database Instance')
    console.log('1. ethquake (A) - Production database')
    console.log('2. ethquake_b (B) - Testing database')
    console.log('Select database (1 or 2): ')

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
        console.log(`Using database: ${dbName}`)
        resolve(dbName)
      } else if (key === '\u0003') { // Ctrl+C
        process.exit()
      }
    }

    process.stdin.on('data', onData)
  })
}

export { selectDatabase } 