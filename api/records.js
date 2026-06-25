import { sb, jsonRes, getSession } from './util.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return jsonRes(res, 401, { error: 'Unauthorized' });

  const { action } = req.query;

  try {
    if (req.method === 'GET') {
      if (action === 'columns') {
        const { data } = await sb.from('columns_meta').select('value').eq('key', 'columns').maybeSingle();
        let cols = [], headings = [];
        if (data && data.value) {
           const v = data.value;
           if (Array.isArray(v)) cols = v;
           else if (typeof v === 'object' && Array.isArray(v.cols)) { cols = v.cols; headings = v.headings || []; }
        }
        return jsonRes(res, 200, { cols, headings });
      }
      
      if (action === 'count') {
        const q = req.query.q || '';
        const { data, error } = await sb.rpc('count_records', { search_term: q });
        if (error) throw error;
        return jsonRes(res, 200, { count: Number(data) || 0 });
      }

      if (action === 'page') {
        const q = req.query.q || '';
        const size = parseInt(req.query.size) || 50;
        const page = parseInt(req.query.page) || 1;
        const s = (page - 1) * size;
        const { data, error } = await sb.rpc('get_records_page', { search_term: q, page_offset: s, page_limit: size });
        if (error) throw error;
        return jsonRes(res, 200, data || []);
      }

      if (action === 'search') {
        const q = req.query.q || '';
        const limit = parseInt(req.query.limit) || 50;
        const { data, error } = await sb.rpc('search_records', { search_term: q, result_limit: limit });
        if (error) throw error;
        return jsonRes(res, 200, data || []);
      }

      if (action === 'empLeadCount') {
        const { count, error } = await sb
          .from('employee_leads')
          .select('*', { count: 'exact', head: true });
        if (error) throw error;
        return jsonRes(res, 200, { count: count || 0 });
      }
    }

    if (req.method === 'POST') {
      // Employees can only use: search, submitLead
      if (session.type !== 'boss' && action !== 'search' && action !== 'submitLead') {
        return jsonRes(res, 403, { error: 'Read only access' });
      }

      if (action === 'columns') {
        const { error } = await sb.from('columns_meta').upsert({ key: 'columns', value: req.body });
        if (error) throw error;
        return jsonRes(res, 200, { success: true });
      }

      if (action === 'insert') {
        const { rows } = req.body;

        // Server-side enforcement: reject oversized batches
        const MAX_BATCH_SIZE = 500;
        if (!Array.isArray(rows)) {
          return jsonRes(res, 400, { error: 'rows must be an array.' });
        }
        if (rows.length > MAX_BATCH_SIZE) {
          return jsonRes(res, 400, {
            error: `Batch too large. Maximum ${MAX_BATCH_SIZE} rows per request, got ${rows.length}.`
          });
        }

        const records = rows.map(r => ({ data: r }));
        const { error } = await sb.from('records').insert(records);
        if (error) throw error;
        return jsonRes(res, 200, { success: true, inserted: rows.length });
      }


      if (action === 'addOne') {
        const { data, error } = await sb.from('records').insert({ data: req.body }).select('id').single();
        if (error) throw error;
        return jsonRes(res, 200, { id: data.id });
      }

      // Employee lead submission — saved to a SEPARATE table (employee_leads)
      if (action === 'submitLead') {
        const lead = req.body;
        if (!lead || typeof lead !== 'object') {
          return jsonRes(res, 400, { error: 'Invalid lead data.' });
        }
        const { data, error } = await sb
          .from('employee_leads')
          .insert({ data: lead, submitted_by: session.username })
          .select('id')
          .single();
        if (error) throw error;
        return jsonRes(res, 200, { success: true, id: data.id });
      }
    } // end POST

    if (req.method === 'PUT') {
      if (session.type !== 'boss') return jsonRes(res, 403, { error: 'Forbidden' });
      if (action === 'updateOne') {
        const { id, row } = req.body;
        const { error } = await sb.from('records').update({ data: row }).eq('id', id);
        if (error) throw error;
        return jsonRes(res, 200, { success: true });
      }
    }

    if (req.method === 'DELETE') {
      if (session.type !== 'boss') return jsonRes(res, 403, { error: 'Forbidden' });
      if (action === 'deleteOne') {
        const { id } = req.body;
        const { error } = await sb.from('records').delete().eq('id', id);
        if (error) throw error;
        return jsonRes(res, 200, { success: true });
      }
      
      if (action === 'deleteAll') {
        const { error } = await sb.from('records').delete().not('id', 'is', null);
        if (error) throw error;
        await sb.from('columns_meta').delete().eq('key', 'columns');
        return jsonRes(res, 200, { success: true });
      }
    }

    return jsonRes(res, 404, { error: 'Action not found' });
  } catch (e) {
    console.error('[records] Unhandled error:', e);
    return jsonRes(res, 500, { error: 'An unexpected server error occurred.' });
  }
}
