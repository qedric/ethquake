import { ethers } from 'ethers'
import { getRpcUrlForChain } from 'thirdweb/chains'
import { createThirdwebClient } from 'thirdweb'
import dotenv from 'dotenv'

// Load env vars
dotenv.config()

// Create thirdweb client
const client = createThirdwebClient({
  secretKey: process.env.TW_SECRET_KEY,
  clientId: process.env.TW_CLIENT_ID
})

/**
 * Gets the block number closest to a given timestamp
 * @param {number} timestamp - UNIX timestamp in seconds
 * @returns {Promise<number>} - Block number
 */
async function getBlockNumberFromTimestamp(timestamp) {
  try {
    // Get RPC URL for Ethereum mainnet (chain ID 1)
    const rpcUrl = getRpcUrlForChain({ chain: 1, client })
    
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const blockNumber = await provider.getBlockNumber()
    console.log(`Current block number: ${blockNumber}`)
    
    // Binary search to find the closest block
    let left = 0
    let right = blockNumber
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const block = await provider.getBlock(mid)
      
      if (!block) {
        throw new Error(`Block ${mid} not found`)
      }
      
      console.log(`Checking block ${mid}: timestamp ${block.timestamp} (target: ${timestamp})`)
      
      if (block.timestamp === timestamp) {
        console.log(`Found exact match at block ${mid}`)
        return mid
      }
      
      if (block.timestamp < timestamp) {
        left = mid + 1
      } else {
        right = mid - 1
      }
    }
    
    // Return the closest block
    const leftBlock = await provider.getBlock(left)
    const rightBlock = await provider.getBlock(right)
    
    if (!leftBlock || !rightBlock) {
      throw new Error('Failed to get closest blocks')
    }
    
    const leftDiff = Math.abs(leftBlock.timestamp - timestamp)
    const rightDiff = Math.abs(rightBlock.timestamp - timestamp)
    
    const closestBlock = leftDiff < rightDiff ? left : right
    const closestTimestamp = leftDiff < rightDiff ? leftBlock.timestamp : rightBlock.timestamp
    
    console.log(`Found closest block ${closestBlock} with timestamp ${closestTimestamp} (diff: ${Math.min(leftDiff, rightDiff)} seconds)`)
    return closestBlock
  } catch (error) {
    console.error('Error getting block number from timestamp:', error)
    throw error
  }
}

export { getBlockNumberFromTimestamp } 