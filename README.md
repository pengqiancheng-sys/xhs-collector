# 前程智囊团 · 浏览器素材采集插件

> 一键采集小红书/YouTube/网页素材，自动同步到飞书多维表格选题管理表。
> Side Panel 侧边栏常驻，自动更新检测。

## 🚀 功能

| 功能 | 说明 |
|------|------|
| 🔴 小红书采集 | API 拦截 + DOM 深度解析，获取完整标题/正文/图片/互动数据 |
| ▶️ YouTube 采集 | 提取标题/频道/描述/缩略图 |
| 🌐 网页采集 | 自动提取标题/描述/来源 |
| 📊 飞书同步 | 文本写入选题管理表，图片上传附件字段 |
| 🚀 博主批量采集 | 在博主主页一键批量采集笔记 |
| 🆕 自动更新 | 每6小时检查新版本，有新版显示 badge 提示 |

## 📦 安装

1. 下载最新 [Release](https://github.com/qiancheng/xhs-collector/releases)
2. 解压 ZIP
3. Chrome → `chrome://extensions/` → 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」→ 选择解压后的文件夹

## ⚙️ 配置

插件已内置飞书应用凭证，无需手动配置 Token。
如需更换飞书应用，修改 `background.js` 顶部的：
- `APP_ID` / `APP_SECRET`（飞书应用凭证）
- `APP_TOKEN` / `TABLE_ID`（多维表格和表信息）

## 🏗️ 技术架构

```
浏览器插件 (MV3)
├── xhs-bridge.js     → 注入 MAIN 世界，拦截 fetch/XHR 获取小红书 API 数据
├── page-observer.js  → DOM 解析 + 页面类型识别
├── background.js     → 任务队列 + 飞书 API 通信 + 自动更新
├── sidepanel.html/js → 侧边栏 UI
└── page-bridge.js    → MAIN → content script 消息桥接
```

## 📄 许可

MIT
