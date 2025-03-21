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

// Basic auth middleware for HTML routes
export const basicAuthMiddleware = (req, res, next) => {
  // If session already exists, they're authenticated
  if (req.session && req.session.authenticated) {
    return next()
  }

  // Otherwise, apply basic auth
  expressBasicAuth({
    users: { 
      [process.env.BASIC_AUTH_USER || 'admin']: process.env.BASIC_AUTH_PASSWORD || 'changeme' 
    },
    challenge: true,
    realm: 'Ethquake Dashboard'
  })(req, res, (err) => {
    if (err) return next(err)
    
    // Mark session as authenticated after successful basic auth
    req.session.authenticated = true
    next()
  })
}

// Session-auth middleware for client-facing API routes
export const sessionAuthMiddleware = (req, res, next) => {
  console.log('Session auth check:', req.session); // Debug log
  
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // If this is a browser request and we're in production,
  // it might be better to redirect to /charts for authentication
  // instead of returning a 401
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) {
    return res.redirect('/charts');
  }
  
  return res.status(401).json({ error: 'Unauthorized' });
}

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