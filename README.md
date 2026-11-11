# 揭层

全屏双层揭图小游戏：上层盖住下层，用手指或鼠标把上层去掉。适配电脑与手机，可在浏览器里直接打开，也可按 [LINUX DO 微应用开发指南](https://github.com/linux-do/mapp-developer-guide) 打包成社区微应用。

演示地址：https://hg3386628.github.io/reveal-layers/

## 玩法

内置三关，关卡与效果都在底部工具栏切换，切换效果不会重新加载图片。

| 效果 | 操作 |
| --- | --- |
| 刮开 | 按住涂抹，边缘带纸屑质感，清除约 65% 后自动揭开 |
| 撕纸 | 拖动撕出毛边，碎纸片落下 |
| 擦雾玻璃 | 软边擦去霜雾，留下淡淡水珠 |
| 揭贴纸 | 从四角抓住贴纸向外揭，带卷边与阴影 |
| 碎裂 | 点击裂开，碎片向外跌落 |

工具栏会自动收起，右下角按钮可以再次打开。支持重来、全屏（iPhone 上会进入沉浸式布局）。

当前版本只提供内置关卡，没有自定义上传。

## 本地运行

需要 Node.js 18+。

```sh
npm install
npm run dev
```

浏览 http://127.0.0.1:5173/ 。

```sh
npm run build        # 同时产出 GitHub Pages 静态站和微应用 ZIP
npm run build:pages  # 仅静态站，输出到 dist/pages
npm run preview      # 预览静态站
```

`npm run build` 会把图片、`manifest.json`、正文片段、`app.js`、`app.css`、`strings.json` 打进 `dist/package/app.zip`。

## 发布到 LINUX DO

1. 在社区个人资料的应用页创建应用，复制官方分配的应用 ID。
2. 不要自行使用仓库里的占位 ID。打包时写入真实 ID 与版本号：

```sh
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.0.0 npm run build:mapp
```

3. 在沙箱页上传 `dist/package/app.zip`，通过后再按指南提审。上传、审核和上线必须在 linux.do 完成，本仓库无法代为注册。

调试包可用 `MINI_APP_DEBUG=1 MINI_APP_ID=... MINI_APP_VERSION=1.0.1 npm run build:mapp` 生成（保留 source map）。

## 说明

- 静态站使用相对路径 `base: './'`，可放到 GitHub Pages 子路径。
- 微应用正文是 `src/template.html` 片段，不含脚本入口或内联事件。
- 在社区加载器中会调用 SDK 的主题、全屏、存储和 `lifecycle.ready()`；独立网页会自动降级为本地模式。
- 包内图片经 SDK `assets.readBytes` 以 Blob 读取；独立运行时从相对路径加载。
