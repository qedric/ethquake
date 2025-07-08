import { client } from '../lib/mongodb'

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
export async function getOpenPositions(): Promise<Position[]> {
  if (!client) throw new Error('MongoDB client not initialized')
  return client
    .db('strategies')
    .collection<Position>('positions')
    .find({ status: 'open' })
    .toArray()
} 