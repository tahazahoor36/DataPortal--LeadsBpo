import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { parse } from 'cookie';

const SURL = process.env.SUPABASE_URL || 'https://lxngupkvguopupyzwwoi.supabase.co';
const SKEY = process.env.SUPABASE_SERVICE_KEY;

// Create Supabase client using Service Role Key to bypass RLS in the backend
export const sb = createClient(SURL, SKEY || '');

// Warn loudly in server logs if JWT_SECRET is missing, but do NOT throw at
// module level — a module-level throw crashes the entire serverless function
// before any try/catch can respond with proper JSON, causing raw-text 500s.
if (!process.env.JWT_SECRET) {
  console.error(
    '[util] WARNING: JWT_SECRET environment variable is not set. ' +
    'Authentication will fail. Set this variable in your deployment environment.'
  );
}

export const JWT_SECRET = process.env.JWT_SECRET;

export function getSession(req) {
  try {
    const cookies = parse(req.headers.cookie || '');
    const token = cookies.portal_session;
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (e) {
    return null;
  }
}

export function jsonRes(res, status, data) {
  res.status(status).json(data);
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-IP, sliding fixed-window)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map(); // ip -> { count, windowStart }

/**
 * Returns true (and increments the counter) when the IP is within the limit.
 * Returns false when the IP has exceeded the limit for the current window.
 *
 * @param {string} ip         - Client IP address
 * @param {number} maxAttempts - Maximum allowed attempts per window (default 3)
 * @param {number} windowMs   - Window duration in milliseconds (default 60 000)
 */
export function checkRateLimit(ip, maxAttempts = 3, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart >= windowMs) {
    // First request or window has expired — start a fresh window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true; // allowed
  }

  if (entry.count >= maxAttempts) {
    return false; // blocked
  }

  entry.count += 1;
  return true; // allowed
}
