import { getAccountBalance, getCurrentPrice, calculatePositionSize } from '../kraken.js'

const TEST_SYMBOL = 'PF_ETHUSD'

interface TestCase {
  name: string
  positionSize: number
  positionSizeType: 'percent' | 'fixed' | 'risk'
  stopDistance?: number
  expectedBehavior?: string
}

const tests: TestCase[] = [
  {
    name: 'Fixed position size (should return as-is)',
    positionSize: 0.5,
    positionSizeType: 'fixed',
    expectedBehavior: 'Should return 0.5 regardless of account balance or price'
  },
  {
    name: 'Small percentage (1% of portfolio)',
    positionSize: 1.0,
    positionSizeType: 'percent',
    expectedBehavior: 'Should calculate 1% of account balance divided by current price'
  },
  {
    name: 'Medium percentage (5% of portfolio)',
    positionSize: 5.0,
    positionSizeType: 'percent',
    expectedBehavior: 'Should calculate 5% of account balance divided by current price'
  },
  {
    name: 'Large percentage (10% of portfolio)',
    positionSize: 10.0,
    positionSizeType: 'percent',
    expectedBehavior: 'Should calculate 10% of account balance divided by current price'
  },
  {
    name: 'Risk-based sizing (2% risk, 5% stop)',
    positionSize: 2.0,
    positionSizeType: 'risk',
    stopDistance: 5.0,
    expectedBehavior: 'Should calculate position size so that 5% stop loss = 2% account risk'
  },
  {
    name: 'Risk-based sizing (5% risk, 3% stop)',
    positionSize: 5.0,
    positionSizeType: 'risk',
    stopDistance: 3.0,
    expectedBehavior: 'Should calculate position size so that 3% stop loss = 5% account risk'
  }
]

async function testPositionSizing() {
  console.log('=== Position Size Calculation Test ===\n')

  try {
    // Get real data from Kraken
    console.log('📊 Fetching real data from Kraken...')
    const accountBalance = await getAccountBalance()
    const currentPrice = await getCurrentPrice(TEST_SYMBOL)
    
    console.log(`💰 Account Balance: $${accountBalance.toFixed(2)}`)
    console.log(`📈 Current ${TEST_SYMBOL} Price: $${currentPrice.toFixed(2)}`)
    console.log(`📊 Portfolio Value: $${accountBalance.toFixed(2)}`)
    console.log('')

    // Run each test case
    for (const test of tests) {
      console.log(`🧪 Test: ${test.name}`)
      console.log(`   Position Size: ${test.positionSize}${test.positionSizeType === 'percent' ? '%' : ' units'}`)
      console.log(`   Expected Behavior: ${test.expectedBehavior}`)
      
      try {
        const calculatedSize = await calculatePositionSize(
          test.positionSize,
          test.positionSizeType,
          TEST_SYMBOL,
          test.stopDistance
        )

        console.log(`   ✅ Calculated Size: ${calculatedSize.toFixed(4)} units`)
        
        if (test.positionSizeType === 'percent') {
          const portfolioValue = accountBalance * (test.positionSize / 100)
          const expectedSize = portfolioValue / currentPrice
          const difference = Math.abs(calculatedSize - expectedSize)
          
          console.log(`   📊 Calculation Breakdown:`)
          console.log(`      Portfolio Value (${test.positionSize}%): $${portfolioValue.toFixed(2)}`)
          console.log(`      Expected Size: ${expectedSize.toFixed(4)} units`)
          console.log(`      Difference: ${difference.toFixed(4)} units`)
          
          // Show what the order would look like
          console.log(`   📋 Sample Order Parameters:`)
          console.log(`      Side: 'buy'`)
          console.log(`      Size: ${calculatedSize.toFixed(4)}`)
          console.log(`      Symbol: ${TEST_SYMBOL}`)
          console.log(`      Estimated Order Value: $${(calculatedSize * currentPrice).toFixed(2)}`)
        } else if (test.positionSizeType === 'risk') {
          const riskAmount = accountBalance * (test.positionSize / 100)
          const stopDistanceInPrice = currentPrice * (test.stopDistance! / 100)
          const expectedSize = riskAmount / stopDistanceInPrice
          const difference = Math.abs(calculatedSize - expectedSize)
          
          console.log(`   📊 Risk Calculation Breakdown:`)
          console.log(`      Risk Amount (${test.positionSize}% of account): $${riskAmount.toFixed(2)}`)
          console.log(`      Stop Distance (${test.stopDistance}%): $${stopDistanceInPrice.toFixed(2)}`)
          console.log(`      Expected Size: ${expectedSize.toFixed(4)} units`)
          console.log(`      Difference: ${difference.toFixed(4)} units`)
          
          // Show what the order would look like
          console.log(`   📋 Sample Order Parameters:`)
          console.log(`      Side: 'buy'`)
          console.log(`      Size: ${calculatedSize.toFixed(4)}`)
          console.log(`      Symbol: ${TEST_SYMBOL}`)
          console.log(`      Estimated Order Value: $${(calculatedSize * currentPrice).toFixed(2)}`)
          console.log(`      Max Loss if Stop Hit: $${(calculatedSize * stopDistanceInPrice).toFixed(2)} (${test.positionSize}% of account)`)
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`)
      }
      
      console.log('')
    }

    // Additional analysis
    console.log('📈 Position Size Analysis:')
    console.log('')
    
    // Test different percentage sizes
    const percentages = [0.5, 1, 2, 5, 10, 20]
    console.log('Percentage-based sizing comparison:')
    console.log('Size% | Units    | Order Value')
    console.log('------|----------|------------')
    
    for (const percentage of percentages) {
      try {
        const size = await calculatePositionSize(percentage, 'percent', TEST_SYMBOL)
        const orderValue = size * currentPrice
        console.log(`${percentage.toString().padStart(5)}% | ${size.toFixed(4).padStart(8)} | $${orderValue.toFixed(2).padStart(10)}`)
      } catch (error) {
        console.log(`${percentage.toString().padStart(5)}% | ERROR    | ERROR`)
      }
    }
    
    console.log('')
    console.log('💡 Risk Analysis:')
    console.log(`   - 1% position = $${(accountBalance * 0.01).toFixed(2)} risk`)
    console.log(`   - 5% position = $${(accountBalance * 0.05).toFixed(2)} risk`)
    console.log(`   - 10% position = $${(accountBalance * 0.10).toFixed(2)} risk`)
    console.log(`   - 20% position = $${(accountBalance * 0.20).toFixed(2)} risk`)
    
    console.log('')
    console.log('✅ Position sizing test completed successfully!')

  } catch (error) {
    console.error('❌ Test failed:', error)
    throw error
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testPositionSizing()
    .then(() => {
      console.log('\n🎉 All tests passed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error)
      process.exit(1)
    })
}

export { testPositionSizing } 