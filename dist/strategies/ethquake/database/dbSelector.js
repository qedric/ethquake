import readline from 'readline';
/**
 * Prompts the user to select a database instance in development mode
 * @returns {Promise<string>} The selected database name
 */
async function selectDatabase() {
    if (process.env.NODE_ENV === 'production') {
        return 'ethquake'; // Always use A in production
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        console.log('\nDevelopment Mode: Select Database Instance');
        console.log('1. ethquake (A) - Production database');
        console.log('2. ethquake_b (B) - Testing database');
        rl.question('Select database (1 or 2): ', (answer) => {
            rl.close();
            const dbName = answer === '2' ? 'ethquake_b' : 'ethquake';
            console.log(`Using database: ${dbName}`);
            resolve(dbName);
        });
    });
}
export { selectDatabase };
