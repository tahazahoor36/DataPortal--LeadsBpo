import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { serialize } from 'cookie';
import { sb, JWT_SECRET, jsonRes, getSession } from './util.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session) return jsonRes(res, 401, { error: 'Unauthorized' });
    return jsonRes(res, 200, { user: session.username, role: session.role });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', serialize('portal_session', '', {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: -1
    }));
    return jsonRes(res, 200, { success: true });
  }

  if (req.method === 'POST') {
    const { username, password, selectedRole } = req.body;
    if (!username || !password || !selectedRole) {
      return jsonRes(res, 400, { error: 'Missing credentials' });
    }

    try {
      // Find matching user based on role
      // If employee, check all roles starting with employee. If boss, check 'boss'.
      const roleFilter = selectedRole === 'boss' ? 'boss' : 'employee';
      
      const { data: users, error } = await sb.from('credentials').select('*');
      if (error) throw error;
      
      let matchedUser = null;
      
      for (const u of users) {
        if (selectedRole === 'boss' && u.role !== 'boss') continue;
        if (selectedRole === 'employee' && !u.role.startsWith('employee')) continue;
        
        if (u.username === username) {
          // Check password. Support legacy plain text or bcrypt.
          let isMatch = false;
          if (u.password.startsWith('$2a$') || u.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, u.password);
          } else {
            isMatch = (password === u.password);
            // Optionally, automatically upgrade plain text password to bcrypt here
            if (isMatch) {
               const hashed = await bcrypt.hash(password, 10);
               await sb.from('credentials').update({ password: hashed }).eq('role', u.role);
            }
          }
          
          if (isMatch) {
            matchedUser = u;
            break;
          }
        }
      }

      if (!matchedUser) {
        return jsonRes(res, 401, { error: 'Invalid credentials' });
      }

      // Generate JWT
      const token = jwt.sign({ 
        role: matchedUser.role,
        username: matchedUser.username,
        type: selectedRole // 'boss' or 'employee'
      }, JWT_SECRET, { expiresIn: '12h' });

      // Set cookie
      res.setHeader('Set-Cookie', serialize('portal_session', token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 12 * 60 * 60
      }));

      return jsonRes(res, 200, { success: true, role: selectedRole });
    } catch (ex) {
      return jsonRes(res, 500, { error: 'Server error' });
    }
  }

  return jsonRes(res, 405, { error: 'Method not allowed' });
}
