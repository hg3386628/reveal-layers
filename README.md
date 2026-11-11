# 揭层

全屏双层揭图小游戏：上层盖住下层，用手指或鼠标把上层去掉。适配电脑与手机，可在浏览器里直接打开，也可按 [LINUX DO 微应用开发指南](https://github.com/linux-do/mapp-developer-guide) 打包成社区微应用。

演示地址：https://hg3386628.github.io/reveal-layers/

## 玩法

打开后先进入选关界面，所有关卡都可以自由选择，互不依赖。通关后会打勾，并出现「返回选关 / 下一关 / 随机」。揭开过程中可随时换效果，不必重新加载图片。

| 效果 | 操作 |
| --- | --- |
| 刮开 | 按住涂抹，边缘带纸屑质感，清除约 65% 后自动揭开 |
| 撕纸 | 拖动撕出毛边，碎纸片落下 |
| 擦雾玻璃 | 软边擦去霜雾 |
| 揭贴纸 | 从四角抓住贴纸向外揭，带卷边与阴影 |
| 碎裂 | 点击裂开，碎片向外跌落 |

玩的时候工具栏会自动收起，右下角按钮可以再次打开。支持重来、全屏（iPhone 上会进入沉浸式布局）。当前版本只提供内置关卡，没有自定义上传。

## 添加关卡

不必改 TypeScript 或翻译表。构建时会扫描 `public/levels/`，自动生成清单和缩略图。

1. 新建文件夹 `public/levels/<id>/`。`<id>` 只能用字母、数字、连字符和和下划线，例如 `harbor-dusk`。
2. 放入两张图，文件名必须是：
   - `top.jpg`（或 `.jpeg` / `.png` / `.webp`）：上层遮罩
   - `bottom.jpg`（或同样的扩展名）：揭开后露出的下层
3. 可选：在同一目录放 `meta.json`，例如：

```json
{
  "title": "海港黄昏",
  "titles": {
    "zh_CN": "海港黄昏",
    "zh_TW": "海港黃昏",
    "en": "Harbor Dusk"
  },
  "defaultEffect": "tear",
  "order": 10
}
```

`defaultEffect` 可选：`scratch`（刮开）、`tear`（撕纸）、`fog`（擦雾玻璃）、`peel`（揭贴纸）、`shatter`（碎裂）。`order` 越小越靠前；不写则按文件夹名排序。不写 `meta.json` 时，选关界面会直接显示文件夹名。

4. 运行 `npm run dev` 或 `npm run build`。脚本会生成 `thumb.jpg` 和 `public/levels/levels.json`，并把它与全部关卡图打进微应用包。

### 图片规格

- 建议竖图 **1200×1600（3:4）** 或 **1080×1920（9:16）**，JPEG 质量约 85。游戏会按 `object-fit: cover` 铺满全屏：手机竖屏和电脑横屏都会从中心裁切，请把主体放在画面中部，不要贴边。
- 单张建议不超过 **1.5 MB**；关卡多时尽量控制在 800 KB 以内，以便选关缩略图和按需加载保持流畅。
- 平台硬限制（微应用包）：单个文件 32 MiB，解压后合计 128 MiB。不要把原图 RAW 或未压缩 PNG 直接丢进目录。

## 本地运行

需要 Node.js 18+。

```sh
npm install
npm run dev
```

浏览 http://127.0.0.1:5173/ 。

```sh
npm run build        # 扫描关卡，同时产出 GitHub Pages 静态站和微应用 ZIP
npm run build:pages  # 仅静态站，输出到 dist/pages
npm run preview      # 预览静态站
```

`npm run build` 会把 `levels/levels.json`、各关的 `top` / `bottom` / `thumb`、正文片段、`app.js`、`app.css`、`strings.json` 打进 `dist/package/app.zip`。运行时只加载当前关的原图，并预取下一关。

## 发布到 LINUX DO

1. 在社区个人资料的应用页创建应用，复制官方分配的应用 ID。
2. 不要自行使用仓库里的占位 ID。打包时写入真实 ID 与版本号：

```sh
MINI_APP_ID=平台应用ID MINI_APP_VERSION=1.1.0 npm run build:mapp
```

3. 在沙箱页上传 `dist/package/app.zip`，通过后再按指南提审。上传、审核和上线必须在 linux.do 完成，本仓库无法代为注册。

调试包可用 `MINI_APP_DEBUG=1 MINI_APP_ID=... MINI_APP_VERSION=1.1.1 npm run build:mapp` 生成（保留 source map）。

## 说明

- 静态站使用相对路径 `base: './'`，可放到 GitHub Pages 子路径。
- 微应用正文是 `src/template.html` 片段，不含脚本入口或内联事件。
- 在社区加载器中会调用 SDK 的主题、全屏、存储和 `lifecycle.ready()`；独立网页会自动降级为本地模式。
- 包内图片和关卡清单经 SDK `assets.readBytes` / `readJson` 读取；独立运行时从相对路径加载。
