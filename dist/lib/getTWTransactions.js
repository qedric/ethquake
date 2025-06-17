import dotenv from 'dotenv';
import axios from 'axios';
// Initialize dotenv
dotenv.config();
// Constants
const TW_CLIENT_ID = process.env.TW_CLIENT_ID;
const DEFAULT_MIN_ETH_VALUE = '100000000000000000000';
if (!TW_CLIENT_ID) {
    console.error('Missing TW_CLIENT_ID in environment variables');
    process.exit(1);
}
/**
 * Fetches transactions from ThirdWeb Insights API with flexible filtering options
 * @param {Object} options - Filter options for the API query
 * @returns {Array} Array of transaction objects
 */
export async function fetchTransactions(options = {}) {
    try {
        // Base URL with chain and client ID
        let url = `https://insight.thirdweb.com/v1/transactions?chain=1&clientId=${TW_CLIENT_ID}`;
        // Default parameters
        url += '&sort_by=block_number&sort_order=desc&limit=200';
        // Add filter for minimum ETH value if not provided
        if (!options.filter_value_gte) {
            url += `&filter_value_gte=${DEFAULT_MIN_ETH_VALUE}`;
        }
        // Add all filters from options
        for (const [key, value] of Object.entries(options)) {
            // Skip null or undefined values
            if (value === null || value === undefined)
                continue;
            // Add filter parameter to URL
            url += `&${key}=${value}`;
        }
        // Log basic info about the request (keeping some logging for debugging)
        /* console.log(`Fetching transactions with filters:`,
          Object.keys(options).length > 0 ? options : 'No filters') */
        const response = await axios.get(url);
        return response.data.data || [];
    }
    catch (error) {
        console.error('Error fetching transactions:', error instanceof Error ? error.message : String(error));
        if (error instanceof Error && 'response' in error) {
            const data = error.response.data;
            if (typeof data === 'string' && data.trim().toLowerCase().startsWith('<!doctype html')) {
                console.error('Response data: [HTML error page skipped]');
            }
            else {
                console.error('Response data:', data);
            }
            console.error('Response status:', error.response.status);
        }
        return []; // Return empty array on error
    }
}
