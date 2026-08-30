// Device Repository（ARCH-008）——设备（游标）的 D1 访问集中层
// 规则：只做数据访问；同步编排在 _services/sync-service.js。
// 从 memory-repository / sync 路由迁出：设备注册与游标推进此前散落在 route 与 MemoryRepository。
// 保持不变的协议约束：devices.last_seq 是该设备已消费的操作位点（pull 的起点）。

export function createDeviceRepository(db) {
  return {
    // 注册设备（已存在则忽略），name 截断避免异常上报撑爆字段
    async ensureDevice({ deviceId, userId, name = '' }) {
      await db.prepare(
        'INSERT OR IGNORE INTO devices(id, user_id, name, last_seq, created_at) VALUES(?,?,?,0,?)'
      ).bind(deviceId, userId, String(name || '').slice(0, 60), new Date().toISOString()).run();
    },

    async getCursor(userId, deviceId) {
      const r = await db.prepare('SELECT last_seq FROM devices WHERE id = ? AND user_id = ?')
        .bind(deviceId, userId).first();
      return r ? r.last_seq : 0;
    },

    // 推进游标。lastSeq 由 SyncService 从 OperationRepository.maxSeq 取得后传入：
    // 数值与原实现（子查询 MAX(seq)）一致，但让 Service 可脱离 D1 单测。
    async updateCursor({ userId, deviceId, lastSeq }) {
      await db.prepare('UPDATE devices SET last_seq = ? WHERE id = ? AND user_id = ?')
        .bind(lastSeq, deviceId, userId).run();
    },
  };
}
