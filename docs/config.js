/* 十一愿俱乐部 · Supabase 配置
 * ------------------------------------------------------------
 * 部署者需要修改这里，填入自己 Supabase 项目的两个值：
 *
 *   1. 登录 https://supabase.com 进入你的项目
 *   2. Project Settings → API 页面可找到：
 *      - Project URL  → 填入 supabaseUrl
 *      - anon public key → 填入 supabaseAnonKey
 *
 * 未配置时网站自动降级为本地存储模式（仅当前浏览器可用），
 * 不会报错，方便本地预览；配置后即启用云端实时同步。
 * ------------------------------------------------------------ */

var SUPABASE_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY'
};
