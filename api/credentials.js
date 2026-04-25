import bcrypt from 'bcryptjs';
import { sb, jsonRes, getSession } from './util.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session || session.type !== 'boss') {
    return jsonRes(res, 403, { error: 'Forbidden' });
  }

  if (req.method === 'GET') {
    const { data, error } = await sb.from('credentials').select('role, username');
    if (error) return jsonRes(res, 500, { error: error.message });
    return jsonRes(res, 200, data);
  }

  if (req.method === 'POST') {
    const { username, password } = req.body;
    const newRole = 'employee_' + Date.now();
    const hashed = await bcrypt.hash(password || '1234', 10);
    
    const { error } = await sb.from('credentials').insert({
      role: newRole,
      username: username || 'NewEmployee',
      password: hashed
    });
    if (error) return jsonRes(res, 500, { error: error.message });
    return jsonRes(res, 200, { success: true });
  }

  if (req.method === 'PUT') {
    const { targetRole, username, password } = req.body;
    if (!targetRole) return jsonRes(res, 400, { error: 'Role required' });
    
    const updates = {};
    if (username) updates.username = username;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }
    
    const { error } = await sb.from('credentials').update(updates).eq('role', targetRole);
    if (error) return jsonRes(res, 500, { error: error.message });
    return jsonRes(res, 200, { success: true });
  }

  if (req.method === 'DELETE') {
    const { targetRole } = req.body;
    if (!targetRole || targetRole === 'boss') return jsonRes(res, 400, { error: 'Invalid role' });
    
    const { error } = await sb.from('credentials').delete().eq('role', targetRole);
    if (error) return jsonRes(res, 500, { error: error.message });
    return jsonRes(res, 200, { success: true });
  }

  return jsonRes(res, 405, { error: 'Method not allowed' });
}
