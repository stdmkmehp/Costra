// pg-mem spike · 验证 SMALLINT[] / INTEGER[] + cardinality CHECK 支持
// 用法：cd server && npx tsx test/spike-pgmem-arrays.ts

import { newDb } from 'pg-mem';

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const client = await pool.connect();

  const results: Record<string, string> = {};

  // Test 1: SMALLINT[] 列基础支持
  try {
    await client.query(`
      CREATE TABLE test_arr (
        id UUID PRIMARY KEY,
        arr SMALLINT[]
      );
    `);
    await client.query(`INSERT INTO test_arr (id, arr) VALUES ('11111111-1111-1111-1111-111111111111', ARRAY[1,3,5]::SMALLINT[]);`);
    const r = await client.query(`SELECT arr FROM test_arr;`);
    results['1_smallint_array_insert_select'] =
      Array.isArray(r.rows[0]?.arr) ? `OK: got ${JSON.stringify(r.rows[0].arr)}` : `FAIL: ${JSON.stringify(r.rows[0])}`;
  } catch (e) {
    results['1_smallint_array_insert_select'] = `FAIL: ${(e as Error).message}`;
  }

  // Test 2: INTEGER[] 列
  try {
    await client.query(`
      CREATE TABLE test_arr2 (
        id UUID PRIMARY KEY,
        arr INTEGER[]
      );
    `);
    await client.query(`INSERT INTO test_arr2 (id, arr) VALUES ('22222222-2222-2222-2222-222222222222', ARRAY[101,214,1225]);`);
    const r = await client.query(`SELECT arr FROM test_arr2;`);
    results['2_integer_array_insert_select'] =
      Array.isArray(r.rows[0]?.arr) ? `OK: got ${JSON.stringify(r.rows[0].arr)}` : `FAIL: ${JSON.stringify(r.rows[0])}`;
  } catch (e) {
    results['2_integer_array_insert_select'] = `FAIL: ${(e as Error).message}`;
  }

  // Test 3: cardinality() 函数
  try {
    const r = await client.query(`SELECT cardinality(ARRAY[1,2,3]::SMALLINT[]) AS c;`);
    results['3_cardinality_function'] = `RESULT: ${r.rows[0]?.c}`;
  } catch (e) {
    results['3_cardinality_function'] = `FAIL: ${(e as Error).message}`;
  }

  // Test 4: CHECK 使用 cardinality
  try {
    await client.query(`
      CREATE TABLE test_check (
        id UUID PRIMARY KEY,
        arr SMALLINT[],
        CONSTRAINT chk_len CHECK (arr IS NULL OR cardinality(arr) BETWEEN 1 AND 7)
      );
    `);
    // 合法
    await client.query(`INSERT INTO test_check (id, arr) VALUES ('33333333-3333-3333-3333-333333333333', ARRAY[1,2,3]::SMALLINT[]);`);
    // 非法（应触发 CHECK 违反）
    try {
      await client.query(`INSERT INTO test_check (id, arr) VALUES ('44444444-4444-4444-4444-444444444444', ARRAY[1,2,3,4,5,6,7,8]::SMALLINT[]);`);
      results['4_check_cardinality'] = `PARTIAL: legal INSERT succeeded, illegal INSERT also succeeded (CHECK not enforced)`;
    } catch (e) {
      results['4_check_cardinality'] = `OK: illegal INSERT rejected (${(e as Error).message})`;
    }
  } catch (e) {
    results['4_check_cardinality'] = `FAIL creating table: ${(e as Error).message}`;
  }

  // Test 5: TEXT + CHECK 替代 ENUM
  try {
    await client.query(`
      CREATE TABLE test_enum (
        id UUID PRIMARY KEY,
        period TEXT NOT NULL CHECK (period IN ('weekly','biweekly','monthly','bimonthly','trimonthly','yearly'))
      );
    `);
    await client.query(`INSERT INTO test_enum (id, period) VALUES ('55555555-5555-5555-5555-555555555555', 'weekly');`);
    try {
      await client.query(`INSERT INTO test_enum (id, period) VALUES ('66666666-6666-6666-6666-666666666666', 'invalid');`);
      results['5_text_check_enum'] = `PARTIAL: illegal value also inserted (CHECK not enforced)`;
    } catch (e) {
      results['5_text_check_enum'] = `OK: illegal value rejected`;
    }
  } catch (e) {
    results['5_text_check_enum'] = `FAIL: ${(e as Error).message}`;
  }

  // Test 6: pg_try_advisory_lock (should FAIL as expected)
  try {
    await client.query(`SELECT pg_try_advisory_lock(12345)`);
    results['6_advisory_lock'] = `UNEXPECTED_OK: pg_try_advisory_lock exists in pg-mem`;
  } catch (e) {
    results['6_advisory_lock'] = `EXPECTED_FAIL: ${(e as Error).message}`;
  }

  // Test 7: unnest(arr)
  try {
    const r = await client.query(`SELECT unnest(ARRAY[10,20,30]::SMALLINT[]) AS v ORDER BY v;`);
    results['7_unnest'] = `OK: ${r.rows.map((x: { v: number }) => x.v).join(',')}`;
  } catch (e) {
    results['7_unnest'] = `FAIL: ${(e as Error).message}`;
  }

  client.release();
  await pool.end();

  console.log('\n========== pg-mem Array/CHECK Spike Results ==========\n');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k.padEnd(35)} : ${v}`);
  }
  console.log('\n=======================================================\n');
}

void main().catch((e) => {
  console.error('spike crashed:', e);
  process.exit(1);
});
