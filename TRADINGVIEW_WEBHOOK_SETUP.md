# TradingView Webhook Setup

## Overview

The TradingView webhook endpoint `/api/tv/alert-hook` receives trading alerts from TradingView Pine Scripts and processes them for automated trading.

## Endpoint Details

- **URL**: `POST /api/tv/alert-hook`
- **Content-Type**: `application/json`
- **Authentication**: None (webhook-specific security measures)

## Request Format

```json
{
  "strategy": {
    "order": {
      "action": "buy|sell",
      "contracts": 1
    },
    "position_size": 1
  },
  "ticker": "ETHUSD",
  "message": "Your alert message here",
  "timestamp": "2025-07-30T09:38:03.922Z" // Optional
}
```

## Security Measures

### 1. IP Whitelist (Primary Security)
The webhook only accepts requests from TradingView's official IP addresses:
- `52.89.214.238`
- `34.212.75.30`
- `54.218.53.128`
- `52.32.178.7`

### 2. Secret Token in Message (Additional Security)
Include a secret token in your alert message and set the environment variable:
```bash
TRADINGVIEW_WEBHOOK_SECRET=your_secret_token_here
```

### 3. User-Agent Validation (Fallback)
TradingView sends webhooks with a User-Agent header containing "TradingView". This is validated as a fallback when no secret is configured.

### 4. Timestamp Validation (Replay Attack Prevention)
All webhook requests must include a `timestamp` field. Requests older than 5 minutes are rejected to prevent replay attacks.

## TradingView Pine Script Setup

### Basic Alert Setup
```pinescript
//@version=5
strategy("My Strategy", overlay=true)

// Your strategy logic here
longCondition = close > open
shortCondition = close < open

if longCondition
    strategy.entry("Long", strategy.long)
    alert("Long entry", alert.freq_once_per_bar)

if shortCondition
    strategy.entry("Short", strategy.short)
    alert("Short entry", alert.freq_once_per_bar)
```

### Webhook Alert Setup
1. In TradingView, go to your chart
2. Click the "Alerts" button (bell icon)
3. Create a new alert with your strategy conditions
4. In the "Actions" section, select "Webhook URL"
5. Enter your webhook URL: `https://your-domain.com/api/tv/alert-hook`
6. Set the message format to JSON:
```json
{
  "strategy": {
    "order": {
      "action": "{{strategy.order.action}}",
      "contracts": "{{strategy.order.contracts}}"
    },
    "position_size": "{{strategy.position_size}}"
  },
  "ticker": "{{ticker}}",
  "message": "{{strategy.order.action}} {{strategy.order.contracts}} contracts on {{ticker}}"
}
```

## Testing

### Test with curl
```bash
# Test with User-Agent validation and timestamp
curl -X POST http://localhost:8080/api/tv/alert-hook \
  -H "Content-Type: application/json" \
  -H "User-Agent: TradingView/1.0" \
  -d '{
    "strategy": {
      "order": {"action": "buy", "contracts": 1},
      "position_size": 1
    },
    "ticker": "ETHUSD",
    "message": "Test alert",
    "timestamp": "2025-07-30T09:38:03.922Z"
  }'

# Test with secret token and timestamp
curl -X POST http://localhost:8080/api/tv/alert-hook \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": {
      "order": {"action": "sell", "contracts": 2},
      "position_size": -1
    },
    "ticker": "BTCUSD",
    "message": "Test alert with secret: your_secret_token_here",
    "timestamp": "2025-07-30T09:38:03.922Z"
  }'

# Test replay attack prevention (will fail)
curl -X POST http://localhost:8080/api/tv/alert-hook \
  -H "Content-Type: application/json" \
  -H "User-Agent: TradingView/1.0" \
  -d '{
    "strategy": {
      "order": {"action": "buy", "contracts": 1},
      "position_size": 1
    },
    "ticker": "ETHUSD",
    "message": "Old alert",
    "timestamp": "2025-07-30T08:00:00.000Z"
  }'
```

### View Recent Alerts
```bash
curl http://localhost:8080/api/tv/alerts
```

## Environment Variables

Add these to your `.env` file:

```bash
# Optional: Secret token for message validation
TRADINGVIEW_WEBHOOK_SECRET=your_secret_here
```

## Database Storage

All webhook alerts are stored in MongoDB in the `tradingview_alerts` database under the `alerts` collection with the following structure:

```json
{
  "_id": "ObjectId",
  "strategy": {
    "order": {
      "action": "buy|sell",
      "contracts": 1
    },
    "position_size": 1
  },
  "ticker": "ETHUSD",
  "message": "Alert message",
  "timestamp": "2025-07-30T09:38:03.922Z",
  "received_at": "2025-07-30T09:38:04.543Z",
  "processed": false
}
```

## Next Steps

1. Implement actual trading logic in the webhook handler
2. Add position management and risk controls
3. Set up monitoring and alerting for webhook failures
4. Consider rate limiting to prevent abuse 