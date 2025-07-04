import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export interface StrategyConfig {
    name: string
    enabled: boolean
    description: string
    cronSchedule: string
    trading: {
        symbol: string
        position_size: number
        timeframe: number
    }
    indicators: {
        ema_fast: number
        ema_mid_1: number
        ema_mid_2: number
        ema_slow: number
        ema_sentiment?: {
            enabled: boolean
            length: number
        }
    }
    risk_management: {
        take_profit: {
            enabled: boolean
            percentage: number
        }
        stop_loss: {
            enabled: boolean
            percentage: number
        }
        trailing_stop: {
            enabled: boolean
            percentage: number
        }
    }
}

export function loadStrategyConfig(strategyPath: string): StrategyConfig {
    try {
        const configPath = join(dirname(fileURLToPath(import.meta.url)), '..', strategyPath, 'strategy.json')
        const configFile = readFileSync(configPath, 'utf-8')
        return JSON.parse(configFile)
    } catch (error) {
        console.error(`Failed to load strategy config from ${strategyPath}:`, error)
        throw error
    }
} 