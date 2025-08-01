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
            , getPricePrecision(TRADING_PAIR))
            
            console.log(`[Test] Current price: ${currentPrice}, Stop price: ${fixedStopPrice}, Distance: ${Math.abs(currentPrice - fixedStopPrice)} points`)

            const fixedStopConfig = {
                type: 'fixed' as const,
                distance: FIXED_STOP_DISTANCE,
                stopPrice: fixedStopPrice
            }

            // Place order with fixed stop (this determines position size based on 2% risk)
            console.log(`[Test] About to place order with size: ${POSITION_SIZE}%, direction: ${direction}, stopPrice: ${fixedStopConfig.stopPrice}`)
            // Use risk-based sizing like the strategy
            orderResult = await placeOrderWithExits(direction, POSITION_SIZE, fixedStopConfig, { type: 'none', price: 0 }, TRADING_PAIR, false, 'ethquake', POSITION_SIZE_TYPE, POSITION_SIZE_PRECISION, true)

            if (orderResult?.marketOrder?.sendStatus) {
                console.log('[Strategy: ethquake] Market order placed successfully')
            }
            if (fixedStopConfig.stopPrice) {
                console.log(`[Strategy: ethquake] Fixed stop set at: ${fixedStopConfig.stopPrice}`)
            }

            // If the initial order was successful, place a trailing stop for profit protection
            if (orderResult?.marketOrder?.result === 'success' && orderResult?.marketOrder?.sendStatus?.order_id) {
                console.log(`[Strategy: ethquake] Initial order successful, placing trailing stop for profit protection at ${TRAILING_STOP_DISTANCE}%`)

                try {
                    // Calculate position size for the trailing stop (same as main order)
                    const calculatedPositionSize = await calculatePositionSize(POSITION_SIZE, POSITION_SIZE_TYPE, TRADING_PAIR, FIXED_STOP_DISTANCE, POSITION_SIZE_PRECISION)
                    console.log(`[Strategy: ethquake] Calculated position size for trailing stop: ${calculatedPositionSize} units`)

                    // Place the trailing stop order (same size as main position)
                    trailingStopResult = await placeStandaloneOrder(
                        'trailing_stop',
                        direction === 'buy' ? 'sell' : 'buy', // Opposite side for stop loss
                        calculatedPositionSize,
                        TRADING_PAIR,
                        { distance: TRAILING_STOP_DISTANCE, deviationUnit: 'PERCENT' },
                        true // reduceOnly
                    )

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