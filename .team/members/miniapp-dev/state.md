# miniapp-dev · state.md

> 角色规则来源：`.team/agents/03-miniapp-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 miniapp-dev（旧 MiniApp-Agent）执行微信小程序开发。

- 角色文件：`.team/agents/03-miniapp-agent.md`
- **已知偏差**：角色文件写 `miniapp/` · 实际仓库是 `miniprogram/`（对齐 COSTRA-121~123 收官事实）· 装扮时以 `miniprogram/` 为准

## §2 当前关注（active tasks）

- ✅ **COSTRA-303 统计页消费 pendingStatisticsAction（自动切成员/月-年/展开 L1）**（2026-06-24 · onShow 接入 pending 消费 + 抽出 _handleL1Tap 程序触发版(+silent 参数) + _consumePendingAction 5 步完整流程 + AppWithBootstrap 类型扩展 + type-only import PendingStatisticsAction · 1文件 +91 行净增 · typecheck+lint+test 113/113 全绿 · 945行 < 1000）
- ✅ **COSTRA-302 协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）**（2026-06-23 · 删除旧 detail-list + 新增 family-rank 手风琴 + 年度可用化 + L1 跳转 pendingStatisticsAction + app.ts globalData 扩展 · 4文件 +382/-391 · typecheck+lint+test 113/113+check:appjson+tooling+whitelist 全绿 · commit `0136ad5`）
- ✅ **COSTRA-264 COSTRA-263 review 修复 + 二指手势后统计页左边距异常修复**（2026-06-22 · P0 拆分 index.ts(1093→979行) + P1 swiper 高度状态重置 + P1 初始高度动态化 + P1 tap 跳转 loading 占位 + P2 深滚回跳扣 nav 高度 + P2 anchor 测量移除 top>0 限制 + E 二指手势 overflow-x:hidden 防护 + F tech-spec §4.7+§8.4 · 6文件 +328/-201 · 六闸全绿 · commit `3013344`）
- ✅ **COSTRA-263 统计页成员横滑改为 native swiper + auto-height adapter**（2026-06-21 · scroll-view→native swiper + 邻域高度保护 + duration=0 tap 跳转 + 页面滚动位置策略 + 测高 helper 全 callsite 接入 + tech-spec §4.7 更新 · 4文件 +253/-69 · typecheck+lint+test 113/113+check:appjson+tooling+whitelist 全绿 · commit `28798fd`）
- ✅ **COSTRA-262 统计页成员维度缓存生命周期与下钻独立性收尾**（2026-06-20 · 类型抽出 types.ts + 失效策略细化(_clearCurrentDimViews vs _invalidateCurrentDimViews) + 下钻独立性审查确认（memberkey dataset + async guard + userId drill-down）+ tech-spec §4.7 追加 · 3文件 +155/-131 · typecheck+lint+test 113/113+check:appjson+tooling+whitelist 全绿 · commit `c171155`）
- ✅ **COSTRA-261 统计页成员维度横滑切换框架改造**（2026-06-19 · 新建 utils/memberColor.ts + statisticsApi 4 API userId 参数 + statistics/index.ts 全面重构(byMember 数据结构+懒加载+scroll 节流) + wxml 模板拆分(tpl-monthly/yearly-pane) + wxss 成员指示器条+横向 scroll-view + family 页迁移色板 · 8文件 +896/-520 · typecheck+lint+test 113/113+check:appjson+check:tooling+check:whitelist 全绿 · commit `7dac27b`）
- 🔧 **COSTRA-223 家庭页 R1.x.1 修订**（2026-06-18 · P0-1 InviteResponse 对齐 OpenAPI + P0-2 403/FAMILY_NOT_MEMBER 专门处理 + P1-1 PersonalByMember.amount + P1-2 SWR stale-first + P1-3 分享路径 invite_token + P1-4 缓存上限 20 · 2文件 +65/-39 · typecheck+lint+test 99/99 全绿 · 等 review-tech R2）
- ✅ **COSTRA-220 明细页真实数据完善**（2026-06-17 · 扩展 FamilyContext(kind+name) + 账本名真实显示 + 成员筛选过滤 + eventBus 响应式刷新 + UX 增强 · 6文件 +250/-60 · typecheck+lint+check:appjson+test 99/99 全绿）
- 🔧 **COSTRA-219 前端分类数据模型替换硬编码**（2026-06-16 · 新建 categoryService.ts + 重写 categories.ts + 修改 expense-overlay/index.ts + 修改 ledger/index.ts · 4文件 +593/-194 · commit `d00c47e`）
- 🔧 **COSTRA-216 修复 Tab 页 custom navigation 后页面标题顶部错位**（2026-06-15 · family/statistics/mine/add-placeholder 四页面补齐最小自定义导航栏/顶部安全区 · 使用 getSafeAreaMetrics() 统一获取安全区指标 · 12文件 +194/-35 · commit `307fa2b`）
- 🔧 **COSTRA-215 统一 Tab 页 custom navigation 修复 overlay 偏低**（2026-06-15 · statistics/family/mine/add-placeholder 四页面统一 navigationStyle:custom · 移除原生导航栏 titleText · 4文件 +4/-21 · commit `a058d50`）
- 🔧 **COSTRA-214 统一安全区与自定义导航高度标准化**（2026-06-14 · 新建 safeArea.ts 统一服务 + 迁移 expense-overlay/ledger + 7 单测 · commit `41877e6`）
- 🔧 **COSTRA-213 修复计算表达式保存金额出现 0.09 的单位错误**（2026-06-13 · pressEquals/inputOperator链式计算中 amountCents 用 result.toNumber()返回元而非分 → 改为 safeToCents(resultStr) · 2文件 +73/-17 · commit `c5902fe`）
- ✅ **COSTRA-212 修复记账页备注多次编辑、计算器算式错误、滚动动画不丝滑**（2026-06-12 · 备注区域移除wx:if/wx:else改为class显隐+计算器replaceRightOperand替代正则+滚动插值动画easeOutCubic 220ms · 5文件 +280/-29 · commit `741fbb3`）
- ✅ **COSTRA-211 优化记账分类防遮挡滚动：最小滚动 + 丝滑体验**（2026-06-11 · 二阶段真实布局算法替代固定键盘高度估算 · _showKeypadAndEnsureVisible + _ensureSelectedNearKeyboard · 移除 KEYPAD_SHEET_ESTIMATED_HEIGHT_PX · SAFE_MARGIN_PX 16→12px · KEYPAD_LAYOUT_SETTLE_MS=80ms · 1文件 +74/-45 · commit `0fef508`）
- ✅ **COSTRA-210 修复记账覆盖层多实例状态残留导致切Tab误弹出**（2026-06-10 · 方案A: overlay订阅HIDE事件同步关闭所有实例 + 方案C: custom-tab-bar切Tab前防御性emit HIDE · 2文件 +28/-8 · commit `51ccd92`）
- ✅ **COSTRA-209 记账覆盖层分类防键盘遮挡滚动与打开重置已交付**（2026-06-09 · 防遮挡滚动(_ensureCategoryVisibleAboveKeypad)+打开重置(categoryScrollTop 1→0)+分类item稳定id · 2文件 +100/-4 · commit `e84cdd1`）
- 🔧 **COSTRA-208 补丁: 一级分类四列网格修复已交付**（2026-06-08 · .category-section--tier1 缺 display:grid 导致纵向单列→添加 grid-template-columns:repeat(4,minmax(0,1fr)) · 1文件 +5/-3 · commit `b06e181`）
- ✅ **COSTRA-208 记账覆盖层完全重写已交付**（2026-06-01 · 从需求出发不沿用旧布局 · overlay→shell(flex-column)→header+scroll-view(flex:1)+keypad-sheet · 彻底移除swiper/旧class/JS动态高度 · 统一expense-*/category-*/keypad-*前缀 · 3文件 +252/-335 · commit `74a90e4`）
- ✅ **COSTRA-207 移除swiper根治分类网格空白已交付**（2026-06-07 · swiper/swiper-item裁剪机制导致scroll-view高度异常→删除swiper改用flex:1 category-panel+双scroll-view+轻量横滑手势 · 3 文件 +155/-145 · commit `24243fb`）
- ✅ **COSTRA-206 补丁2: catchtouchmove 阻断 scroll-view 滚动已修复**（2026-06-06 · 外层 overlay 的 catchtouchmove 吞掉 touchmove 导致分类网格无法手指滚动 · 移到 header/keypad-panel 上防穿透 + scroll-view 加显式高度 · 1 文件 +8/-3 · commit `614aaae`）
- ✅ **COSTRA-206 补丁: swiper 高度动态计算已交付**（2026-06-05 · 微信 swiper 不响应 flex:1 导致分类网格只占上半屏 · attached 中 wx.getSystemInfoSync+getMenuButtonBoundingClientRect 动态计算高度 · 3 文件 +15/-4 · commit `7ff7cdd`）
- ✅ **COSTRA-206 记账覆盖层 4 个 UI 问题修复已交付**（2026-06-05 · 底部绿色残留+全屏分类初始态+支出收入文字指示器+关闭按钮避让胶囊 · 4 文件 +106/-30 · commit `063b9e0`）
- ✅ **COSTRA-205 登录 Wordmark + TabBar 遮挡修复已交付**（2026-06-05 · Wordmark 全大写细体+字距+布局调整 + custom-tab-bar 覆盖层显隐联动隐藏 + z-index 提升 + safe-area 标准变量 · 7 文件 +57/-14 · commit `4a65569`）
- ✅ **COSTRA-204 记账覆盖层全新开发已交付**（2026-06-04 · 全屏覆盖层+收支swiper切换+双层分类网格+场景A/B交互+计算器状态机(decimal.js)+账本切换+费用性质开关+备注+保存逻辑 · 5 文件 +1451/-27 · commit `cd9cc88` · 等 review-tech R1）
- ✅ **COSTRA-203 明细页全新开发已交付**（2026-06-03 · 自定义导航栏+112rpx巨大月支出+日期分组吸顶+左滑删除+账本/月份/成员切换 · 4 文件 +883/-14 · commit `3f41afb` · 等 review-tech R1）
- ✅ **COSTRA-202 登录页重做已交付**（2026-06-02 · 极简暖灰白背景+Costra Wordmark+随机格言+微信绿CTA · 4 文件 +121/-47 · commit `cd1d636` · 等 review-tech R1）
- ✅ **COSTRA-201 Custom TabBar + 路由重组 + 事件总线已交付**（2026-06-01 · custom-tab-bar 5 Tab 中置式 + 毛玻璃 + [+] eventBus + app.json 5-tab routing + 4 新 Tab 页面骨架 + expense-overlay 覆盖层 + mine 适配 · 29 文件 +644/-11 · commit `defab0e` · 等 review-tech R1）
- ✅ **COSTRA-200 设计令牌全面重写已交付**（2026-06-01 · tokens/index.ts + app.wxss + app.json + tokens.json 四文件全面重写 · 旧色彩体系→暖灰白/油墨暖黑/微信绿 · 旧变量兼容别名保留 · commit `49ebd51` · 等 review-tech R1）

## §3 交付历史索引

- 2026-06-24 · `history/2026-06-24-costra-303-consume-pending-statistics-action.md` · COSTRA-303 **统计页消费 pendingStatisticsAction（自动切成员/月-年/展开 L1）**（onShow 接入 pending 消费 + _handleL1Tap 抽出 + _consumePendingAction 实装 · 1文件 +91行 · typecheck+lint+test 113/113 全绿 · 945行）
- 2026-06-23 · `history/2026-06-23-costra-302-family-drilldown-rank.md` · COSTRA-302 **协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）**（删除旧 detail-list + 新增 family-rank 手风琴 + DrilldownRow/L1Display 类型 + 年度可用化 + L1 跳转 pendingStatisticsAction + app.ts globalData · 4文件 +382/-391 · 六闸全绿 · commit `0136ad5`）
- 2026-06-22 · `history/2026-06-22-costra-264-review-fix-overflow-guard.md` · COSTRA-264 **COSTRA-263 review 修复 + 二指手势后统计页左边距异常修复**（P0 拆分 index.ts(1093→979行) + P1 swiper 高度状态重置 + P1 初始高度动态化 + P1 tap loading 占位 + P2 深滚回跳扣 nav + P2 anchor 测量修复 + E overflow-x:hidden + F tech-spec · 6文件 +328/-201 · 六闸全绿 · commit `3013344`）
- 2026-06-21 · `history/2026-06-21-costra-263-statistics-native-swiper.md` · COSTRA-263 **统计页成员横滑改为 native swiper + auto-height adapter**（scroll-view→native swiper + 邻域高度保护 + duration=0 tap 跳转 + 页面滚动位置策略 + 测高 helper 全 callsite 接入 + tech-spec §4.7 更新 · 4文件 +253/-69 · 六闸全绿 · commit `28798fd`）
- 2026-06-20 · `history/2026-06-20-costra-262-statistics-cache-drilldown.md` · COSTRA-262 **统计页成员维度缓存生命周期与下钻独立性收尾**（类型抽出 types.ts + 失效策略 clear vs invalidate + 下钻独立性确认 + tech-spec §4.7 · 3文件 +155/-131 · 六闸全绿 · commit `c171155`）
- 2026-06-19 · `history/2026-06-19-costra-261-statistics-member-swipe.md` · COSTRA-261 **统计页成员维度横滑切换框架改造**（新建 utils/memberColor.ts + statisticsApi userId + byMember 数据结构 + scroll-snap 横滑 + 指示器条 + 模板拆分 · 8文件 +896/-520 · 六闸全绿 · commit `7dac27b`）
- 2026-06-18 · `history/2026-06-18-costra-223-r1x1-revise.md` · COSTRA-223 **R1.x.1 修订**（P0-1 InviteResponse 对齐 OpenAPI + P0-2 403 处理 + P1-1 amount 字段 + P1-2 SWR stale-first + P1-3 invite_token + P1-4 缓存上限 · 2文件 +65/-39 · typecheck+lint+test 99/99 全绿）
- 2026-06-18 · `history/2026-06-18-costra-223-family-page.md` · COSTRA-223 **家庭页全新开发 / API 接入 · R1 实装**（Solo/Multi 两态 + 成员横滚 + 已退出灰化 + 邀请/移出/创建家庭接真实 API + 月度 summary + Segmented Bar + Accordion 下钻 + 月份切换 + 空态 · 5文件 +720/-30 · typecheck+lint+check:appjson+test 99/99 全绿 · 等 review-tech R1）
- 2026-06-17 · `history/2026-06-17-costra-220-ledger-data-integration.md` · COSTRA-220 **明细页真实数据完善**（扩展 FamilyContext(kind+name) + 账本名真实显示 + 成员筛选过滤 + eventBus ENTRY_SAVED 响应式刷新 + 空状态美化+月份切换scrollTop · 6文件 +250/-60 · typecheck+lint+check:appjson+test 99/99 全绿）
- 2026-06-16 · `history/2026-06-16-costra-219-category-model-api.md` · COSTRA-219 **前端分类数据模型替换硬编码**（新建 categoryService.ts + 重写 categories.ts + 修改 expense-overlay/index.ts + 修改 ledger/index.ts · 4文件 +593/-194 · typecheck+lint+check:appjson+test 95/95 全绿 · commit `d00c47e`）
- 2026-05-02 · `history/2026-05-02-getglobalstorage-v2-diagnose.md` · FU-LAUNCH 第 3 次观察 **重定性 v2**（D-017 Step 2 · SBAI v1.1 P2' 冒烟 · 证据坐实"storage.ts:29 模块顶层副作用 vs 高版本库时序约束"）
- 2026-05-02 · `history/2026-05-02-costra-124-r1-implement.md` · COSTRA-124 R1 实装（SBAI v1.1 P2' 实战第 2 回 · DoD (a)(b)(c 路径 ①)(d)(f 预闭合)(g) 已交付 · (e) 待 Human 实测 · 2 文件代码修复 + 2 份新文档 + FU f.1+f.2 追写）
- 2026-05-03 · `history/2026-05-03-costra-124-r2-diagnose.md` · COSTRA-124 **Revise-Round-2 根因重做**（SBAI v1.1 P2' 冒烟第 3 回 · D-017 Step 2 只诊断不修复 · 基于 Human 第 7 次实测证伪 R1 假设 · L1-L4 四层根因重做 · 6 方案对比 · 8 Q 决策点 · 0 次 miniprogram/ 写入 · 0 次 git commit）
- **2026-05-04** · `history/2026-05-04-costra-125-r1-implement.md` · COSTRA-125 **R1 实装交付**（SBAI v1.1 接力卡实战第 4 回 · 接续 R1 部分实装的 3 文件未提交 diff · 补齐 DoD (a)~(h) 全 8 条 · 8 文件代码改动 + 1 单测新建 + 3 文档追写 + state §2/§3/§7 收尾 · 六闸全绿 · 等 Human 第 8 次实测）
- **2026-05-08** · `history/2026-05-08-costra-126-libversion-upgrade.md` · COSTRA-126 **跨 lib 实测证伪 + libVersion 升级 + 同卡簇收官**（Human 第 8 次跨 5 lib 版本实测 · 4 条独立证据链 · v4 定性 + FU-LAUNCH A/B closed · C 降 P3 观察）
- **2026-05-08** · `history/2026-05-08-costra-127-r1-implement.md` · COSTRA-127 **方案 B 实装 + FU-LAUNCH-C 真 closed**（login reLaunch + home/mine onShow bootstrap gate · D-017 Step 2 诊断置信度 90%+ · Human 拍板全按推荐 · 等 Human 实测 + review-tech R1）
- **2026-05-09** · `history/2026-05-09-costra-103-r1-implement.md` · COSTRA-103 **R1 实装交付**（db.ts 273行/8API + outbox.ts ~280行/6API + id.ts 33行 + sync.ts 重构 + entry/index.ts payload snake_case · 6 闸门 5/6 全绿 · test 34/34 ✅ · 等 review-tech Round-1 + Human 模拟器终验 · SBAI 第 7 次冒烟）
- **2026-05-09** · `history/2026-05-09-costra-103-r1-implement.md` · COSTRA-103 **R1.3 实装收尾**（D-017 v3 首次完整流程实战 · Step 1~5 + Human Q1~Q4 全 (a) 拍板方案 A · outbox.ts conflict off-by-1 + handleRetry 死代码清理 + drainBatch recover 重构 · test 34/34 ✅ · 等 review-tech Round-1 + Human 模拟器终验 · SBAI 第 7 次冒烟）
- **2026-05-18** · `history/2026-05-18-costra-157-r1-miniapp-segment.md` · COSTRA-157 **R1 miniapp 段实装**（B/C/D/E + F 5 项 · 单卡双装扮档第 2 段 · defaults 配置化 + mapError 红线 + onAvatarError + 完善资料降级 UI + 8 单测 · 6+4 闸门全绿 · 等 review-tech R1）
- **2026-05-18** · `history/2026-05-18-costra-105-r1x1-bug001-ledger-fix.md` · COSTRA-105 **R1.x.1 BUG-001 修复**（ledger_id 'default' 字面量 → fallback UUID + globalData.activeLedgerId 类型声明 · D-017 v3 §2.4 E1 例外路径 · typecheck ✅ test 42/42 ✅）
- **2026-05-19** · `history/2026-05-19-costra-158-r1-miniapp-segment.md` · COSTRA-158 **R1 miniapp 段实装**（H/I/J + J'/G' 扩展 5 项 · 单卡双装扮档第 2 段 · TokenRaw + computeHasProfile 严格判定 + home.spec + login updateLocalUserProfile + auth.spec · 6 闸门全绿 · 反向验证 G10/G11 通过 · 等 review-tech R1）
- **2026-05-19** · `history/2026-05-19-costra-158-r1x1-bug-fix.md` · COSTRA-158 **R1.x.1 P0 BUG 修复**（updateLocalUserProfile setStorageSync 裸对象 → async setItem envelope 一致性 · login/index.ts 加 await · auth.spec 重启回读单测 · 反向验证 PASS · D-017 v3 §2.4 E1 例外路径第 7 次 · 等 Human 重新实测）
- **2026-05-22** · `history/2026-05-22-costra-150-r1x2-outbox-deadlock-and-v1.2-watermark.md` · COSTRA-150 **R1.x.2 outbox 死锁修复 + v1.2 watermark 适配**（联合 staging 实测捕获 P0 outbox 死锁 BUG-D 三重根因 · commit `2b28210` · 等 Human 再次联合实测 + 双卡 approve）
- **2026-05-20** · `history/2026-05-20-costra-150-r1-implement.md` · COSTRA-150 **R1 实装** `ee97a7a`（syncScheduler.ts 新建 4 触发源 + mutex + debounce + app.ts 接入 + home/mine onShow 接入 + 8 单测 + FU-103 CLOSED + 105 D2 联合 RESOLVED · G1~G6+G15 全绿 · 反向验证 G7~G9 通过 · 等 review-tech R1 + Human 联合 154 实测）
- **2026-05-27** · `history/2026-05-27-costra-165-r1-family-context-service.md` · COSTRA-165 **R1 实装**（family.ts 新建 + auth.ts 5 处接入 + syncScheduler 迁移 + entry 防御层 · 11/11 测全绿 + 反向验证 ④ 全绿 · 六闸全绿 · 等 review-tech R1 + Human 联合 164 staging 实测）
- **2026-06-01** · `history/2026-06-01-costra-200-design-tokens-overhaul.md` · COSTRA-200 **设计令牌全面重写**（4 文件 · commit `49ebd51` · 等 review-tech R1）
- **2026-06-01** · `history/2026-06-01-costra-201-custom-tabbar.md` · COSTRA-201 **Custom TabBar + 路由重组 + 事件总线**（29 文件 · commit `defab0e` · 等 review-tech R1）
- **2026-06-02** · `history/2026-06-02-costra-202-login-redesign.md` · COSTRA-202 **登录页重做**（4 文件 · commit `cd1d636` · 等 review-tech R1）
- **2026-06-03** · `history/2026-06-03-costra-203-ledger-page.md` · COSTRA-203 **明细页全新开发**（4 文件 · commit `3f41afb` · 等 review-tech R1）
- **2026-06-04** · `history/2026-06-04-costra-204-expense-overlay.md` · COSTRA-204 **记账覆盖层全新开发**（5 文件 +1451/-27 · 全屏覆盖层+收支切换+双层分类网格+计算器状态机+账本切换+保存 · commit `cd9cc88` · 等 review-tech R1）
- **2026-06-05** · `history/2026-06-05-costra-205-login-wordmark-tabbar-fix.md` · COSTRA-205 **登录 Wordmark + TabBar 遮挡修复**（7 文件 +57/-14 · Wordmark 全大写细体+布局调整 + custom-tab-bar eventBus 联动隐藏 + overlay z-index 提升 + safe-area 标准变量 · typecheck+lint 全绿 · commit `4a65569`）
- **2026-06-05** `history/2026-06-05-costra-206-overlay-ui-fix.md` · COSTRA-206 **记账覆盖层 4 个 UI 修复**（底部绿色残留+全屏分类初始态+支出收入文字指示器+关闭按钮避让胶囊 · 4 文件 +106/-30 · typecheck+lint 全绿 · commit `063b9e0`)
- **2026-06-05** · `history/2026-06-05-costra-206-swiper-height-fix.md` · COSTRA-206 **补丁: swiper 高度动态计算修复分类网格不满屏**（微信 swiper 不响应 CSS flex:1 → attached 中 wx.getSystemInfoSync + getMenuButtonBoundingClientRect 动态计算高度 → wxml style 动态绑定 → wxss 移除无效 flex 属性 · 3 文件 +15/-4 · commit `7ff7cdd`）
- **2026-06-06** · `history/2026-06-06-costra-206-scrollview-scroll-fix.md` · COSTRA-206 **补丁2: 修复分类网格无法滚动根因**（外层 overlay catchtouchmove 吞掉 touchmove → 移到 header/keypad-panel 防穿透 + scroll-view 加显式 swiperHeight 高度 · 1 文件 +8/-3 · commit `614aaae`）
- **2026-06-07** · `history/2026-06-07-costra-207-remove-swiper-fix-blank.md` · COSTRA-207 **移除swiper根治分类网格空白**（swiper/swiper-item裁剪机制导致scroll-view高度异常→删除swiper改用flex:1 category-panel+双scroll-view(wx:if/wx:elif)+轻量横滑手势(onPanelTouchStart/End) · 删除swiperHeight/onSwiperChange/attached高度计算 · 3文件 +155/-145 · commit `24243fb`)
- **2026-06-09** · `history/2026-06-09-costra-209-category-scroll-occlusion.md` · COSTRA-209 **分类防键盘遮挡滚动与打开重置**（_ensureCategoryVisibleAboveKeypad+categoryScrollTop重置+分类item稳定id · 2文件 +100/-4 · typecheck+lint 全绿 · commit `e84cdd1`）
- **2026-06-15** · `history/2026-06-15-costra-216-tab-custom-nav-safe-area-fix.md` · COSTRA-216 **修复 Tab 页 custom navigation 后页面标题顶部错位**（family/statistics/mine/add-placeholder 四页面补齐最小自定义导航栏/顶部安全区 · 使用 getSafeAreaMetrics() 统一获取安全区指标 · 12文件 +194/-35 · typecheck+lint+check:appjson 全绿 · commit `307fa2b`）
- **2026-06-10** · `history/2026-06-10-costra-210-overlay-multi-instance-fix.md` · COSTRA-210 **修复记账覆盖层多实例状态残留导致切Tab误弹出**（方案A: overlay订阅HIDE事件同步关闭所有实例 + 方案C: custom-tab-bar切Tab前防御性emit HIDE · 2文件 +28/-8 · typecheck+lint 全绿 · commit `51ccd92`）
- **2026-06-14** · `history/2026-06-14-costra-214-safe-area-standardization.md` · COSTRA-214 **统一安全区与自定义导航高度标准化**（新建 safeArea.ts 统一服务 + 迁移 expense-overlay/ledger + 7 单测 · 6文件 +391/-19 · typecheck+lint+test 95/95 全绿 · commit `41877e6`）
- **2026-06-13** · `history/2026-06-13-costra-213-calc-amountCents-unit-fix.md` · COSTRA-213 **修复计算表达式保存金额出现 0.09 的单位错误**（pressEquals/inputOperator链式计算 amountCents result.toNumber()→safeToCents(resultStr) · 2文件 +73/-17 · typecheck+lint+test 88/88 全绿 · commit `c5902fe`）
- **2026-06-12** · `history/2026-06-12-costra-212-note-calc-scroll-fix.md` · COSTRA-212 **修复记账页备注多次编辑、计算器算式错误、滚动动画不丝滑**（备注区域移除wx:if/wx:else改为class显隐+计算器replaceRightOperand替代正则修复1+11=11+滚动插值动画easeOutCubic 220ms+14单测 · 5文件 +280/-29 · typecheck+lint+test 全绿 · commit `741fbb3`）
- **2026-06-11** · `history/2026-06-11-costra-211-category-scroll-minimal-displacement.md` · COSTRA-211 **优化记账分类防遮挡滚动：最小滚动 + 丝滑体验**（二阶段真实布局算法替代固定键盘高度估算300px · _showKeypadAndEnsureVisible入口 + _ensureSelectedNearKeyboard核心 · 移除KEYPAD_SHEET_ESTIMATED_HEIGHT_PX · SAFE_MARGIN_PX 16→12px · KEYPAD_LAYOUT_SETTLE_MS=80ms · 1文件 +74/-45 · typecheck+lint 全绿 · commit `0fef508`）
- **2026-06-08** · `history/2026-06-08-costra-208-tier1-grid-fix.md` · COSTRA-208 **补丁: 一级分类四列网格修复**（.category-section--tier1 缺 display:grid 导致纵向单列→添加 grid-template-columns:repeat(4,minmax(0,1fr)) · 移除未使用 .category-grid · 1文件 +5/-3 · typecheck+lint 全绿 · commit `b06e181`）
- **2026-06-01** · `history/2026-06-01-costra-208-expense-overlay-rewrite.md` · COSTRA-208 **记账覆盖层完全重写**（从需求出发不沿用旧布局·overlay→shell(flex-column)→header+scroll-view(flex:1)+keypad-sheet·彻底移除swiper/category-panel/JS动态高度·统一expense-*/category-*/keypad-*前缀·3文件+252/-335·commit `74a90e4`）
## §4 最近决策影响

- `D-018 SBAI v1.0`
- `ADR-0002`· 技术栈（不适用 miniapp · 适用 backend）
- COSTRA-119/120/121/122/123 同族盲区五连收官（规约盲区检测工具链）

## §5 工作区 + 权限

可写目录：`miniprogram/` / `.team/members/miniapp-dev/`
禁写：其他目录 · 特别是 `server/` `api/` `design/`

## §6 遗留问题 / FU / 债务

- **FU-LAUNCH-FIRST-RENDER-RACE 族（A/B/C 子 FU）**：`closed @ COSTRA-127`（2026-05-08 17:55 · Human 实测兑现）· 完整治理叙事见 `history/2026-05-02` + `2026-05-03` + `2026-05-04` + `2026-05-08-costra-126` + `2026-05-08-costra-127` + `dispatch/COSTRA-124~127`

- **COSTRA-204 遗留**：
  - ~~分类数据当前硬编码（后续卡对接 API 替换）~~ ✅ 已由 COSTRA-219 解决
  - ~~账本选项列表当前硬编码为单个"我的账本"（对接 family list API 后扩展）~~ ✅ COSTRA-220 已从 FamilyContext 获取真实账本名称
  - ~~多人家庭账本判定逻辑待对接真实 family 数据（当前 `isMultiMember` 硬编码 false）~~ ✅ COSTRA-220 已改用 family_kind === 'shared' 判断
  - 金额显示区暂无千分位格式化（后续优化）

- **COSTRA-124 Card-Review Round-1 Follow-up**（2026-05-02 21:05 · PASS-WITH-FOLLOWUP 26/30 · 3 P2 非强制建议 · R1 实装时自主决定是否合并）
  - **FU-124-P2-1**（估点实事求是）：dispatch §8 时间预算"30 min 两份文档"建议改为"45-60 min" · 或 Sprint-1 末 Retro 议题"紧急卡估点偏乐观"增列第 5 条证据
  - **FU-124-P2-2**（实测断言语义）：dispatch §3 DoD (e) 4 条验证断言补一行"4 条全 PASS 为硬门槛；Launch Time 900-935 ms 视为 AMBER · 走 Human 个案裁决不自动 REVISE"
  - **FU-124-P2-3**（FU 闭合定性翻转追写）：DoD (f) 可扩展为 f.1 + f.2 两小段 · f.2 明文记"前 3 次定性误判（SDK 内部 Bug）→ 第 4 次新线索（Human）→ 装扮 subagent 独立核查坐实 storage.ts:29 → COSTRA-124 修复 → FU closed"完整翻转链 + 下游议题（Sprint-1 末 Retro 第 15 条"独立复核可翻转历史定性"范式）

- **COSTRA-124 R1 Review 33/35 纸面审漏拦截 R1 假设漏洞**（2026-05-03 R2 发现）· Retro 议题 17 候选："Review-Tech 对 runtime 规约类 T2 卡 · 需 Human 模拟器实测作为 Round-N+1 前置" · 与 Retro 议题 11 "Review 可能基于错误假设" 并链 · 本次是第 2 次纸面审漏检事件（COSTRA-121 是第 1 次）

- **docs/devops/libversion-upgrade.md §3 反模式 #4 追写候选**（R2 诊断产物）：坏例 "R1 假设把 wx.* 同步调用从模块顶层迁入 App.onLaunch 首行即安全" · 好例 "验证 SDK 运行时实现细节与文档承诺是否吻合 · 必须模拟器实测不信纸面" · 原因 "文档承诺 ≠ 运行时实现 · SDK 内部 storage group/prepare 状态机属黑盒"

- **COSTRA-125 Card-Review Round-1 Follow-up**（2026-05-04 08:30 · PASS 31/35 · 4 P2 非强制建议 · R1 实装时自主决定是否合并 · 审查建议至少合 P2-1 + P2-3）
  - **FU-125-P2-1（commit 原子性）**：dispatch §6 加一行"commit 1 落盘前必须 `npm run typecheck && npm run test` 双 PASS · commit 2 落盘前所有文档互链自检一致"
  - **FU-125-P2-2（估点顺扫修复偏乐观）**：dispatch §10 "顺扫修复" 从 10 min 调整为 20-30 min · 或接受 "若 typecheck 抓出 > 10 处调用链适配 · 本卡升 3 点 + Sprint-1 末 Retro 第 6 条证据"
  - **FU-125-P2-3（B' 假设再证伪降级路径）**：dispatch §8 验收末尾加"若 DoD (g) 断言 1-2 仍失败 · 本卡立即 BLOCKED + 冒泡 Human · 默认降级路径 = ① C' 回退 `libVersion` 2.30.x 应急 + ② Sprint-2 COSTRA-12x 走 E' 完整 bootstrap 重构"
  - **FU-125-P2-4（跨卡文档追写治理依据）**：dispatch §4 "可写" 组加注"追写 COSTRA-124 新建文档属接力卡治理反哺范式（D-017 §13.6/13.7 先例）· 非越权"

## §7 最近更新时间戳
- **2026-06-24T16:10:00+08:00** · COSTRA-303 **统计页消费 pendingStatisticsAction 交付**（onShow 接入 pending 消费 + _handleL1Tap 抽出(+silent) + _consumePendingAction(5 步: dim/month-year/member/loadData/expandL1) + AppWithBootstrap 类型扩展 + type-only import · 1文件 pages/statistics/index.ts 854→945 行(+91) · typecheck 0 error + lint 0 new warning(4 历史) + test 113/113 ✅）
- **2026-06-23T15:40:00+08:00** · COSTRA-302 **协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）交付**（删除旧 detail-list + 新增 family-rank 手风琴 + DrilldownRow/L1Display 类型 + 年度可用化(移除 toast 拦截 + year picker + onPrevYear/onNextYear/onYearChange) + 公共行 L1 不下钻 + 成员行 L1 写 pendingStatisticsAction + switchTab + app.ts globalData 扩展 + _loadSummary scope 重构 + 手风琴交互(同时仅一行展开) + _collapseAllRows 切时间/切账本 · 4文件 +382/-391 · index.ts 1378行 < 1500 · typecheck+lint+test 113/113+check:appjson+tooling+whitelist 全绿 · commit `0136ad5`）
- **2026-06-18T18:30:00+08:00** · COSTRA-223 **R1.x.1 修订交付**（P0-1 InviteResponse 对齐 OpenAPI + P0-2 403/FAMILY_NOT_MEMBER 专门处理 + P1-1 PersonalByMember.amount + P1-2 SWR stale-first + P1-3 invite_token + P1-4 缓存上限 20 · 2文件 +65/-39 · typecheck+lint+test 99/99 全绿 · 等 review-tech R2）
- **2026-06-16T18:05:00+08:00** · COSTRA-219 **前端分类数据模型替换硬编码交付**（新建 categoryService.ts + 重写 categories.ts + 修改 expense-overlay/index.ts + 修改 ledger/index.ts · 4文件 +593/-194 · typecheck+lint+check:appjson+test 95/95 全绿 · commit `d00c47e`）
- **2026-06-15T** · `history/2026-06-15-costra-216-tab-custom-nav-safe-area-fix.md` · COSTRA-216 **修复 Tab 页 custom navigation 后页面标题顶部错位**（family/statistics/mine/add-placeholder 四页面补齐最小自定义导航栏/顶部安全区 · 使用 getSafeAreaMetrics() 统一获取安全区指标 · 12文件 +194/-35 · typecheck+lint+check:appjson 全绿 · commit `307fa2b`）
- **2026-06-15T** · `history/2026-06-15-costra-215-tab-custom-nav.md` · COSTRA-215 **统一 Tab 页 custom navigation 修复 overlay 偏低**（statistics/family/mine/add-placeholder 四页面 navigationStyle:custom · 移除原生导航栏 titleText · 4文件 +4/-21 · typecheck+lint+check:appjson 全绿 · commit `a058d50`）
- 2026-06-14T15:30:00+08:00 · COSTRA-214 **统一安全区与自定义导航高度标准化交付**（新建 safeArea.ts + 迁移 expense-overlay/ledger + 7 单测 · 6文件 +391/-19 · typecheck+lint+test 95/95 全绿 · commit `41877e6`）
- **2026-06-12T14:10:00+08:00** · COSTRA-212 **修复记账页备注多次编辑、计算器算式错误、滚动动画不丝滑交付**（备注区域移除wx:if/wx:else改为class显隐+计算器replaceRightOperand替代正则修复1+11=11+滚动插值动画easeOutCubic 220ms+14单测 · 5文件 +280/-29 · typecheck+lint+test 全绿 · commit `741fbb3`）
- **2026-06-11T17:30:00+08:00** · COSTRA-211 **优化记账分类防遮挡滚动：最小滚动 + 丝滑体验交付**（二阶段真实布局算法替代固定键盘高度估算 · _showKeypadAndEnsureVisible + _ensureSelectedNearKeyboard · 移除 KEYPAD_SHEET_ESTIMATED_HEIGHT_PX=300 · SAFE_MARGIN_PX 16→12px · KEYPAD_LAYOUT_SETTLE_MS=80ms · 1文件 +74/-45 · typecheck+lint 全绿 · commit `0fef508`）

- **2026-06-10T16:00:00+08:00** · COSTRA-210 **修复记账覆盖层多实例状态残留导致切Tab误弹出交付**（方案A: overlay订阅HIDE事件同步关闭所有实例 + 方案C: custom-tab-bar切Tab前防御性emit HIDE · 2文件 +28/-8 · typecheck+lint 全绿 · commit `51ccd92`）

- **2026-06-09T15:30:00+08:00** · COSTRA-209 **分类防键盘遮挡滚动与打开重置交付**（_ensureCategoryVisibleAboveKeypad+categoryScrollTop 1→0 重置+分类item稳定id(cat-tier1-*/cat-sub-*)+onCategoryScroll记录偏移+KEYPAD_SHEET_ESTIMATED_HEIGHT_PX=300+SAFE_MARGIN_PX=16 · 2文件 +100/-4 · typecheck+lint 全绿 · commit `e84cdd1`）

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-02T20:25:00+08:00 · SBAI v1.1 P2' 冒烟首次自主落盘（by costra-miniapp-dev · D-017 Step 2 重做根因分析 · FU-LAUNCH 定性升级 v2）
- 2026-05-02T21:07:00+08:00 · COSTRA-124 立卡 + Card-Review Round-1 PASS-WITH-FOLLOWUP 26/30 · 3 P2 记入 §6 follow-up（by Orchestrator · 调度层元数据维护）
- 2026-05-02T21:30:00+08:00 · COSTRA-124 R1 实装交付（by costra-miniapp-dev · SBAI v1.1 P2' 实战第 2 回 · storage.ts:29 顶层副作用消除 + app.ts onLaunch 首行挂载 + 2 份新文档 + FU f.1+f.2 预闭合 · 等 Human 实测 + review-tech Round-1）
- 2026-05-03T12:55:00+08:00 · COSTRA-124 Revise-Round-2 根因重做完成（by costra-miniapp-dev · SBAI v1.1 P2' 冒烟第 3 回 · **只诊断不改代码** · 基于 Human 第 7 次实测证伪 R1 假设 · L1-L4 四层根因重做 · 定性升级到 v3（SDK+业务共同责任）· 6 方案对比 · 8 Q 决策点 · **0 次 miniprogram/ 写入 · 0 次 git commit** · 等 Orchestrator 收 final message 回给 Human 裁决）
- 2026-05-03T20:32:00+08:00 · COSTRA-125 立卡（by Orchestrator · Human D1/D2/D3 全按推荐 · 方案 B'+E' 合并版 · COSTRA-124 部分闭合 · FU-LAUNCH 分裂 A/B/C 三子 FU · A closed · B/C open · libversion-upgrade.md §3 追反模式 #4 · 本 state.md §2 active 调整 · 等 Orchestrator 后续 spawn card-reviewer-tech 卡审 + 实装 spawn）
- 2026-05-04T08:30:00+08:00 · COSTRA-125 Card-Review Round-1 PASS 31/35（by costra-card-reviewer-tech · SBAI v1.1 P2'' 冒烟第 2 次 · 审查档物理只读验证通过 · 0 P0 · 0 P1 · 4 P2 记本 §6 FU-125-P2-1~4 · 不触发 Round-2 · dispatch §0 补 Card-Review 响应段 · 下一步 Orchestrator spawn `costra-miniapp-dev` R1 实装）
- **2026-05-04T16:05:00+08:00 · COSTRA-125 R1 实装交付**（SBAI v1.1 接力卡实战第 4 回 · 六闸全绿 · 等 Human 第 8 次模拟器实测 + Orchestrator spawn review-tech Round-1）
- **2026-05-08T18:30:00+08:00 · COSTRA-127 R1 实装交付**（SBAI v1.1 实战第 5 回 · 方案 B 实装（login reLaunch + home/mine onShow bootstrap gate）+ libversion v5 + 反模式 #6 + FU §f.6 + state.md §2/§3/§7 收尾 · 六闸全绿 · 2 commit 落盘 · 等 Human 实测 0 次 Expected updated data + Orchestrator spawn review-tech R1）
- **2026-05-08T17:55:00+08:00 · COSTRA-127 Human 实测 5 条断言全 PASS · 整卡 CLOSED**（FU-LAUNCH-C `closed @ COSTRA-127` · 父 FU-LAUNCH-FIRST-RENDER-RACE `closed` · FU-LAUNCH 族 4 卡治理叙事完整收官 · D-017 Step 2 跨版本对照范式 + 业务时序根因诊断范式建立 · Sprint-1 末同卡簇 4 卡【124/125/126/127】全数收官）
- **2026-05-08T18:45:00+08:00 · COSTRA-128 收尾清洗交付**（A~F 全完成 · 6 项注释/文档清洗 · 0 行为变更 · diff -x ≥ +x · 等 review-tech 形式 R1 + Human 终审）
- **2026-05-09T17:30:00+08:00 · COSTRA-103 R1 实装收尾**（SBAI 第 7 次冒烟 · db.ts 273行/8API + outbox.ts ~280行/6API + id.ts 33行 + sync.ts 重构 + entry/index.ts snake_case + 2 spec.ts + 1 qa doc + dispatch 修正 + card-review 归档 · test 34/34 ✅ · 等 review-tech Round-1 + Human 模拟器终验）
- **2026-05-09T18:25:00+08:00 · COSTRA-103 R1.3 实装最终收尾**（outbox conflict off-by-1 + handleRetry 死代码 + drainBatch recover 重构 + 6 闸门全 ✅ · 等 review-tech Round-1 + Human T1 终审 · D-017 v3 首次完整流程实战）
- **2026-05-18T18:20:00+08:00 · COSTRA-157 R1 miniapp 段实装**（B/C/D/E + F 5 项全落盘 · 单卡双装扮档第 2 段 · 6+4 闸门全绿 · 等 review-tech R1）
- **2026-05-18T20:10:00+08:00 · COSTRA-105 R1.x.1 BUG-001 修复**（ledger_id 'default' → fallback UUID + activeLedgerId 类型声明 · D-017 v3 §2.4 E1 例外路径 · typecheck ✅ test 42/42 ✅ · 单 commit 已落盘）
- **2026-05-19T19:28:00+08:00 · COSTRA-158 R1.x.1 P0 BUG 修复交付**（updateLocalUserProfile setStorageSync→async setItem + login await + auth.spec 重启回读测 · 六闸全绿 · 反向验证 PASS · 单 commit 99e3794 · 等 Human 重新清缓存+干净环境实测 · D-017 v3 §2.4 E1 例外路径第 7 次）
- **2026-05-20T12:00:00+08:00 · COSTRA-150 R1 实装交付**（syncScheduler.ts 4 触发源+mutex+debounce · app.ts startScheduler/stopScheduler · home/mine triggerOnPageShow · 8 单测全绿 · G1~G6+G15 全绿 · 反向验证 G7~G9 通过 · 等 review-tech R1 + Human 联合 154 实测 · SBAI 第 8 次冒烟）
- **2026-05-22T17:30:00+08:00 · COSTRA-150 R1.x.2 outbox 死锁修复 + v1.2 watermark 适配交付**（commit `2b28210` · 双修复同 commit · sync.ts 不再吞错 + outbox.ts ackBatchFailure + drainBatch 防御性 recover + ack_batch_key 字段修复 · db.ts/sync.ts/syncScheduler.ts watermark:number + legacy ISO 自动重置 · 8 文件 +310/-54 · client 58/58 PASS · 等 Human 再次联合实测 · D-017 v3 §2.4 E1 例外路径第 11 次）
- **2026-05-27T16:25:00+08:00 · COSTRA-165 R1 实装交付**（family.ts 新建 + auth.ts 5 处接入 + syncScheduler 迁移 + entry 防御层 · 7 文件 +376/-33 · 69/69 测全绿 · 六闸全绿 · 反向验证 ④ 全绿 · 等 review-tech R1 + Human 联合 164 staging 实测 · D-018 单装扮档单 commit）
- **2026-06-01T15:00:00+08:00 · COSTRA-200 设计令牌全面重写交付**（4 文件 +376/-94 · tokens v2.0.0 · 旧色彩体系→暖灰白/油墨暖黑/微信绿 · 旧变量兼容别名 · typecheck+lint+check 全绿 · commit `49ebd51` · 等 review-tech R1）
- **2026-06-01T19:30:00+08:00 · COSTRA-201 Custom TabBar + 路由重组 + 事件总线交付**（29 文件 +644/-11 · custom-tab-bar 5 Tab + 毛玻璃 + [+] eventBus + app.json routing + expense-overlay + mine 适配 · typecheck+lint+check+test 69/69 全绿 · commit `defab0e` · 等 review-tech R1）
- **2026-06-02T11:30:00+08:00 · COSTRA-202 登录页重做交付**（4 文件 +121/-47 · 极简暖灰白背景+Costra Wordmark+随机格言+微信绿CTA · typecheck+lint+check 全绿 · commit `cd1d636` · 等 review-tech R1）
- **2026-06-03T12:00:00+08:00 · COSTRA-203 明细页全新开发交付**（4 文件 +883/-14 · 自定义导航栏+112rpx巨大月支出+日期分组吸顶+左滑删除+账本/月份/成员切换 · typecheck+lint+check+test 69/69 全绿 · commit `3f41afb` · 等 review-tech R1）
- **2026-06-04T12:00:00+08:00 · COSTRA-204 记账覆盖层全新开发交付**（5 文件 +1451/-27 · 全屏覆盖层+收支swiper切换+双层分类网格+场景A/B交互+计算器状态机(decimal.js)+账本切换+费用性质开关+备注+保存逻辑 · typecheck+lint+check+test 69/69 全绿 · commit `cd9cc88` · 等 review-tech R1）
- **2026-06-05T14:30:00+08:00 · COSTRA-205 登录 Wordmark + TabBar 遮挡修复交付**（7 文件 +57/-14 · Wordmark 全大写细体(font-weight:300)+字距(8rpx)+布局上移(30vh) + custom-tab-bar eventBus 联动隐藏(translateY) + overlay z-index 9999 + app.wxss safe-area/tabbar-height 标准变量 · typecheck+lint 全绿 · commit `4a65569`）
- **2026-06-05T19:00:00+08:00 · COSTRA-206 记账覆盖层 4 个 UI 问题修复交付**（4 文件 +106/-30 · 底部绿色残留(visibility:hidden) + 全屏分类初始态(swiper/scroll-view高度优化+安全区占位) + 支出收入文字指示器(替换圆点+点击切换) + 关闭按钮避让胶囊(左上角"取消") · _switchTab 公共方法抽取 · typecheck+lint 全绿 · commit `063b9e0`）

- **2026-06-01T05:00:46+08:00** · COSTRA-206 补丁: swiper 高度动态计算修复分类网格不满屏交付**（微信 swiper 不响应 CSS flex:1 → attached 中动态计算 windowHeight - headerBottom → wxml style 绑定 swiperHeight → wxss 移除无效 flex 属性 · 3 文件 +15/-4 · typecheck+lint 全绿 · commit `7ff7cdd`）
- **2026-06-07T14:30:00+08:00** · COSTRA-207 **移除swiper根治分类网格空白交付**（删除swiper/swiper-item→flex:1 category-panel+双scroll-view+轻量横滑手势 · 3文件 +155/-145 · typecheck+lint 全绿 · commit `24243fb`）
- **2026-06-06T13:10:00+08:00** · COSTRA-206 补丁2: catchtouchmove 阻断 scroll-view 滚动根因修复交付（移除 overlay 外层 catchtouchmove → header/keypad-panel 加防穿透 + scroll-view 加显式 swiperHeight 高度 · 1 文件 +8/-3 · typecheck+lint 全绿 · commit `614aaae`）
