# Windows 打包说明

本项目已经配置好 Electron 和 electron-builder。Linux 环境生成 Windows NSIS 安装器需要 wine；如果不想安装 wine，请在 Windows 机器上按下面步骤打包。

## 环境要求

- Windows 10 / 11
- Node.js 20 或更高版本
- npm

## 打包步骤

在 Windows PowerShell 中进入项目目录：

```powershell
cd path\to\novel
```

安装依赖：

```powershell
npm install
```

运行测试：

```powershell
npm test
```

生成 Windows 安装包：

```powershell
npm run dist:win
```

打包完成后，安装包会出现在：

```text
dist\
```

通常会生成类似下面的文件：

```text
dist\长篇小说上下文管理 Setup 0.1.0.exe
```

## 本地预览

打包前可以先启动桌面应用预览：

```powershell
npm start
```

## 便携版

如果只想生成免安装版本：

```powershell
npm run dist:win:portable
```

产物同样在 `dist\` 目录。

## 注意

- 当前应用未配置代码签名证书，所以 Windows 可能提示“未知发布者”。这是未签名应用的正常提示。
- 打包配置在 `package.json` 的 `build` 字段中。
- 应用入口是 `electron/main.cjs`，网页资源是 `index.html`、`styles.css` 和 `src/`。
