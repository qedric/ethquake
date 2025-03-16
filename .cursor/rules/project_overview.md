# Phase one: automate data collection

In a given time period (3 months):

1. Identify timestamps where ETHUSD price moved more than n%
2. Identify all transactions >= 100 ETH in the hour leading up to each price movement
3. Identify transactions >= 100 ETH during flat normal trading ranges, as a control group
4. Identify all sending & receiving addresses from step 2, that do not appear in any transactions from step 3.
5. For each address identified in step 4, list all tx’s >= 100 ETH
6. plot all transactions from step 5, grouped by hour
7. chart by count of address instances per hourThe higher the count, the more likely a large price movement is imminent

## Details for each step:

### Price movement identifaction
1. I've already written a pinescript, @largePriceMovements.pine, and used it to output a list of timestamps on the hourly timeframe, for 6%, 8%, and 10% movements - you can find these in /data/percentage_price_movements_timestamps

### Transaction Collection leading up to price movement
2. Here we use thirdweb's insight api, we can adapt the uri:

`https://insight.thirdweb.com/v1/transactions?chain=1&filter_block_timestamp_gte=${start_timestamp}&filter_block_timestamp_lte=${end_timestamp}&sort_by=block_number&sort_order=desc&filter_value_gte=100000000000000000000&limit=200&clientId=${process.env.TW_CLIENT_ID}`

You just need to define start_timestamp and end_timestamp, where start should be 1 hour before the timestamp picked up in step 1.

This is the schema of the response from this api call:

`{
  "meta": {
    "page": 0,
    "total_items": 55,
    "limit_per_chain": 200,
    "chain_ids": [
      1
    ]
  },
  "data": [
    {
      "chain_id": "1",
      "hash": "0xac9d970136bc603816e3ea4ed5448c1cfaff8801cbf559ea47fafc8e407f7a36",
      "nonce": 1140679,
      "block_hash": "0xe0f87c388bc5062b5fec9a7cb3b651a4dd5b51104b3d8bb8f2ac09fe8f3d335f",
      "block_number": 19648873,
      "block_timestamp": 1713038303,
      "transaction_index": 137,
      "from_address": "0xbf94f0ac752c739f623c463b5210a7fb2cbb420b",
      "to_address": "0x300226f054150e787a797f1fd07f0e38a4a655f4",
      "value": 5276403336614035000,
      "gas": 210000,
      "gas_price": 265891111695,
      "data": "0x",
      "function_selector": "",
      "max_fee_per_gas": 800000000000,
      "max_priority_fee_per_gas": 2000000000,
      "transaction_type": 2,
      "r": "33204313308798684969966964165828171613369332685451283128705698389927787652781",
      "s": "55404361698948675971047837556325863522582529447941196630929550420470244480677",
      "v": "1",
      "access_list_json": "[]",
      "contract_address": null,
      "gas_used": 21000,
      "cumulative_gas_used": 17429342,
      "effective_gas_price": 265891111695,
      "blob_gas_used": 0,
      "blob_gas_price": 0,
      "logs_bloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "status": 1
    },
    {...}
  ]
}`

### Transaction Collection for control group
3. Randomly select an equal number of timestamps distributed evenly between the timestamps provided in step 1. These will not be large price movements, and we can assume that these will reveal regualar market activity. Run the same api call to gather all Txs (up to a max of 200) with a value >= 100ETH

### Identify 'addresses of interest'
4. Identify all addresses in the "to_address" and "from_address" fields of the transactions that appear in our target group (transactions gathered in step 2) that DO NOT appear in our control group (transactions gathered in step 3)

### Transaction collection for addresses of interest
5. For each 'address of interest' from step 4, run the api call above, this time from the earliest timestamp in our range from step 1, up to the present, identifying all transasctions by each address having a value >= 100 ETH. That means for each address we will need w api calls - one using filter_to_address and the other using filter_from_address.

This will result in a large list of transactions. as a potentially valuable byproduct, we can seperate all the addresses found in either the to address or the from address, that DO NOT appear in our list of 'addresses of interest' from step 4. Each of these addresses has either sent to or received from an address of interest and therefore can be subject to future analysis.

### Plotting results
6. Produce a table of of every transaction ordered by timestamp. This table should have the following properties: 

 - the table columns will be: timestamp, dateTime (ddMMYY HH:mm:ss), fromAddress, toAddress

### export to google sheets
7. Produce a google sheet with suite of charting and analysis so we can do things like:
 - group transactions by time period (15m, 1hr, 4hr, 1day)
 - isolate and find associations between addresses

#Phase two: produce indicator using the above data, for use in TradingView.

