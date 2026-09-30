# 小内存 ECS 部署

本目录是已有 Web/PWA 的运行部署，不是工单 14 的资源容量验收。
服务器已有其他服务，每次变更前都必须重新评估内存；不能依据一次空载快照宣称不会 OOM。

## 打包与初次安装

本机先准备项目依赖，然后运行：

```bash
node deploy/lean-erp/prepare-release.mjs
```

脚本按白名单复制 `src/erp` 和本目录 runtime lock 中的 27 个依赖，核对版本，拒绝
已知平台原生二进制，生成约 1 MB gzip 包与 SHA-256。不会打包 `.git`、本地数据库、
原始 ERP 导出、模型配置或云凭证。依赖升级时必须同步本目录的独立锁文件。

把包上传到服务器并校验 SHA-256，然后提取 `ops/install-initial.sh`，在受限的
临时 systemd 单元中运行它。示例：

```bash
systemd-run --unit=lean-erp-initial-install --wait --pipe \
  -p MemoryMax=128M -p CPUQuota=50% -p Nice=10 -p OOMScoreAdjust=500 \
  /bin/bash /tmp/install-initial.sh /tmp/release.tar.gz SHA256 https://ERP_HOST
```

替换三个参数，先确认目录/端口没有冲突。该脚本只允许初次安装；已有数据库或 current
链接时会拒绝，不能把它当作升级/重置脚本。升级前需一致性备份并评估迁移，不可只切回
旧代码而忽略数据库版本。

服务器不运行 npm、编译或构建镜像。Node 24 Linux x64 从 nodejs.org 下载，依据官方
SHASUMS256 校验，独立安装到 `/opt/lean-erp/runtime`，不替换已有 Node。
解压前和启动前均要求至少 768 MiB `MemAvailable`。

## 服务边界

| 项目 | 配置 |
|---|---|
| 运行用户 | `lean-erp`，无登录 Shell |
| 代码 | `/opt/lean-erp/releases`，`current` 链接 |
| 数据 | `/var/lib/lean-erp/erp.sqlite`，目录权限 0700 |
| 配置 | `/etc/lean-erp/environment`，root:lean-erp 0640 |
| 监听 | 仅 `127.0.0.1:3100` |
| Node 堆 | 64 MiB |
| 整个 ERP 服务 | MemoryMax=192M、CPUQuota=50%、OOMScoreAdjust=500 |
| 启动守卫 | 每次启动检查 MemAvailable 至少 768 MiB |
| 重试 | 300 秒内最多启动三次，避免故障循环 |

内存不足时守卫会拒绝启动；应先调查现有负载，不能通过移除限额强行启动。
systemd 的组内限额不是整机预留量，也不代表重业务数据下的容量证明。

## HTTPS 与续期

主域名已有网站时，新增独立子域名，不替换原站点。
将固定版本 [acme.sh 3.1.6](https://github.com/acmesh-official/acme.sh/releases/tag/3.1.6)
的 `acme.sh` 与 `ops/` 放在同一个临时目录。脚本期望 SHA-256 为
`c7d68b021cfd6380ea83a82962abde5b484779fee0b97d38681dfa1396bbc8d7`。

1. 在 64M 内存上限的临时单元中运行 `ops/configure-http.sh ERP_HOST`。
2. 从公网确认 `http://ERP_HOST/.well-known/acme-challenge/deployment-probe`
   返回 `lean-erp-acme-ready`，且 DNS 指向目标服务器。
3. 在相同限额下运行 `ops/issue-https.sh ERP_HOST`，申请 Let's Encrypt ECC 证书。
4. 确认 HTTPS、原站点、未登录 API 401，以及定时器均正常。

采用官方说明中的 [webroot 验证](https://github.com/acmesh-official/acme.sh/wiki/How-to-issue-a-cert)，
无需安装 Python/Certbot 依赖。Nginx 配置修改先 `nginx -t`，随后平滑 reload；等待新
worker 接管后再做探测。HTTP 与 HTTPS 文件仅包含 ERP 的独立 server 块。
证书私钥在 `/etc/lean-erp/tls`，ACME 账户在 `/var/lib/lean-erp-acme-account`，均为 root 私有目录。
脚本固定版本，无自动升级；续期 timer 每天检查两次，要求至少 640 MiB 可用内存，
进程最多 64M。通过 `systemctl start lean-erp-cert-renew.service` 可验证一次到期检查；
“尚未到期”的成功结果不等于已经完成将来的真实续签演练。

## 首次注册

在服务器终端运行 `lean-erp-bootstrap 操作员姓名`，或者通过本机 Workbench 执行此命令。
辅助程序先检查内存，再用最大 128M 的临时单元生成十分钟一次性凭证。
将凭证填入 HTTPS 页面“首次启用 / 接受邀请”，在自己的设备上完成 Passkey 注册，
保存恢复码并添加备用凭据。辅助程序不会在磁盘另存凭证明文；不要把输出转发到聊天或日志。

## 运维检查

```bash
free -m
systemctl show lean-erp -p MemoryCurrent -p MemoryMax -p NRestarts
systemctl status lean-erp --no-pager
systemctl list-timers lean-erp-cert-renew.timer
```

停止试运行只需 `systemctl stop lean-erp`。保留数据与证书，不能删除数据库来“重置登录”。
当前还没有工单 13 的加密异地备份、恢复演练或归档能力，不应把这次网页部署视为正式账本上线验收。
