import { client } from '../lib/mongodb.js'
import { getOpenPositions, getCurrentPrice, getOrderStatus } from './kraken.js'

export interface Position {
  _id?: string
  strategyId: string  // ID of the strategy that opened this position
  symbol: string      // Trading pair symbol
  side: 'long' | 'short'
  size: number
  status: 'open' | 'closed'
  entryPrice: number
  exitPrice?: number
  pnl?: number        // Realized PnL when position is closed
  openedAt: Date
  closedAt?: Date
  orders: {
    entry: {
      orderId: string
      status: string
      price: number
      timestamp: Date
    }
    stopLoss?: {
      orderId: string
      status: string
      price: number
      type: 'fixed' | 'trailing'
      distance?: number  // For trailing stops
      timestamp: Date
    }
    takeProfit?: {
      orderId: string
      status: string
      price: number
      timestamp: Date
    }
    exit?: {
      orderId: string
      status: string
      price: number
      timestamp: Date
      reason: 'stop_loss' | 'take_profit' | 'manual' | 'strategy'
    }
  }
}

/**
 * Creates a new position record when a trade is opened
 */
export async function createPosition(position: Omit<Position, '_id'>): Promise<string> {
  if (!client) throw new Error('MongoDB client not initialized')
  const result = await client
    .db('strategies')
    .collection<Position>('positions')
    .insertOne(position)
  
  return result.insertedId.toString()
}

/**
 * Updates an existing position with new order information
 */
export async function updatePosition(
  positionId: string,
  update: Partial<Position>
): Promise<boolean> {
  if (!client) throw new Error('MongoDB client not initialized')
  const result = await client
    .db('strategies')
    .collection<Position>('positions')
    .updateOne(
      { _id: positionId },
      { $set: update }
    )
  
  return result.modifiedCount > 0
}

/**
 * Marks a position as closed and calculates final PnL
 */
export async function closePosition(
  positionId: string,
  exitPrice: number,
  exitOrderId: string,
  reason: 'stop_loss' | 'take_profit' | 'manual' | 'strategy'
): Promise<boolean> {
  if (!client) throw new Error('MongoDB client not initialized')
  const position = await client
    .db('strategies')
    .collection<Position>('positions')
    .findOne({ _id: positionId })

  if (!position) return false

  // Calculate PnL
  const pnl = position.side === 'long'
    ? (exitPrice - position.entryPrice) * position.size
    : (position.entryPrice - exitPrice) * position.size

  const update = {
    status: 'closed' as const,
    exitPrice,
    pnl,
    closedAt: new Date(),
    orders: {
      ...position.orders,
      exit: {
        orderId: exitOrderId,
        status: 'FULLY_EXECUTED',
        price: exitPrice,
        timestamp: new Date(),
        reason
      }
    }
  }

  const result = await client
    .db('strategies')
    .collection<Position>('positions')
    .updateOne(
      { _id: positionId },
      { $set: update }
    )

  return result.modifiedCount > 0
}

/**
 * Updates the status of a position's order (stop loss, take profit, etc.)
 */
export async function updateOrderStatus(
  positionId: string,
  orderType: 'entry' | 'stopLoss' | 'takeProfit' | 'exit',
  status: string
): Promise<boolean> {
  if (!client) throw new Error('MongoDB client not initialized')
  const result = await client
    .db('strategies')
    .collection<Position>('positions')
    .updateOne(
      { _id: positionId },
      { $set: { [`orders.${orderType}.status`]: status } }
    )

  return result.modifiedCount > 0
}

/**
 * Gets all positions for a strategy
 */
export async function getStrategyPositions(
  strategyId: string,
  status?: 'open' | 'closed'
): Promise<Position[]> {
  if (!client) throw new Error('MongoDB client not initialized')
  const query = {
    strategyId,
    ...(status && { status })
  }

  return client
    .db('strategies')
    .collection<Position>('positions')
    .find(query)
    .sort({ openedAt: -1 })
    .toArray()
}

/**
 * Gets a single position by ID
 */
export async function getPosition(positionId: string): Promise<Position | null> {
  if (!client) throw new Error('MongoDB client not initialized')
  return client
    .db('strategies')
    .collection<Position>('positions')
    .findOne({ _id: positionId })
}

/**
 * Gets all open positions
 */
export async function getOpenPositionsFromDb(): Promise<Position[]> {
  if (!client) throw new Error('MongoDB client not initialized')
  return client
    .db('strategies')
    .collection<Position>('positions')
    .find({ status: 'open' })
    .toArray()
} 

/**
 * Checks and updates position status against Kraken's API
 * Returns true if position status was updated, false if no update needed
 */
export async function syncPositionWithExchange(
  strategyId: string,
  symbol: string
): Promise<boolean> {
  if (!client) throw new Error('MongoDB client not initialized')

  // Get our local position record
  const localPosition = await client
    .db('strategies')
    .collection<Position>('positions')
    .findOne({ 
      strategyId,
      symbol,
      status: 'open'  // Only check open positions
    })

  // Get position from Kraken
  const response = await getOpenPositions()
  const positions = response.data?.openPositions || []
  const exchangePosition = positions.find((pos: any) => pos.symbol === symbol)

  // If we have a local position but no exchange position, it was closed
  if (localPosition && !exchangePosition) {
    // Get current price for PnL calculation
    const currentPrice = await getCurrentPrice(symbol)
    
    // Check if it was closed by one of our exit orders
    let closeReason: 'stop_loss' | 'take_profit' | 'manual' = 'manual'
    let closeOrderId = 'external_close'

    // Check stop loss order status
    if (localPosition.orders.stopLoss) {
      try {
        const stopStatus = await getOrderStatus(localPosition.orders.stopLoss.orderId)
        if (stopStatus.status === 'FULLY_EXECUTED') {
          closeReason = 'stop_loss'
          closeOrderId = localPosition.orders.stopLoss.orderId
        }
      } catch (error) {
        // If order not found, it wasn't this order that closed the position
        console.log(`Stop loss order ${localPosition.orders.stopLoss.orderId} not found or error:`, error)
      }
    }

    // If not closed by stop loss, check take profit
    if (closeReason === 'manual' && localPosition.orders.takeProfit) {
      try {
        const tpStatus = await getOrderStatus(localPosition.orders.takeProfit.orderId)
        if (tpStatus.status === 'FULLY_EXECUTED') {
          closeReason = 'take_profit'
          closeOrderId = localPosition.orders.takeProfit.orderId
        }
      } catch (error) {
        // If order not found, it wasn't this order that closed the position
        console.log(`Take profit order ${localPosition.orders.takeProfit.orderId} not found or error:`, error)
      }
    }
    
    // Mark position as closed with the determined reason
    await closePosition(
      localPosition._id!,
      currentPrice,
      closeOrderId,
      closeReason
    )
    return true
  }

  // If we have an exchange position but no local position, something's wrong
  // Log this but don't take action
  if (!localPosition && exchangePosition) {
    console.error(`Found exchange position for ${symbol} but no local record`, exchangePosition)
    return false
  }

  // If we have both, check if stop orders are still active
  if (localPosition && exchangePosition) {
    const updates: any = {}
    
    // Check stop loss order
    if (localPosition.orders.stopLoss) {
      const stopStatus = await getOrderStatus(localPosition.orders.stopLoss.orderId)
      if (stopStatus.status !== localPosition.orders.stopLoss.status) {
        updates['orders.stopLoss.status'] = stopStatus.status
      }
    }

    // Check take profit order
    if (localPosition.orders.takeProfit) {
      const tpStatus = await getOrderStatus(localPosition.orders.takeProfit.orderId)
      if (tpStatus.status !== localPosition.orders.takeProfit.status) {
        updates['orders.takeProfit.status'] = tpStatus.status
      }
    }

    // If we have updates, apply them
    if (Object.keys(updates).length > 0) {
      await client
        .db('strategies')
        .collection<Position>('positions')
        .updateOne(
          { _id: localPosition._id },
          { $set: updates }
        )
      return true
    }
  }

  return false
} 