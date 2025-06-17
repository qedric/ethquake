import fs from 'fs';
import path from 'path';
/*

    node src/adresses_of_interest.js ./data/transactions_before_6pct_movements.json ./data/transactions_control_6pct.json ./data/addresses_of_interest_6pct.json

*/
// Load transaction data from files
// You'll need to have these files with your transaction data
const loadTransactionData = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        // Handle both formats: array of transactions or {data: [...]} structure
        return Array.isArray(parsed) ? { data: parsed } : parsed;
    }
    catch (error) {
        console.error(`Failed to load data from ${filePath}:`, error);
        return { data: [] };
    }
};
// Extract unique addresses from transactions
const extractAddresses = (transactions) => {
    const addresses = new Set();
    for (const tx of transactions) {
        if (tx.from_address)
            addresses.add(tx.from_address);
        if (tx.to_address)
            addresses.add(tx.to_address);
    }
    return Array.from(addresses);
};
// Main function
const identifyAddressesOfInterest = (targetFilePath = './data/target_transactions.json', controlFilePath = './data/control_transactions.json', outputFilePath = './data/addresses_of_interest.json') => {
    // Load transaction data
    const targetTransactions = loadTransactionData(path.resolve(targetFilePath));
    const controlTransactions = loadTransactionData(path.resolve(controlFilePath));
    if (!targetTransactions.data || !controlTransactions.data) {
        console.error('Missing transaction data. Make sure your data files exist.');
        return [];
    }
    // Extract unique addresses
    const targetAddresses = extractAddresses(targetTransactions.data);
    const controlAddresses = extractAddresses(controlTransactions.data);
    const controlSet = new Set(controlAddresses);
    console.log(`Found ${targetAddresses.length} unique addresses in target transactions`);
    console.log(`Found ${controlAddresses.length} unique addresses in control transactions`);
    // Find addresses of interest
    const addressesOfInterest = targetAddresses.filter(addr => !controlSet.has(addr));
    console.log(`Found ${addressesOfInterest.length} addresses of interest`);
    // Save addresses of interest to file
    const outputPath = path.resolve(outputFilePath);
    fs.writeFileSync(outputPath, JSON.stringify(addressesOfInterest, null, 2));
    console.log(`Addresses of interest saved to ${outputPath}`);
    return addressesOfInterest;
};
// Run the function with command line arguments if provided
if (import.meta.url === `file://${process.argv[1]}`) {
    const targetFilePath = process.argv[2] || './data/target_transactions.json';
    const controlFilePath = process.argv[3] || './data/control_transactions.json';
    const outputFilePath = process.argv[4] || './data/addresses_of_interest.json';
    // Just call the function directly since it's not async
    try {
        identifyAddressesOfInterest(targetFilePath, controlFilePath, outputFilePath);
        console.log('Done!');
    }
    catch (err) {
        console.error('Failed to identify addresses of interest:', err);
        process.exit(1);
    }
}
else {
    // Don't run automatically when imported
}
export { identifyAddressesOfInterest };
