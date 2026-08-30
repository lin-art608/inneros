// /api/sync/[action] —— push（本机操作批量上报）| pull（增量回放）
// ARCH-008：路由只负责 auth / parse / service / response，同步编排已收口到 _services/sync-service.js。
// 响应形状与旧协议**完全兼容**（push: ok/applied/skipped/errors/last_seq；pull: ok/ops/last_seq/has_more）。
// 操作日志协议：每笔本地改动是一个 operation，op_id 全局唯一 → 幂等；
// 服务端按 seq 单调编号，各设备用 last_seq 游标增量拉取其他设备的操作。
// 冲突规则：追加条目永不冲突；元数据新者胜但败方数据保留进 _conflicts 并标 conflict=1；
//          删除墓碑优先（updated_at <= 才生效），删除不会被旧快照复活。

import { ensureSchema, json, requireUser } from '../../_lib.js';
import { createMemoryRepository } from '../../_repositories/memory-repository.js';
import { createOperationRepository } from '../../_repositories/operation-repository.js';
import { createDeviceRepository } from '../../_repositories/device-repository.js';
import { createSyncService } from '../../_services/sync-service.js';
import * as domain from '../../_domain/memory.js';

function buildSyncService(db) {
  return createSyncService({
    memoryRepository: createMemoryRepository(db),
    operationRepository: createOperationRepository(db),
    deviceRepository: createDeviceRepository(db),
    domain,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定' }, 500);
  const user = await requireUser(db, request);
  if (!user) return json({ error: '未登录或会话过期' }, 401);
  await ensureSchema(db);

  const action = context.params.action;
  if (action !== 'push') return json({ error: 'unknown action' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const deviceId = String(body.device_id || '');
  const deviceName = String(body.device_name || '');
  const operations = Array.isArray(body.operations) ? body.operations : [];

  try {
    const result = await buildSyncService(db).push({ userId: user.id, deviceId, deviceName, operations });
    return json({
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
      errors: result.errors,
      last_seq: result.lastSeq,
    });
  } catch (e) {
    // 请求级业务错误：SyncService 抛 ServiceError（稳定 code + status），
    // 这里映射回旧协议的 { error: 中文提示 } 形状——响应形状不变，code 只进服务端日志。
    const status = e && e.status ? e.status : 400;
    console.log('[sync] push rejected:', (e && e.code) || 'UNKNOWN');
    return json({ error: String((e && e.message) || e) }, status);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 数据库未绑定' }, 500);
  const user = await requireUser(db, request);
  if (!user) return json({ error: '未登录或会话过期' }, 401);
  await ensureSchema(db);

  const action = context.params.action;
  if (action !== 'pull') return json({ error: 'unknown action' }, 404);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || '0';
  const deviceId = url.searchParams.get('device_id') || '';
  const deviceName = url.searchParams.get('device_name') || '';

  const result = await buildSyncService(db).pull({ userId: user.id, cursor, deviceId, deviceName });
  return json({ ok: true, ops: result.ops, last_seq: result.lastSeq, has_more: result.hasMore });
}
