import { placeOrderWithExits, placeStandaloneOrder, getCurrentPrice, calculatePositionSize, roundPrice, getPricePrecision } from '../../../trading/kraken.js'

// Test parameters (override strategy defaults)
const TRADING_PAIR = 'PF_ETHUSD'
const POSITION_SIZE = 0.5 // % of account risked - larger to get past market order
const FIXED_STOP_DISTANCE = 2 // % fixed stop
const TRAILING_STOP_DISTANCE = 4 // % trailing stop
const POSITION_SIZE_TYPE = 'risk'
const POSITION_SIZE_PRECISION = 3

async function testOrderExecution(direction: 'buy' | 'sell') {

    try {

        // First set trailing stop, then place market order with exits if successful
        let orderResult = null
        let trailingStopResult = null
        if (direction === 'buy' || direction === 'sell') {
            console.log(`[Strategy: ethquake] Placing ${direction} order`)

            // Calculate position size once and use for both orders
            const calculatedPositionSize = await calculatePositionSize(POSITION_SIZE, POSITION_SIZE_TYPE, TRADING_PAIR, FIXED_STOP_DISTANCE, POSITION_SIZE_PRECISION)
            console.log(`[Test] Calculated position size: ${calculatedPositionSize} units`)

            // First, place the trailing stop for profit protection
            console.log(`[Test] Placing trailing stop for profit protection at ${TRAILING_STOP_DISTANCE}%`)
            try {
                trailingStopResult = await placeStandaloneOrder(
                    'trailing_stop',
                    direction === 'buy' ? 'sell' : 'buy', // Opposite side for stop loss
                    calculatedPositionSize,
                    TRADING_PAIR,
                    { distance: TRAILING_STOP_DISTANCE, deviationUnit: 'PERCENT' },
                    true // reduceOnly
                )

                if (trailingStopResult?.result === 'success') {
                    console.log(`[Test] Trailing stop placed successfully at ${TRAILING_STOP_DISTANCE}%`)
                } else {
                    console.error('[Test] Failed to place trailing stop:', trailingStopResult?.error)
                    // Don't proceed with market order if trailing stop fails
                    throw new Error('Failed to place trailing stop')
                }
            } catch (trailingStopError) {
                console.error('[Test] Error placing trailing stop:', trailingStopError)
                throw new Error('Failed to place trailing stop')
            }

            // If trailing stop was successful, place market order with fixed stop for risk sizing
            console.log(`[Test] Trailing stop successful, placing market order with fixed stop`)

            // Calculate the fixed stop price for risk sizing
            const currentPrice = await getCurrentPrice(TRADING_PAIR)
            const fixedStopPrice = roundPrice(direction === 'buy'
                ? currentPrice * (1 - FIXED_STOP_DISTANCE / 100) // For buy orders, stop below current price
                : currentPrice * (1 + FIXED_STOP_DISTANCE / 100) // For sell orders, stop above current price
            , getPricePrecision(TRADING_PAIR))
            
            console.log(`[Test] Current price: ${currentPrice}, Stop price: ${fixedStopPrice}, Distance: ${Math.abs(currentPrice - fixedStopPrice)} points`)

            const fixedStopConfig = {
                type: 'fixed' as const,
                distance: FIXED_STOP_DISTANCE,
                stopPrice: fixedStopPrice
            }

            // Place order with fixed stop using the same calculated position size
            console.log(`[Test] About to place order with size: ${calculatedPositionSize} units, direction: ${direction}, stopPrice: ${fixedStopConfig.stopPrice}`)
            // Use the same calculated position size instead of recalculating
            orderResult = await placeOrderWithExits(direction, calculatedPositionSize, fixedStopConfig, { type: 'none', price: 0 }, TRADING_PAIR, false, 'ethquake', 'fixed', POSITION_SIZE_PRECISION, true)

            if (orderResult?.marketOrder?.sendStatus) {
                console.log('[Test] Market order placed successfully')
            }
            if (fixedStopConfig.stopPrice) {
                console.log(`[Test] Fixed stop set at: ${fixedStopConfig.stopPrice}`)
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