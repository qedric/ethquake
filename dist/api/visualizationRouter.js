import express from 'express';
import { getDb } from '../strategies/ethquake/database/mongodb.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
// Serve the chart page
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/charts.html'));
});
// API endpoint to get chart data
router.get('/data', async (req, res) => {
    try {
        const db = await getDb();
        const transactions = await db.collection('analysis_results')
            .find({})
            .sort({ timestamp: 1 })
            .toArray();
        res.json(transactions);
    }
    catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});
export default router;
