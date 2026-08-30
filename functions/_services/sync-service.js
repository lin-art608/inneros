// Application Service：同步编排（ARCH-008 / ARCH-008.1）
// 依赖注入：memoryRepository / operationRepository / deviceRepository / domain。
// 禁止：DOM、Cookie、Cloudflare Request、SQL、直接 fetch 第三方（方案第七节）。
// 承载的真实业务（不是 repository 的机械包装）：
//   1) 操作合法性校验（domain.validateOperation）
//   2) op_id 幂等（同一操作重放只生效一次）
//   3) applyOperation 分发（按 kind 落到 MemoryRepository 的写入语义）
//   4) 一致性边界：可批量语句的 kind 走 db.batch 与 record 同事务提交；
//      其余走"先 apply 后 record + 幂等重试"（见 BATCHABLE_KINDS 注释）
//   5) 游标推进 + pull 增量回放（排除来源设备）
// 不变的协议：op_id 幂等 / seq 单调 / cursor 增量 / 排除本机 /
//           upsert 新者胜（败方进 _conflicts）/ 删除墓碑优先（旧快照不复活）/ append 幂等。

import { ErrorCode, ServiceError } from '../_infra/errors.js';

const MAX_OPS_PER_PUSH = 200;
const MAX_OPS_PER_PULL = 500;

// 可原子提交的 kind：其业务写入都能表达为"纯 SQL 语句"（无需先读后写）。
// 这些 kind 由 MemoryRepository 把语句收集进 collect 数组，连同 operation 记录一起
// 交给 OperationRepository 用 db.batch() 提交——D1 batch 是事务，保证 apply + record 同生同灭。
// upsert_memory 需要先读现有行做冲突判定（新者胜 + 败方保留），无法纯语句化，
// 因此走顺序执行：即使中途失败，重放时 op_id 未记录 → 客户端重试 → 写入语义本身幂等，不会重复生效。
const BATCHABLE_KINDS = new Set(['append_entry', 'update_entry', 'delete_entry', 'delete_memory', 'upsert_attachment']);

export function createSyncService({ memoryRepository, operationRepository, deviceRepository, domain = {} }) {
  const nowIso = () => new Date().toISOString();
  const validateOperation = domain.validateOperation;

  return {
    // 用例：本机操作批量上报 → 幂等应用 → 推进游标
    async push({ userId, deviceId, deviceName = '', operations = [] }) {
      // 业务输入错误统一走 ServiceError + 稳定 code（ARCH-008.1 3.2）：
      // 路由层负责把它映射成旧协议的 { error } 结构，客户端不依赖中文 message。
      if (!deviceId) throw new ServiceError(ErrorCode.VALIDATION_ERROR, '缺少 device_id', { status: 400 });
      const ops = [...operations].slice(0, MAX_OPS_PER_PUSH);
      if (ops.length === 0) throw new ServiceError(ErrorCode.VALIDATION_ERROR, 'operations 为空', { status: 400 });

      await deviceRepository.ensureDevice({ deviceId, userId, name: deviceName });

      let applied = 0, skipped = 0;
      const errors = [];
      for (const op of ops) {
        const opId = String(op.op_id || '');
        const kind = String(op.kind || '');
        const entityId = String(op.entity_id || '');
        const createdAt = String(op.created_at || nowIso());
        if (!opId || !kind) {
          errors.push({ op_id: opId, code: ErrorCode.VALIDATION_ERROR, error: '缺少 op_id/kind' });
          continue;
        }
        // 领域校验：未知 kind / 缺 entity_id 只让该条失败，不影响整批（与既有行为一致）
        if (validateOperation) {
          const v = validateOperation({ ...op, op_id: opId, kind, entity_id: entityId });
          if (!v.ok) {
            errors.push({ op_id: opId, code: ErrorCode.VALIDATION_ERROR, error: v.errors[0] });
            continue;
          }
        }
        // 一致性边界：可批量的 kind 先收集语句，最后与 record 同事务提交；否则立即执行
        const collect = BATCHABLE_KINDS.has(kind) ? [] : null;
        try {
          if (await operationRepository.opExists(userId, opId)) { skipped++; continue; }
          await applyOperation(memoryRepository, userId, kind, entityId, op.payload || {}, collect);
          await operationRepository.record({
            opId, userId, deviceId, kind, entityId,
            payload: op.payload || {}, createdAt,
            prepend: collect, // null 或语句数组；数组非空时走 db.batch 原子提交
          });
          applied++;
        } catch (e) {
          // 第三方/内部原始错误不外泄，只保留可定位的简短信息 + 稳定 code
          errors.push({ op_id: opId, code: ErrorCode.OPERATION_FAILED, error: String(e.message || e).slice(0, 200) });
        }
      }

      const lastSeq = await operationRepository.maxSeq(userId);
      await deviceRepository.updateCursor({ userId, deviceId, lastSeq });
      return { applied, skipped, errors, lastSeq };
    },

    // 用例：增量回放 → 返回 seq > cursor 且非本机的操作
    async pull({ userId, cursor = 0, deviceId = '', deviceName = '' }) {
      const from = Math.max(0, parseInt(cursor, 10) || 0);
      if (deviceId) await deviceRepository.ensureDevice({ deviceId, userId, name: deviceName });
      const ops = await operationRepository.listSince({
        userId, cursor: from, excludeDeviceId: deviceId, limit: MAX_OPS_PER_PULL,
      });
      const lastSeq = await operationRepository.maxSeq(userId);
      return { ops, lastSeq, hasMore: ops.length === MAX_OPS_PER_PULL };
    },
  };
}

// 单个操作的落地分发：冲突/墓碑/幂等的具体规则仍在 MemoryRepository（ARCH-005），
// 此处只做 kind → repository 写入语义的映射（此前这段逻辑在 route 里，业务编排泄漏到了路由层）。
// collect 非空时，repository 只生成语句不执行，交由 SyncService 与 record 一起批量提交。
async function applyOperation(repo, userId, kind, entityId, payload, collect = null) {
  const now = new Date().toISOString();
  switch (kind) {
    case 'upsert_memory':
      await repo.upsertNewer({
        userId,
        id: entityId,
        kind: payload.kind || 'memory',
        data: payload.data || {},
        updatedAt: String(payload.updated_at || now),
        deleted: !!payload.deleted,
      });
      return;
    case 'append_entry': {
      const entry = payload.entry || {};
      const memoryId = String(payload.memory_id || entityId);
      if (!entry.id || !memoryId) throw new Error('append_entry 缺少 entry.id/memory_id');
      await repo.appendEntry({
        userId,
        memoryId,
        entry: { id: entry.id, content: entry.content || '', photo_ids: entry.photo_ids || [], created_at: entry.created_at || now },
        collect,
      });
      return;
    }
    case 'delete_memory':
      // 墓碑优先：repository 侧以 updated_at <= 为条件，旧快照不能复活已删除记录
      await repo.tombstone({ userId, id: entityId, updatedAt: String(payload.updated_at || now), collect });
      return;
    case 'delete_entry':
      await repo.deleteEntry({ userId, entryId: entityId, collect });
      return;
    case 'update_entry': {
      const entry = (payload || {}).entry || {};
      if (!entry.id) throw new Error('update_entry 缺少 entry.id');
      await repo.updateEntryContent({ userId, entryId: entry.id, content: entry.content || '', collect });
      return;
    }
    case 'upsert_attachment': {
      // ARCH-008.1：payload 字段与 app.js enqueueAttachments() 一致（memory_id/bytes/hash/mime/data/created_at）
      const p = payload || {};
      if (!String(p.memory_id || '')) throw new Error('upsert_attachment 缺少 memory_id');
      await repo.upsertAttachment({
        userId,
        id: entityId,
        memoryId: String(p.memory_id || ''),
        bytes: p.bytes || 0,
        hash: p.hash || '',
        mime: p.mime || '',
        data: String(p.data || ''),
        createdAt: p.created_at || now,
        collect,
      });
      return;
    }
    default:
      throw new Error('未知操作类型 ' + kind);
  }
}
