# InnerOS Windows 桌面版

独立 Electron 应用，自带 Chromium 运行时，不依赖已安装的 Edge/Chrome。连接 `https://inneros.pages.dev/`，复用现有网页、Cookie 登录与云同步，无需运行 Python 本地服务。

## 使用

- `InnerOS-1.30.0-portable.exe`：免安装，双击运行。
- `InnerOS-1.30.0-setup.exe`：安装版，可选择安装目录并创建桌面入口。
- 登录原账户后拉取云端记录。浏览器中的未同步记录和本地照片原图不会自动迁入，请先在原浏览器同步并备份。
- 数据位于 `%APPDATA%/InnerOS`；退出与升级不主动清空数据。网页随线上部署更新，桌面运行时需手动下载新版。
- 首次打开及冷启动需要网络；此版尚无离线启动保证。网络或页面进程异常时提供重试。
- 当前产物未签名，Windows 可能显示未知发布者提示。

## 开发与打包

```powershell
cd desktop
npm ci
npm start
npm run smoke
npm run dist
```

产物位于 `desktop/dist/`，不提交 Git。锁文件固定依赖；发版前应检查 Electron 安全更新。`INNEROS_SMOKE_REPORT` 可指定冒烟测试 JSON 报告绝对路径；测试使用临时独立数据目录，不读取真实账户。

远程网页关闭 Node 集成、启用上下文隔离与沙箱，不提供原生桥。应用窗口只允许同源 HTTPS 导航，其他 HTTP(S) 链接交给默认浏览器，拒绝其他协议与设备权限；仅允许同源写剪贴板以保留分享复制功能。
