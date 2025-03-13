import { client } from './mongodb.js'

console.log("ETH Wallet Analysis System Starting...")

// tx's with values over 100 ETH in given timeframe:
`https://insight.thirdweb.com/v1/transactions?chain=1&filter_block_timestamp_gte=1740932700&filter_block_timestamp_lte=1740933900&sort_by=block_number&sort_order=desc&filter_value_gte=100000000000000000000&limit=200&clientId=YOUR_THIRDWEB_CLIENT_ID`

async function findLargeMovements(n) {
  console.log("Starting aggregation...")

  const agg = [
    {
      '$sort': {
        'timestamp': -1
      }
    }, {
      '$group': {
        '_id': null, 
        'docs': {
          '$push': '$$ROOT'
        }
      }
    }, 
    {
      '$project': {
        'docs': {
          '$map': {
            'input': {
              '$range': [
                1, {
                  '$subtract': [
                    {
                      '$size': '$docs'
                    }, 1
                  ]
                }
              ]
            }, 
            'as': 'idx', 
            'in': {
              '$let': {
                'vars': {
                  'current': {
                    '$arrayElemAt': [
                      '$docs', '$$idx'
                    ]
                  }, 
                  'previous': {
                    '$arrayElemAt': [
                      '$docs', {
                        '$subtract': [
                          '$$idx', 1
                        ]
                      }
                    ]
                  }
                }, 
                'in': {
                  '$cond': {
                    'if': {
                      '$gt': [
                        {
                          '$abs': {
                            '$subtract': [
                              '$$current.price', '$$previous.price'
                            ]
                          }
                        }, {
                          '$multiply': [
                            '$$previous.price', n
                          ]
                        }
                      ]
                    }, 
                    'then': '$$current', 
                    'else': null
                  }
                }
              }
            }
          }
        }
      }
    }, {
      '$unwind': '$docs'
    }, {
      '$match': {
        'docs': {
          '$ne': null
        }
      }
    }, {
      '$replaceRoot': {
        'newRoot': '$docs'
      }
    }
  ]

  const coll = client.db('cryptoData').collection('ethPrices')
  const cursor = coll.aggregate(agg)
  const result = await cursor.toArray()
  await client.close()
  return result
}

findLargeMovements(0.01)
  .then(result => {
    console.log(result, `${result.length} results:`)
    process.exit(0) // Terminate the program successfully
  })
  .catch(err => {
    console.error("Error:", err)
    process.exit(1) // Terminate the program with an error
  })