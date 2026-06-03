#!/bin/bash
# 临时脚本：将用户 B 加入用户 A 创建的家庭 F
# 用途：绕过微信分享认证限制，直接通过 DB 操作实现邀请加入
# 使用方式：在本地 server 运行环境中执行（连接 localhost postgres）
#
# 前置条件：
#   - 用户 A 已创建家庭 F（A 是 owner）
#   - 用户 B 已注册（有账号）
#   - 本地 postgres 正在运行

USER_A="019e8c3b-9b2e-70ca-b6fe-ecc51a41a5c2"
USER_B="019e8c3c-7d18-75ab-a012-eaecf88b462b"
FAMILY_F="019e8c3d-099b-7969-a9dc-181790ea9b99"

echo "=== 将用户 B 加入家庭 F ==="
echo "  User A (owner): $USER_A"
echo "  User B (加入):  $USER_B"
echo "  Family F:       $FAMILY_F"
echo ""

# 使用 ON CONFLICT 安全插入（如果已存在则重新激活）
SQL="
INSERT INTO family_members (family_id, user_id, role, joined_at)
VALUES ('${FAMILY_F}', '${USER_B}', 'member', now())
ON CONFLICT (family_id, user_id)
DO UPDATE SET left_at = NULL, role = 'member', joined_at = now()
RETURNING family_id, user_id, role, joined_at;
"

echo "执行 SQL:"
echo "$SQL"
echo ""

# 连接本地 postgres（根据 docker-compose 配置调整连接参数）
# 方式 1: 本地直连（如果 postgres 在 host 上）
psql -h localhost -p 5432 -U costra -d costra -c "$SQL"

# 方式 2: 通过 docker exec（推荐 · 适配 docker-compose 部署）
# docker exec -i costra-postgres psql -U costra -d costra -c "$SQL"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 用户 B 已成功加入家庭 F（角色: member）"
  echo ""
  echo "验证："
  docker exec -i costra-postgres psql -U costra -d costra -c "
    SELECT fm.user_id, u.nickname, fm.role, fm.joined_at, fm.left_at
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
     WHERE fm.family_id = '${FAMILY_F}'
     ORDER BY fm.joined_at;
  "
else
  echo ""
  echo "❌ 执行失败，请检查数据库连接"
  echo "   如果是本地直连，尝试: psql -h localhost -p 5432 -U costra -d costra"
fi
