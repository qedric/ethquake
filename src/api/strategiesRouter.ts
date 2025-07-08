import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = express.Router()

// Serve the strategies page
router.get('/', (req, res) => {
  console.log('[Web Request] Serving strategies visualization page')
  res.sendFile(path.join(__dirname, '../../src/public/strategies.html'))
})

export default router 