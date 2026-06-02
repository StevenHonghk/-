# Edge Autofill Safe

本工具用于普通网页表单的本地自动填充，适合登录信息、报名表、固定字段录入等场景。它不做自动答题，不自动提交表单。

## 安全设计

- 使用 Playwright 本地控制 Microsoft Edge，不安装长期驻留的浏览器扩展。
- 只访问 `allowedOrigins` 中列出的域名。
- 使用独立 `edge-profile`，不读取你的日常 Edge 配置目录。
- 只填字段，不点击提交按钮。
- 填完后停住，等你人工检查和决定是否提交。
- 真实信息放在 `configs/local.json`，该文件默认被 `.gitignore` 忽略。

## 安装

```powershell
cd edge-autofill-safe
npm install
```

如果你的电脑没有安装 Edge，先安装 Microsoft Edge。

## 配置

复制示例配置：

```powershell
Copy-Item configs\example.json configs\local.json
```

编辑 `configs/local.json`：

- `targetUrl`: 要打开的页面。
- `allowedOrigins`: 允许访问的源，例如 `https://example.com`。
- `profileDir`: 独立 Edge 配置目录，保持相对路径。
- `fields`: 要填的字段规则。

字段匹配优先级：

1. `selector`: 精确 CSS 选择器，最稳。
2. `label`: 页面表单标签。
3. `name`
4. `id`
5. `placeholder`
6. `ariaLabel`

## 运行

```powershell
npm start -- --config configs\local.json
```

脚本会打开 Edge、填入配置中的字段，然后在终端等待。你检查页面后，可以自己点击提交；检查完成后回到终端按 Enter 关闭 Edge。

## 建议

- 先用不重要的网站或测试页面试跑。
- 不要把密码、身份证号、银行卡等敏感信息放进共享文件。
- 如果某个页面经常变，优先使用 `label` 或稳定的 `name`，避免脆弱的长 CSS 路径。

## 顺序填空模式

如果不想一个个写 `fields`，可以用顺序填空模式。你只需要输入网址和一组要填的内容，脚本会自动发现页面上的空输入框，然后按浏览器自然遇到输入框的顺序填进去，通常也就是按 Tab 键移动焦点的顺序。

先复制示例：

```powershell
Copy-Item configs\sequence.example.json configs\sequence.json
Copy-Item configs\values.example.txt configs\values.txt
```

编辑 `configs\sequence.json`：

```json
{
  "targetUrl": "https://www.example.com/register",
  "allowedOrigins": [
    "https://www.example.com"
  ],
  "valuesFile": "values.txt",
  "profileDir": "edge-profile",
  "pauseAfterFill": true
}
```

编辑 `configs\values.txt`，一行一个内容：

```txt
张三
13800000000
zhangsan@example.com
某某公司
```

运行：

```powershell
npm run fill-seq -- --config configs\sequence.json
```

重复使用 `configs\values.txt` 再填一次：

```powershell
npm run repeat
```

也可以直接双击 `run-fill-seq.bat` 或 `repeat.bat` 运行。需要改网址和内容时，双击 `edit-sequence-config.bat`。

顺序填空模式会跳过隐藏、禁用、只读、已有内容、密码框、文件上传框、按钮、单选框和复选框。填完后仍然停住让你检查，不会自动提交。

## 填当前打开的标签页

普通 Edge 标签页不能被外部脚本直接接管。要填当前标签页，需要先用调试模式启动一个独立 Edge 窗口：

```powershell
.\start-edge-tab-mode.bat
```

在这个新 Edge 窗口里打开你要填的网站，并确保 `configs\sequence.json` 里的 `allowedOrigins` 包含这个网站的来源。当前标签页模式不会使用 `targetUrl`，只看 `allowedOrigins` 和 `valuesFile`，例如：

```json
{
  "allowedOrigins": [
    "https://example.com"
  ],
  "valuesFile": "values.txt",
  "profileDir": "edge-profile",
  "pauseAfterFill": true
}
```

然后运行：

```powershell
npm run fill-current
```

也可以双击 `fill-current.bat`。如果有多个匹配的标签页，终端会列出来让你选编号。这个模式不会跳转网址，只会在已打开且 `allowedOrigins` 匹配的标签页里填空。

## 油猴脚本

`tampermonkey-sequence-autofill.user.js` 是通用版油猴脚本，支持拖动面板、实时检测空格、清除本次脚本填写内容，以及“豆包网页聊天”辅助。豆包模式不会使用 API Key，也不会直连模型接口；它只打开豆包网页，把提示词放进网页聊天输入框，发送前由你自己检查。

## 上传 GitHub

建议只上传源码和示例配置，不要上传本地依赖、浏览器配置目录或真实填写内容。

不要上传：

- `node_modules/`
- `configs/edge-profile/`
- `configs/current-tab-profile/`
- `configs/local.json`
- `configs/sequence.json`
- `configs/values.txt`

可以上传：

- `src/`
- `test/`
- `configs/example.json`
- `configs/sequence.example.json`
- `configs/values.example.txt`
- `tampermonkey-sequence-autofill.user.js`
- `README.md`
- `TAMPERMONKEY.md`
- `package.json`
- `package-lock.json`
- `.gitignore`
