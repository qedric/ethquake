import { placeOrderWithExits, placeStandaloneOrder, getCurrentPrice, calculatePositionSize } from '../../../trading/kraken.js'

// Test parameters (override strategy defaults)
const TRADING_PAIR = 'PF_SUIUSD'
const POSITION_SIZE = 1 // % of account risked
const FIXED_STOP_DISTANCE = 2 // % fixed stop
const TRAILING_STOP_DISTANCE = 4 // % trailing stop
const POSITION_SIZE_TYPE = 'risk'
const POSITION_SIZE_PRECISION = 0

// Helper function to round price to 2 decimal places
function roundPrice(price: number): number {
    return Math.round(price * 100) / 100
}

async function testOrderExecution(direction: 'buy' | 'sell') {

    try {

        // Place order with fixed stop for risk sizing, then add trailing stop
        let orderResult = null
        let trailingStopResult = null
        if (direction === 'buy' || direction === 'sell') {
            console.log(`[Strategy: ethquake] Placing ${direction} order`)

            // Calculate the fixed stop price for risk sizing
            const currentPrice = await getCurrentPrice(TRADING_PAIR)
            const fixedStopPrice = roundPrice(direction === 'buy'
                ? currentPrice * (1 - FIXED_STOP_DISTANCE / 100) // For buy orders, stop below current price
                : currentPrice * (1 + FIXED_STOP_DISTANCE / 100) // For sell orders, stop above current price
            )

            const fixedStopConfig = {
                type: 'fixed' as const,
                distance: FIXED_STOP_DISTANCE,
                stopPrice: fixedStopPrice
            }

            // Calculate the position size first (this will be the same for both market order and trailing stop)
            const calculatedPositionSize = await calculatePositionSize(POSITION_SIZE, POSITION_SIZE_TYPE, TRADING_PAIR, FIXED_STOP_DISTANCE, POSITION_SIZE_PRECISION)
            console.log(`[Strategy: ethquake] Calculated position size: ${calculatedPositionSize} units`)

            // Place order with fixed stop (this determines position size based on 2% risk)
            orderResult = await placeOrderWithExits(direction, calculatedPositionSize, fixedStopConfig, { type: 'none', price: 0 }, TRADING_PAIR, false, 'ethquake', 'fixed', POSITION_SIZE_PRECISION, true)

            if (orderResult?.marketOrder?.sendStatus) {
                console.log('[Strategy: ethquake] Market order placed at price:', fixedStopConfig.stopPrice ? `Entry: ${currentPrice}` : 'N/A')
            }
            if (fixedStopConfig.stopPrice) {
                console.log(`[Strategy: ethquake] Fixed stop set at: ${fixedStopConfig.stopPrice}`)
            }

            // If the initial order was successful, place a trailing stop for profit protection
            if (orderResult?.marketOrder?.result === 'success' && orderResult?.marketOrder?.sendStatus?.order_id) {
                console.log(`[Strategy: ethquake] Initial order successful, placing trailing stop for profit protection at ${TRAILING_STOP_DISTANCE}%`)

                try {

                    // Place the trailing stop order (same size as main position)
                    trailingStopResult = await placeStandaloneOrder(
                        'trailing_stop',
                        direction === 'buy' ? 'sell' : 'buy', // Opposite side for stop loss
                        calculatedPositionSize,
                        TRADING_PAIR,
                        { distance: TRAILING_STOP_DISTANCE, deviationUnit: 'PERCENT' },
                        true // reduceOnly
                    )
                    if (trailingStopResult?.stopOrder?.sendStatus) {
                        console.log(`[Strategy: ethquake] Trailing stop placed with deviation: ${TRAILING_STOP_DISTANCE}%`)
                    }
                    if (trailingStopResult?.result === 'success') {
                        console.log(`[Strategy: ethquake] Trailing stop placed successfully at ${TRAILING_STOP_DISTANCE}%`)
                    } else {
                        console.error('[Strategy: ethquake] Failed to place trailing stop:', trailingStopResult?.error)
                    }
                } catch (trailingStopError) {
                    console.error('[Strategy: ethquake] Error placing trailing stop:', trailingStopError)
                }
            }
        }

        const trailingStopInfo = trailingStopResult?.result === 'success'
            ? '\nTrailing Stop: placed'
            : '\nTrailing Stop: failed'

        console.log(trailingStopInfo)

    } catch (error) {
        console.error('[Strategy: ethquake] Error executing trading strategy:', error)
    }

}

// CLI usage: node test-strategy.ts buy OR node test-strategy.ts sell
const arg = process.argv[2]
if (arg !== 'buy' && arg !== 'sell') {
  console.error('Usage: ts-node test-strategy.ts <buy|sell>')
  process.exit(1)
}

testOrderExecution(arg as 'buy' | 'sell').then(() => {
  console.log('[Test] Done')
  process.exit(0)
}).catch(err => {
  console.error('[Test] Failed:', err)
  process.exit(1)
})