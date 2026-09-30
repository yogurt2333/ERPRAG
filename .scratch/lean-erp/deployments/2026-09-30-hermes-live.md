# 2026-09-30 ERP 微信独立测试运行

状态：已连接，真实采购草稿已生成；人工更正/确认及销售、通知验收尚待完成。

## 隔离范围

- Hermes SHA：`7cd48733db464471cf7da9501c12748ed9b570dc`。
- 原主网关 runtime status 实际托管 `default`、`family`；新建命名 profile 的启动守卫
  仍统一拒绝。因此将整个 ERP home 从 `/root/.hermes/profiles/erp` 移至
  `/var/lib/hermes-erp`，不留 profiles 下的链接、不使用 `--force`，防止主网关今后扫描到它。
- 模型和扫码登录信息保留原文件，未输出凭据或复制到仓库。以保存的扫码者 user_id
  绑定一个 `wechat-test-operator`；只允许该 DM，群聊关闭。
- 原 `lean-erp.service`、`hermes-slate-gateway.service` 保持 active，没有重启。
- 独立代码 `/opt/lean-erp-hermes-test`，独立账库 `/var/lib/lean-erp-hermes-test/erp.sqlite`。
- 测试桥接 `lean-erp-wechat-test.service`：loopback 3101，MemoryMax=128M、CPUQuota=25%。
- 专用网关 `hermes-erp-test.service`：MemoryMax=384M、MemorySwapMax=128M、CPUQuota=50%。
  丢弃 capabilities，设置只读系统和原/测试 ERP 数据目录不可访问，仅 home 可写。
- 两个新服务未设置开机自启；通知 sender 尚未启动。测试账库主数据仅含
  测试饮料、测试供应商、测试客户、测试仓。

## 诊断与证据

1. Workbench upload 的 OSS 内网通道不可达；通过已有 exec 通道分块传输白名单代码包，
   服务端 SHA-256 校验通过。没有打包数据库、云凭据或 Hermes 配置。
2. 启动前 MemAvailable 约 938 MiB；网关启动后 MemoryCurrent 约 319 MiB，
   MemAvailable 约 711 MiB。这只是启动观测，不是资源容量或长期运行证明。
3. runtime status 确认 `gateway_state=running`、`weixin.state=connected`，
   hook 实际记录 `lean-erp-owned-weixin`，四个业务/网关服务均 active。
4. 首轮消息被拒绝、采购数为零。最小模型调用复现 HTTP 400，错误涉及
   `response_format`。改用 `ctx.llm.acomplete` 普通文本、严格 JSON 解码、ERP 本地 schema
   验证；再次真实调用返回有效 `{"ok":true}`。没有放宽业务校验，也没有更换模型。
5. 用户再次发出合成采购消息后，真实 SQLite 事件状态为 `done/draft`，采购单数仍为零。
   这证明微信入站、真实模型解析和草稿生成，尚不代表完成采购入账验收。
6. 本轮 Python 插件回归 8/8、TypeScript typecheck、diff check 通过。

下一步由操作员在微信核对草稿，执行更正和明确确认，然后核对账库一次入账。
不在此文件保存微信账号、消息正文、token 或模型凭据。

### 中文业务单据展示修复（2026-09-30）

微信草稿、入账回执、待办与周报由确定性中文格式化器生成，隐藏 JSON、UUID 和内部状态，金额显示元。新增“查看草稿”，只展示当前待确认版本，不新建或入账；历史消息重试使用保存的结果转为中文。仍须全部发送成功后才允许确认。

验证：TypeScript 类型检查通过；全量 Node 122/122、Hermes Python 8/8 通过。三个展示相关文件经 SHA256 校验部署到独立测试目录，两个测试服务 active/running，NRestarts=0，桥接端口未认证访问返回401。尚待用户在真实微信发送“查看草稿”确认显示效果；不据此宣称完整采购/销售验收已完成。

### 真实微信采购确认及重复确认（2026-09-30）

用户确认中文草稿可读，并核对修改后的8瓶、24元草稿后连续发送两次确认。只读检查独立测试账库：两条确认事件均 done/posted、版本2，返回同一个采购单；receipts 总数1，数量8瓶、金额2400分。真实采购更正、明确确认及连续重复确认未重复入账这一场景通过。此证据不覆盖销售、通知投递或完整工单验收。用户反馈单据仍需提高首屏可扫读性，列为后续展示结构优化。

### 真实微信销售订单及重复确认（2026-09-30）

用户核对测试客户、测试饮料2瓶、总价10元的销售订单草稿后连续确认两次。以只读事务检查独立测试账库：最近两条确认均 done/posted、版本3，返回相同订单；sales_orders总数1，订单状态open、revision=1，2瓶、1000分。deliveries与settlements均为0；按库存台账精确分数汇总，测试仓测试饮料仍为8瓶，冲销、退货及库存调整均为0。销售订单确认及重复确认未重复生成、未提前扣库存场景通过；实际交货与收款仍待验收。

### 真实微信交货并收款及重复确认（2026-09-30）

用户核对交货2瓶、货款10元、实收10元后连续两次确认。只读事务核验：最近两条确认均done/posted、版本4，返回同一业务操作；交货单1张、收款记录1条，收款1000分全部核销本次交货，预收0分，应收剩余0分。精确库存台账汇总为测试饮料6瓶；冲销、退货、库存调整、退款均0条。真实微信交货并收款、重复确认未重复扣库存或收款场景通过。回执成本600分、经营毛利400分（未扣税费及经营开支）。通知真实投递等剩余验收不由本结果覆盖。

### 真实通知发送及复跑（2026-09-30）

新增notify.py --once，单批发送后退出，失败非零退出；原常驻模式保留。Python插件测试8/8通过。ECS启动前可用内存606MiB；单次发送器设置MemoryMax=256M、MemorySwapMax=64M、CPUQuota=25%、RuntimeMaxSec=120、只读系统和测试账库不可访问。仅通过桥接API调度与ACK，不调用模型。

第一次发送进程成功退出：2条immediate、1条daily、1条weekly均delivered=1，pending=0。第二次新进程复跑成功，待人工确认微信端三类均可见；不以API成功代替用户收件确认。未启用常驻sender或开机自启。

用户已确认“待办提醒”“每日待办”“每周经营汇总”三类均收到。第二次复跑后只读复核：notification_total=4、acknowledged=4、pending=0，未新增未变化事项。三类真实投递及本次复跑去重验收通过。

### 真实微信销售草稿修改（2026-09-30）

用户核对并确认：销售草稿v5为1瓶500分，更正v6为2瓶900分，确认返回posted/v6。只读事务核验最新订单2瓶900分，销售订单总数2（原订单1+本次1），交货单仍1、收款记录仍1、客户收款累计1000分；精确库存仍6瓶。采购与销售的提出、展示、更正、明确确认、结果完整循环均具备真实微信证据。

### Web无远程模型网络依赖验收（2026-09-30）

新增Web HTTP采购验收测试：测试通行密钥签名注册、主数据草稿/确认、采购草稿/确认/同事件重放，验证只有一张2瓶600分采购单、库存2瓶、应付600分、审计channel=web。本地typecheck及该测试通过。

ECS使用已有生产Web源码的副本及测试ERP核心，在systemd PrivateNetwork=yes、PrivateTmp=yes、User=lean-erp、ProtectSystem=strict、MemoryMax=192M、RuntimeMaxSec=90下运行，同一验收1/1通过。独立网络命名空间仅有回环，无法访问宿主Hermes或远程模型；数据为临时新建账库，不修改微信测试及正式账库。首次因测试目录缺Web源码失败，补充生产代码副本后成功。本证据为服务端HTTP与密码学测试凭证验证，不是真人浏览器Passkey或生产账号操作证据。

### 网关重启后重复确认（2026-09-30）

专用网关于北京时间14:27:50重新进入active/running；其后用户再次确认，事件createdAtMs=1790749919352，返回原版本6、原销售订单（2瓶900分），与重启前确认的业务ID相同。只读事务检查：sales_orders=2、deliveries=1、settlements=1、客户收款累计1000分、库存6瓶，均未增加；NRestarts=0（无自动失败重启）。本场景证明主动重启后入站处理恢复及新消息重复确认幂等，不代表任意断网期间消息零丢失或发送/ACK间故障均完成真实验收。

### 工单11功能验收收尾（2026-09-30）

最终本地typecheck、123/123 Node测试、8/8 Python插件测试及git diff --check通过（只有既有CRLF转换提示）。工单所有功能验收条目已有脚本或上述真实环境证据，标记completed。未提交Git或推送；正式发布、常驻通知、开机自启、容量/长稳验收未完成。用户提出的首屏易扫读和无需复制内部订单编号列为后续体验优化。
