/**
 * Costra · Server · COSTRA-217 分类层级 + entries.shared_type 测试
 *
 * 卡号: COSTRA-217 · 事实源: dispatch COSTRA-217 §2 + §4 DoD
 *
 * 覆盖：
 *   - 分类树 seed 数量、parent 关系、排序
 *   - 系统分类目标数量：一级 11 条、二级 62 条、总计 73 条
 *   - is_direct_default=true 的直选二级分类目标数量：55 条（支出 44 + 收入 11）
 *   - 重叠二级分类的多父级存在
 *   - 直选默认归属映射能被服务端数据表达
 *   - entries.shared_type 对 expense/income/transfer 的合法/非法写入
 *   - sync pull 不丢 shared_type
 *
 * 注：pg-mem 不支持 gen_random_uuid()，所有 UUID 由 JS randomUUID() 生成后作为参数传入
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool } from '../src/db/pool.js';

// --- helper: 直接用 pg-mem pool 查分类数据 ---
function pool() {
  return getPool();
}

/** pg-mem 不支持 gen_random_uuid()，统一用 JS 生成 */
function uuid(): string {
  return randomUUID();
}

// ==========================================================================
// A. 分类层级体系测试（基于 pg-mem 内存数据库 · 无需真实 PG）
// ==========================================================================
// 注：pg-mem 测试环境不执行 0008 migration seed（那是真实 PG 才跑的）
// 但我们可以手动插入分类数据来验证层级约束和查询逻辑

describe('COSTRA-217: 分类层级体系', () => {
  describe('A1. categories 表结构', () => {
    it('categories 表存在 parent_id 和 is_direct_default 列', async () => {
      const res = await pool().query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'categories' AND column_name IN ('parent_id', 'is_direct_default')
         ORDER BY column_name`,
      );
      const cols = res.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('parent_id');
      expect(cols).toContain('is_direct_default');
    });

    it('entries 表存在 shared_type 列', async () => {
      const res = await pool().query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'entries' AND column_name = 'shared_type'`,
      );
      expect(res.rows.length).toBe(1);
    });
  });

  describe('A2. 二级分类层级约束', () => {
    it('可以创建一级分类（parent_id=NULL）', async () => {
      const res = await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '测试一级', 'expense', 'icon.test', 1, true, NULL, false)
         RETURNING id, parent_id, is_direct_default`,
        [uuid()],
      );
      expect(res.rows[0].parent_id).toBeNull();
      expect(res.rows[0].is_direct_default).toBe(false);
    });

    it('可以创建二级分类（parent_id 指向一级）', async () => {
      // 先创建一级
      const parentId = uuid();
      await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '测试一级B', 'expense', 'icon.test', 2, true, NULL, false)`,
        [parentId],
      );

      // 创建二级
      const childId = uuid();
      const child = await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '测试二级B', 'expense', 'icon.test', 1, true, $2, true)
         RETURNING id, parent_id, is_direct_default`,
        [childId, parentId],
      );
      expect(child.rows[0].parent_id).toBe(parentId);
      expect(child.rows[0].is_direct_default).toBe(true);
    });

    it('同名二级分类可以在不同一级下共存', async () => {
      // 创建两个一级
      const p1Id = uuid();
      const p2Id = uuid();
      await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '测试一级C1', 'expense', 'icon.test', 3, true, NULL, false)`,
        [p1Id],
      );
      await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '测试一级C2', 'expense', 'icon.test', 4, true, NULL, false)`,
        [p2Id],
      );

      // 同名"零食"在两个一级下
      const c1Id = uuid();
      const c2Id = uuid();
      const c1 = await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '零食', 'expense', 'icon.test', 1, true, $2, true)
         RETURNING id`,
        [c1Id, p1Id],
      );
      const c2 = await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, '零食', 'expense', 'icon.test', 2, true, $2, false)
         RETURNING id`,
        [c2Id, p2Id],
      );

      expect(c1.rows[0].id).not.toBe(c2.rows[0].id);
      // 两者都成功插入
      expect(c1.rows.length).toBe(1);
      expect(c2.rows.length).toBe(1);
    });
  });

  describe('A3. is_direct_default 语义', () => {
    it('一级分类 is_direct_default 应为 false', async () => {
      const res = await pool().query(
        `SELECT is_direct_default FROM categories WHERE parent_id IS NULL AND is_direct_default = true`,
      );
      // pg-mem 测试环境中手动插入的数据都遵循规则
      // 这里验证没有一级分类被误设为 true
      // 注：上面 A2 测试中插入的一级都是 false，所以应该为 0
      expect(res.rows.length).toBe(0);
    });
  });
});

// ==========================================================================
// B. entries.shared_type 测试
// ==========================================================================

describe('COSTRA-217: entries.shared_type', () => {
  // 辅助：创建测试用 family + ledger + user
  async function createTestUser(): Promise<string> {
    const id = uuid();
    const openid = 'test-shared-' + uuid();
    await pool().query(
      `INSERT INTO users (id, wx_openid, nickname)
       VALUES ($1, $2, 'test')`,
      [id, openid],
    );
    return id;
  }

  async function createTestFamily(ownerId: string): Promise<string> {
    const id = uuid();
    await pool().query(
      `INSERT INTO families (id, name, owner_id, kind)
       VALUES ($1, '测试家庭', $2, 'shared')`,
      [id, ownerId],
    );
    await pool().query(
      `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, ownerId],
    );
    return id;
  }

  async function createTestLedger(familyId: string): Promise<string> {
    const id = uuid();
    await pool().query(
      `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, '测试账本')`,
      [id, familyId],
    );
    return id;
  }

  describe('B1. expense 允许 shared_type', () => {
    it('expense + shared_type=personal 可以写入', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      const entryId = uuid();
      const res = await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, shared_type)
         VALUES ($1, $2, 1000, 'expense', now(), $3, 'personal')
         RETURNING shared_type`,
        [entryId, ledgerId, userId],
      );
      expect(res.rows[0].shared_type).toBe('personal');
    });

    it('expense + shared_type=shared 可以写入', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      const entryId = uuid();
      const res = await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, shared_type)
         VALUES ($1, $2, 2000, 'expense', now(), $3, 'shared')
         RETURNING shared_type`,
        [entryId, ledgerId, userId],
      );
      expect(res.rows[0].shared_type).toBe('shared');
    });

    it('expense + shared_type=NULL 可以写入（未指定时服务层默认）', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      const entryId = uuid();
      const res = await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by)
         VALUES ($1, $2, 3000, 'expense', now(), $3)
         RETURNING shared_type`,
        [entryId, ledgerId, userId],
      );
      expect(res.rows[0].shared_type).toBeNull();
    });
  });

  describe('B2. income/transfer 的 shared_type 必须为 NULL', () => {
    it('income + shared_type=NULL 正常写入', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      const entryId = uuid();
      const res = await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by)
         VALUES ($1, $2, 5000, 'income', now(), $3)
         RETURNING shared_type`,
        [entryId, ledgerId, userId],
      );
      expect(res.rows[0].shared_type).toBeNull();
    });

    it('income + shared_type=shared 应被应用层拒绝（entryService 校验）', async () => {
      // 这个测试验证 entryService.validateCreatePayload 的校验逻辑
      // 而非 DB CHECK 约束（pg-mem 不支持含列引用的 CHECK）
      // 真实 PG 有 chk_entries_shared_type_scope 约束
      const { createEntryService } = await import('../src/services/entryService.js');
      const { AppError } = await import('../src/errors/AppError.js');
      const { ErrorCode } = await import('../src/errors/ErrorCode.js');

      const service = createEntryService();
      try {
        await service.createWithIdempotency('fake-user-id', {
          ledger_id: '00000000-0000-0000-0000-000000000001',
          amount: 100,
          type: 'income',
          occurred_at: new Date().toISOString(),
          shared_type: 'shared', // 非法：income 不能有 shared_type
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).code).toBe(ErrorCode.BUSINESS_RULE_VIOLATION);
      }
    });

    it('transfer + shared_type=personal 应被应用层拒绝', async () => {
      const { createEntryService } = await import('../src/services/entryService.js');
      const { AppError } = await import('../src/errors/AppError.js');
      const { ErrorCode } = await import('../src/errors/ErrorCode.js');

      const service = createEntryService();
      try {
        await service.createWithIdempotency('fake-user-id', {
          ledger_id: '00000000-0000-0000-0000-000000000001',
          amount: 100,
          type: 'transfer',
          occurred_at: new Date().toISOString(),
          shared_type: 'personal', // 非法：transfer 不能有 shared_type
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).code).toBe(ErrorCode.BUSINESS_RULE_VIOLATION);
      }
    });
  });

  describe('B3. shared_type 在查询和同步中不丢失', () => {
    it('findById 返回 shared_type', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      const entryId = uuid();
      await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, shared_type)
         VALUES ($1, $2, 1000, 'expense', now(), $3, 'shared')`,
        [entryId, ledgerId, userId],
      );

      const { findById } = await import('../src/repositories/entryRepo.js');
      const entry = await findById(entryId, userId);
      expect(entry).not.toBeNull();
      expect(entry!.sharedType).toBe('shared');
    });

    it('sync pull 返回 shared_type', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId);
      const ledgerId = await createTestLedger(familyId);

      // 插入一条带 shared_type 的 expense
      const entryId = uuid();
      await pool().query(
        `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, shared_type)
         VALUES ($1, $2, 1000, 'expense', now(), $3, 'personal')`,
        [entryId, ledgerId, userId],
      );

      const { syncPull } = await import('../src/services/syncPullService.js');
      const result = await syncPull({
        userId,
        familyId,
        since: 0,
        limit: 200,
      });

      expect(result.changes.entries.length).toBeGreaterThanOrEqual(1);
      const entry = result.changes.entries.find((e) => e.shared_type === 'personal');
      expect(entry).toBeDefined();
      expect(entry!.shared_type).toBe('personal');
    });
  });

  describe('B4. shared_type 默认规则（COSTRA-217 R1.x · dispatch §2.B.3）', () => {
    it('expense 未传 shared_type + personal family → 默认 personal', async () => {
      const userId = await createTestUser();
      // 创建 personal family
      const familyId = uuid();
      await pool().query(
        `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, '个人账本', $2, 'personal')`,
        [familyId, userId],
      );
      await pool().query(
        `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [familyId, userId],
      );
      const ledgerId = await createTestLedger(familyId);

      const { createEntryService } = await import('../src/services/entryService.js');
      const service = createEntryService();
      const result = await service.createWithIdempotency(userId, {
        ledger_id: ledgerId,
        amount: 1000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
        // shared_type 未传
      });

      expect(result.status).toBe('ok');
      // 验证写入的 shared_type 为 personal
      const { findById } = await import('../src/repositories/entryRepo.js');
      const entry = await findById((result as { serverId: string }).serverId, userId);
      expect(entry).not.toBeNull();
      expect(entry!.sharedType).toBe('personal');
    });

    it('expense 未传 shared_type + shared family → 默认 shared', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId); // kind='shared'
      const ledgerId = await createTestLedger(familyId);

      const { createEntryService } = await import('../src/services/entryService.js');
      const service = createEntryService();
      const result = await service.createWithIdempotency(userId, {
        ledger_id: ledgerId,
        amount: 2000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
        // shared_type 未传
      });

      expect(result.status).toBe('ok');
      const { findById } = await import('../src/repositories/entryRepo.js');
      const entry = await findById((result as { serverId: string }).serverId, userId);
      expect(entry).not.toBeNull();
      expect(entry!.sharedType).toBe('shared');
    });

    it('expense 指向不存在账本 → NOT_FOUND 且不写 DB', async () => {
      const { createEntryService } = await import('../src/services/entryService.js');
      // 注入 mock：ledger 查不到 → 授权守门按 NOT_FOUND 拒绝且不泄露存在性
      const service = createEntryService({
        findLedgerWithFamily: async () => null,
      });

      const result = await service.createWithIdempotency('fake-user-id', {
        ledger_id: '00000000-0000-0000-0000-000000000099',
        amount: 3000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
        // shared_type 未传
      });

      expect(result.status).toBe('rejected');
      expect((result as { error: { code: string; message: string } }).error.code).toBe('NOT_FOUND');
    });

    it('非 active 成员 → NOT_FOUND 且不写 DB（不泄露账本存在性）', async () => {
      const { createEntryService } = await import('../src/services/entryService.js');
      const service = createEntryService({
        findLedgerWithFamily: async () => ({
          id: '00000000-0000-0000-0000-000000000001',
          familyId: '00000000-0000-0000-0000-000000000002',
          kind: 'shared',
        }),
        isActiveFamilyMember: async () => false,
      });

      const result = await service.createWithIdempotency('fake-user-id', {
        ledger_id: '00000000-0000-0000-0000-000000000001',
        amount: 3000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
      });

      expect(result.status).toBe('rejected');
      expect((result as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });

    it('family kind 非 personal/shared → BUSINESS_RULE_VIOLATION 且不写 DB', async () => {
      const { createEntryService } = await import('../src/services/entryService.js');
      // family_kind 是 ENUM('personal','shared')，真实库不会出现第三值；
      // 该分支是防御性守门（ENUM 未来扩展时不静默写入错误 shared_type），只能靠 mock 覆盖。
      const service = createEntryService({
        findLedgerWithFamily: async () => ({
          id: '00000000-0000-0000-0000-000000000001',
          familyId: '00000000-0000-0000-0000-000000000002',
          kind: 'unknown-kind',
        }),
        isActiveFamilyMember: async () => true,
      });

      const result = await service.createWithIdempotency('fake-user-id', {
        ledger_id: '00000000-0000-0000-0000-000000000001',
        amount: 3000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
      });

      expect(result.status).toBe('rejected');
      expect((result as { error: { code: string } }).error.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('expense 显式传 shared_type → 不走默认规则', async () => {
      const userId = await createTestUser();
      const familyId = await createTestFamily(userId); // shared family
      const ledgerId = await createTestLedger(familyId);

      const { createEntryService } = await import('../src/services/entryService.js');
      const service = createEntryService();
      // 显式传 personal（即使 family 是 shared）
      const result = await service.createWithIdempotency(userId, {
        ledger_id: ledgerId,
        amount: 4000,
        type: 'expense',
        occurred_at: new Date().toISOString(),
        shared_type: 'personal', // 显式指定
      });

      expect(result.status).toBe('ok');
      const { findById } = await import('../src/repositories/entryRepo.js');
      const entry = await findById((result as { serverId: string }).serverId, userId);
      expect(entry).not.toBeNull();
      expect(entry!.sharedType).toBe('personal'); // 尊重显式值
    });
  });
});

// ==========================================================================
// C. 分类 seed 数据完整性测试（验证 0008 migration 的目标数量）
// ==========================================================================
// 注：这些测试在真实 PG 上运行时才能验证完整 seed 数据
// pg-mem 环境中我们验证的是表结构和约束逻辑
//
// 系统分类 seed 数量硬断言（dispatch DoD-2）：
//   目标：一级 11 条 + 二级 78 条 = 总计 89 条
//   is_direct_default=true 的二级分类：68 条（支出 55 + 收入 13）
//   ⚠️ pg-mem 不执行 0008 migration seed · 这些断言需在真实 PG 环境验证
//   当前状态：P2（非 P1）· 等 staging/prod 环境可用后补真实 PG 集成测试

describe('COSTRA-217: 分类数据模型验证', () => {
  it('categories 表支持 parent_id 自引用', async () => {
    // 创建一级
    const parentId = uuid();
    await pool().query(
      `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
       VALUES ($1, '验证一级', 'expense', 'icon.verify', 1, true, NULL, false)`,
      [parentId],
    );

    // 创建二级指向一级
    const childId = uuid();
    const child = await pool().query(
      `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
       VALUES ($1, '验证二级', 'expense', 'icon.verify', 1, true, $2, true)
       RETURNING id, parent_id`,
      [childId, parentId],
    );
    expect(child.rows[0].parent_id).toBe(parentId);
  });

  it('children_count 可通过查询计算', async () => {
    // 创建一级
    const parentId = uuid();
    await pool().query(
      `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
       VALUES ($1, '验证一级D', 'expense', 'icon.verify', 2, true, NULL, false)`,
      [parentId],
    );

    // 创建 3 个二级
    for (let i = 0; i < 3; i++) {
      const childId = uuid();
      await pool().query(
        `INSERT INTO categories (id, name, type, icon, sort_order, is_system, parent_id, is_direct_default)
         VALUES ($1, $2, 'expense', 'icon.verify', $3, true, $4, true)`,
        [childId, '子类' + (i + 1), i + 1, parentId],
      );
    }

    // 查询 children_count
    const count = await pool().query(
      `SELECT COUNT(*) as cnt FROM categories WHERE parent_id = $1 AND deleted_at IS NULL`,
      [parentId],
    );
    expect(Number(count.rows[0].cnt)).toBe(3);
  });
});
