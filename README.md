# 十一愿俱乐部 · 小昔计算小助手

批量结单 · 陪陪分配 · 工资结算工具。

本仓库包含**两个版本**，业务逻辑完全一致：

| 版本 | 目录 | 运行方式 |
|------|------|----------|
| 微信小程序版 | `miniprogram/` | 用[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)打开仓库根目录 |
| Web 网页版 | `web/` | 纯静态页面，已通过 GitHub Pages 自动部署，浏览器直接打开即用 |

## 功能

- **批量结单**：一次粘贴一张或多张小票文字，自动识别老板、日期、陪陪、项目、礼物、金额、数量、总额、场控，并按人头平均分配金额（自动处理分钱余数）
- **订单查重**：识别和保存时自动比对已保存订单，发现内容相同会提醒，但不会自动跳过（相同内容可能是正常下单）
- **员工管理**：维护员工姓名、提成比例、每月补贴、扣款；已出现在订单里的员工不允许删除，保留历史数据
- **工资统计**：按月份汇总订单总额、陪陪分配总额、提成合计、应发工资合计，并列出入每位员工的明细。工资 = 个人分配金额 × 提成比例 + 补贴 − 扣款（当月无订单不计补贴扣款）

## 数据存储

两个版本都**只在本地保存数据，不上传任何服务器**：

- Web 版：浏览器 `localStorage`（键名 `clubPayrollStaff_v1` / `clubPayrollOrders_v2`）
- 小程序版：微信客户端存储（同一组键名）

> 注意：Web 版数据存在当前浏览器里，换浏览器/设备不互通；清除浏览器数据会清空记录。

## 本地运行 Web 版

无需安装任何依赖，任选一种方式：

```bash
# 方式一：Python
cd web && python3 -m http.server 8000

# 方式二：Node
npx http-server web -p 8000
```

然后访问 http://localhost:8000

## 部署与实时同步（GitHub Pages）

仓库已配置 GitHub Actions 工作流（`.github/workflows/deploy.yml`）：

- 每次 `git push` 到 `main` 分支 → 自动将 `web/` 目录部署为静态网站
- 纯静态文件 + GitHub Pages 全球 CDN，**打开即用，无冷启动、无等待**
- 也可在仓库 Actions 页面手动点 "Run workflow" 重新部署

首次推送后，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions** 即可开通（若用命令行可执行 `gh api -X POST repos/<用户名>/<仓库名>/pages -f build_type=workflow`）。

部署完成后网址为：`https://<用户名>.github.io/<仓库名>/`

## 目录结构

```
├── miniprogram/              # 微信小程序源码（TypeScript）
│   ├── pages/index/          # 主页面：结单 + 员工 + 工资
│   ├── components/           # 自定义导航栏组件
│   └── utils/
├── web/                      # Web 版（纯静态，无需构建）
│   ├── index.html
│   ├── styles.css
│   ├── app.js                # 与小程序版一致的业务逻辑
│   └── favicon.svg
├── .github/workflows/        # GitHub Pages 自动部署
├── typings/                  # 小程序 TypeScript 类型定义
├── project.config.json       # 小程序项目配置
└── package.json
```

## 技术说明

- 小程序版：微信原生框架 + TypeScript，`miniprogram-api-typings` 类型支持
- Web 版：零依赖原生 HTML/CSS/JS，业务逻辑（小票解析、金额分配、工资计算）从小程序版逐行移植，单元测试覆盖
