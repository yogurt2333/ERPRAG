# 本机 ERPNext 开发部署

使用 Frappe 官方基础 Compose + MariaDB/Redis overrides；上游副本和 LICENSE
在 upstream/，来源版本见 source.json。ERPNext 镜像固定 v16.35.0。
local.yaml 仅开放 127.0.0.1:8080，数据库和 Redis 不映射主机端口。

Windows 需 WSL2、Docker Desktop（Linux containers）。管理员执行
scripts/setup-windows-erp.ps1 可安装组件；脚本不自动重启。系统要求重启时先保存工作。
命令行临时代理依照仓库约定设置，不写入本部署配置。Docker 引擎的拉取代理可能
需另行按实际报错配置；不能假定终端代理自动作用于 Docker Desktop。

```powershell
pwsh -File scripts/erpnext.ps1 -Action init
pwsh -File scripts/erpnext.ps1 -Action start
pwsh -File scripts/erpnext.ps1 -Action status
```

用户名 Administrator，随机密码在被 git 忽略的 private/erpnext.env。
站点名 erprag.localhost；预期浏览器入口 http://127.0.0.1:8080。
init 不覆盖已有密码。start 遇到不完整站点会停止，不自动删除或重建业务数据。
stop 保留数据卷；脚本不提供删除数据卷功能。

验收须实际确认：Docker engine 可用、服务健康、ERPNext app 已安装、HTTP ping
和登录页可用。配置文件存在不代表部署完成。公司/会计配置尚未确定时不伪造初始化。

## 本机验证结果

2026-09-25 已在 Windows 10 + Docker Desktop 4.91.0 上完成验证：

- 站点 `erprag.localhost` 已创建，Frappe/ERPNext 均为 `16.35.0`
- MariaDB 健康，Redis、Web、WebSocket、Worker 和 Scheduler 容器运行
- `bench doctor` 报告 2 个 Worker 在线，站点 Scheduler 已启用
- `http://127.0.0.1:8080/api/method/ping` 返回 HTTP 200 和 `pong`
- `http://127.0.0.1:8080/login` 返回 HTTP 200

首次启动 Docker 的 WSL2 虚拟机曾因 HCS `0x800705aa` 失败。本机通过用户级
`%USERPROFILE%/.wslconfig` 将 WSL2 限制为 4 GB 内存、2 核、4 GB Swap 后解决。
该文件是机器级开发环境配置，不进入仓库；修改后需执行 `wsl --shutdown` 并重启
Docker Desktop。

官方来源：https://github.com/frappe/frappe_docker
