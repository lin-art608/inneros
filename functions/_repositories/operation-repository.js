// Operation Repository（ARCH-008）——操作日志的 D1 访问集中层
// 规则：只做数据访问（CRUD/查询）；同步编排在 _services/sync-service.js。
// 从 memory-repository 迁出：此前同步职责混在 MemoryRepository 里（v1.9 文档第二节问题 1）。
// 保持不变的协议约束：
//   - op_id 全局唯一（幂等判据）
//   - seq 单调递增（pull 的游标源）
//   - payload 以 JSON 字符串存储，读出时解析为对象

export function createOperationRepository(db) {
  return {
    // 幂等判据：同一 op_id 是否已应用过
    async opExists(userId, opId) {
      const r = await db.prepare('SELECT 1 FROM operations WHERE op_id = ? AND user_id = ?')
        .bind(opId, userId).first();
      return !!r;
    },

    // 记录已应用的操作（seq 由 D1 AUTOINCREMENT 生成）
    async record({ opId, userId, deviceId, kind, entityId, payload, createdAt }) {
      await db.prepare(
        'INSERT INTO operations(op_id, user_id, device_id, kind, entity_id, payload, created_at) VALUES(?,?,?,?,?,?,?)'
      ).bind(opId, userId, deviceId, kind, entityId || '', JSON.stringify(payload || {}), createdAt).run();
    },

    // 增量回放：seq > cursor，可排除来源设备（避免把操作原样回给发送方）
    async listSince({ userId, cursor = 0, excludeDeviceId = '', limit = 500 }) {
      const r = excludeDeviceId
        ? await db.prepare(
            'SELECT seq, op_id, device_id, kind, entity_id, payload, created_at FROM operations WHERE user_id = ? AND seq > ? AND device_id != ? ORDER BY seq LIMIT ?'
          ).bind(userId, cursor, excludeDeviceId, limit).all()
        : await db.prepare(
            'SELECT seq, op_id, device_id, kind, entity_id, payload, created_at FROM operations WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?'
          ).bind(userId, cursor, limit).all();
      return r.results.map(o => ({ ...o, payload: safeParse(o.payload) }));
    },

    // 当前最大 seq（cursor 上界）
    async maxSeq(userId) {
      const r = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM operations WHERE user_id = ?')
        .bind(userId).first();
      return r ? r.m : 0;
    },
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
