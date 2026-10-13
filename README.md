# 十一愿俱乐部 · 批量结单工资工具

批量结单 · 陪陪分配 · 工资结算。纯静态网站，零依赖，数据云端实时同步。

**在线使用**：https://cpdd-1314.github.io/xiaoxi-club/

## 功能

- **快捷录单**：常用信息（老板、项目、场控、礼物）预先添加为预设，录单时**点一下就选**，不用每次写小票；陪陪从员工列表点选（可多选）；总额默认 = 单价 × 数量（可手改）；实时显示每人分配预览；结单后保留常用选择，连续录单更顺手
- **批量结单**：一次粘贴一张或多张小票文字，自动识别老板、日期、陪陪、项目、礼物、金额、数量、总额、场控，并按人头平均分配金额（自动处理分钱余数）
- **订单查重**：识别和保存时自动比对已保存订单，发现内容相同会提醒，但不会自动跳过（相同内容可能是正常下单）
- **员工管理**：维护员工姓名、提成比例、每月补贴、扣款；已出现在订单里的员工不允许删除，保留历史数据
- **工资统计**：按月份汇总订单总额、陪陪分配总额、提成合计、应发工资合计，并列出入每位员工的明细。工资 = 个人分配金额 × 提成比例 + 补贴 − 扣款（当月无订单不计补贴扣款）

## 实时同步

数据存放在 Supabase 云数据库（PostgreSQL），通过 Realtime 实时推送：

- **任何设备录入，其他设备秒级自动更新**（手机、电脑、不同浏览器之间数据一致）
- 页面头部显示同步状态：绿色「云端实时同步」= 已连接；灰色「本地模式」= 未配置云端，数据仅存当前浏览器

## 目录结构

```
docs/                        # 网站全部文件（GitHub Pages 发布目录）
├── index.html               # 页面结构
├── styles.css               # 样式
├── app.js                   # 业务逻辑 + 云端同步
├── config.js                # Supabase 配置（部署者填写）
├── supabase-schema.sql      # 数据库一键初始化脚本
└── favicon.svg
```

## 本地预览

无需安装任何依赖：

```bash
cd docs && python3 -m http.server 8000
# 或：npx http-server docs -p 8000
```

访问 http://localhost:8000 （未配置 Supabase 时自动使用本地模式）

## 部署（GitHub Pages）

仓库已配置 Pages 分支部署（`main` 分支 `/docs` 目录）：每次 `git push` 到 `main`，GitHub 自动重新发布网站（约 1 分钟），全球 CDN 访问，静态文件秒开。

```bash
git add -A && git commit -m "更新" && git push
```

## 接入自己的 Supabase（数据同步）

1. 登录 [supabase.com](https://supabase.com) 创建项目（免费，Region 选离使用者近的）
2. 项目 **SQL Editor** 中粘贴并运行 `docs/supabase-schema.sql`
3. **Project Settings → API** 复制 `Project URL` 和 `anon public key`
4. 填入 `docs/config.js` 的 `supabaseUrl` 和 `supabaseAnonKey`
5. `git push` 后即生效

## 技术说明

- 纯原生 HTML/CSS/JS，无构建步骤、无 npm 依赖
- Supabase JS SDK 通过 CDN 按需加载（仅配置后）
- 数据模型：单行 JSON（`club_state` 表）存放员工与订单数组，Realtime 订阅该行变更
- 写入采用服务端时间戳（`updated_at` 由数据库触发器维护），多设备并发以最后写入为准
