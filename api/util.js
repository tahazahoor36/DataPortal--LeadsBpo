import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { parse } from 'cookie';

const SURL = process.env.SUPABASE_URL || 'https://lxngupkvguopupyzwwoi.supabase.co';
const SKEY = process.env.SUPABASE_SERVICE_KEY;

// Create Supabase client using Service Role Key to bypass RLS in the backend
export const sb = createClient(SURL, SKEY || '');

export const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

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
