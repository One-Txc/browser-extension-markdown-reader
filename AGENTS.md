# 项目约定

给在本仓库工作的 AI 助手与协作者的约定。**以下规则优先于通用习惯。**

---

## 国际化（i18n）

**每次加功能都必须考虑国际化，但只维护简体中文这一份。**

### 要做的

1. 新出现的用户可见文案，**加进 `_locales/zh_CN/messages.json`**
2. 每条都要写 `description` —— 按「位置 · 作用」描述，并注明长度约束、
   不译项、占位符含义（格式参照文件里已有的条目）
3. 代码里一律通过 `t('key')` 取用，**不要在代码里写中文字面量**
4. HTML 里的静态文案用 `data-i18n="key"` 标记（见 `src/popup/popup.html`）

### 不要做的

- **不要**顺手同步 `en` / `ja` / `ko`
- **不要**为了「保持文件整齐」去补其他语言的 key
- 其他语言会在明确要求时才同步

### 理由

`zh_CN` 是文案的原始出处，也是唯一需要维护的一份。
其他语言的同步需要母语者参与，属于独立动作，不该混在功能开发里。

### 配套机制（已就位，无需每次处理）

- `t()` 在目标语言缺 key 时会**回退到 `zh_CN`**，再缺才返回 key 本身。
  所以只加中文不会让其他语言界面出现裸露的 key
- `TRANSLATING.md` 是给贡献者的翻译指南
- `scripts/check-locales.py` 校验语言包。**以 `zh_CN` 为基准**：
  其他语言缺 key 只警告，不影响通过 —— 这样「只加中文」不会卡住构建
- 加新语言时只需改 `src/shared/i18n.ts` 一处（`Locale`、`LOCALES`、`TABLES`），
  `settings.ts` 用 `LOCALES.includes()` 校验，无需改

---

## 开发与验证

```bash
npm run check        # 类型检查 + 测试 + 构建（Chrome）
npm run build        # 只构建 Chrome  → output/MV3
npm run build:firefox # 构建 Firefox  → output/MV2
```

- **类型检查 / 测试 / 构建由助手负责**
- **任何视觉、布局、交互手感相关的验证必须由用户在实际浏览器里完成**
  （本项目的测试跑在 jsdom 里，看不到样式与布局）
- 提交前跑一次 `npm run check`；改了 `_locales/` 再跑一次
  `python scripts/check-locales.py`

### 发布

```bash
npm run release       # 构建两个目标 + 打包成 zip（默认，快）
npm run release:full  # 先跑类型检查 / 测试 / 语言包校验，再执行上面那步
```

**校验默认不做**是有意的：改点文案、调个样式再出一版，不必每次都等一遍完整测试。
**上架前跑 `release:full`**，平时出包用 `release`。

产物在 `dist/`，文件名带版本号与目标平台。两条命令都会走 `build:all` ——
这一点很要紧：只跑 `npm run build` 会让 `output/MV2` 停在旧产物，
而它照样会被打进 zip，上传后 Firefox 用户拿到的是过时代码。

### 改产物时留意

- Chrome 加载 `output/MV3`，Firefox 加载 `output/MV2`
- 构建产物必须是**纯 ASCII**（扩展脚本的编码检查比「合法 UTF-8」更严），
  构建脚本会在出现非 ASCII 时直接失败；中文在产物里表现为 `\uXXXX`
- `_locales/` 会被复制进扩展包，**不要把说明文档之类的文件放进去**
- `messages.json` 里每个键都必须是合法的消息条目（对象且含 `message`），
  否则 Chrome 会拒绝加载整个扩展

---

## Git 与远程

**用户没有明确说「推送」时，不要执行 `git push`。**

- 本地提交照常做：完成一个改动就提交，这是工作记录
- **推送到 `origin` 必须由用户明确要求**，不要顺手带上，也不要在
  「顺便同步一下」之类的判断下自行决定
- 这条是因为该仓库的用途是**私人备份**，不是对外协作。推送时机由用户掌握，
  他可能想先攒几个提交、先自己看一眼、或者先改点东西再一起推

### 网络说明（供参考，不是要求）

这台机器访问 `github.com` 的 443 端口会被 **TLS SNI 阻断**（TCP 能连、
一握手就 RST），表现为 `Failed to connect` 或 `Connection was reset`。
DNS 也可能被解析到不通的 IP（`20.205.243.166`）。

临时绕过（**用完即弃，不要写进任何配置文件**）：

```bash
git -c http.curloptResolve="github.com:443:140.82.112.3" push
```

可用 IP 会变，先用 `Test-NetConnection <ip> -Port 443` 挑一个通的。
**最省事的办法是让用户开代理**，不要为此长期留下全局或仓库级配置。

---

## 文档语言

代码注释、提交信息、与用户交流一律用中文。
