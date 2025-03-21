import expressBasicAuth from 'express-basic-auth'
import session from 'express-session'
import dotenv from 'dotenv'

dotenv.config()

// Session middleware configuration
export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 3600000, // 1 hour
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',  // Allow cross-site cookies in production
    httpOnly: true // Prevents JavaScript from reading the cookie
  }
})

// Single basic auth middleware for everything
export const authMiddleware = expressBasicAuth({
  users: { 
    [process.env.BASIC_AUTH_USER || 'admin']: process.env.BASIC_AUTH_PASSWORD || 'changeme' 
  },
  challenge: true,
  unauthorizedResponse: (req) => {
    // Return JSON for API requests, text for browser requests
    const isApiRequest = req.headers.accept && req.headers.accept.includes('application/json')
    return isApiRequest 
      ? { error: 'Unauthorized' } 
      : 'Authentication required'
  }
})

// For backward compatibility - both point to the same middleware
export const basicAuthMiddleware = authMiddleware
export const sessionAuthMiddleware = authMiddleware

// API key middleware for external API routes
export const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized. Invalid or missing API key.' 
    })
  }
  
  next()
} 