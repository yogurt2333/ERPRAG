"""ECS-only preparation. Does not print secrets, enable services, or start them."""
from pathlib import Path
import grp
import json
import os
import secrets
import shutil
import time
import yaml
from dotenv import dotenv_values, set_key

profile = Path('/var/lib/hermes-erp')
if not profile.is_dir():
    raise SystemExit('Prepare the standalone Hermes home outside the default multiplexer profile directory first')
app = Path('/opt/lean-erp-hermes-test')
env = dotenv_values(profile / '.env')
account = env.get('WEIXIN_ACCOUNT_ID')
if not account or not env.get('WEIXIN_TOKEN'):
    raise SystemExit('Weixin setup is incomplete')
record_path = profile / 'weixin/accounts' / (account + '.json')
if not record_path.is_file():
    raise SystemExit('Matching Weixin account record missing')
owner = json.loads(record_path.read_text()).get('user_id')
if not owner:
    raise SystemExit('Scan owner is unavailable; explicit binding required')
bindings = [{'accountId': account, 'senderId': owner, 'chatId': owner, 'actorId': 'wechat-test-operator'}]
token = env.get('ERP_HERMES_TOKEN') or secrets.token_urlsafe(36)
config_path = profile / 'config.yaml'
backup = profile / 'config.pre-erp-bridge.yaml'
if not backup.exists():
    shutil.copy2(config_path, backup)
config = yaml.safe_load(config_path.read_text()) or {}
config.setdefault('plugins', {})['enabled'] = ['lean-erp']
config['platform_toolsets'] = {'weixin': ['lean_erp']}
config_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
for key, value in {'ERP_HERMES_TOKEN': token, 'ERP_HERMES_BINDINGS': json.dumps(bindings),
                   'ERP_HERMES_PORT': '3101', 'WEIXIN_DM_POLICY': 'allowlist',
                   'WEIXIN_ALLOWED_USERS': owner, 'WEIXIN_GROUP_POLICY': 'disabled',
                   'WEIXIN_TEXT_BATCH_DELAY_SECONDS': '0'}.items():
    set_key(str(profile / '.env'), key, value)
os.chmod(profile / '.env', 0o600)
plugin = profile / 'plugins/lean-erp'
for name in ('__init__.py', 'plugin.yaml', 'schemas.json', 'notify.py'):
    shutil.copy2(app / 'deploy/lean-erp/hermes' / name, plugin / name)
node_modules = app / 'node_modules'
if not node_modules.exists():
    node_modules.symlink_to('/opt/lean-erp/current/node_modules')
config_dir = Path('/etc/lean-erp-hermes-test')
config_dir.mkdir(mode=0o750, exist_ok=True)
gid = grp.getgrnam('lean-erp').gr_gid
os.chown(config_dir, 0, gid)
bridge_env = config_dir / 'environment'
bridge_env.write_text('ERP_DB=/var/lib/lean-erp-hermes-test/erp.sqlite\nERP_HERMES_TOKEN=' + token +
                      '\nERP_HERMES_BINDINGS=\'' + json.dumps(bindings) + '\'\n')
os.chown(bridge_env, 0, gid)
os.chmod(bridge_env, 0o640)
data = Path('/var/lib/lean-erp-hermes-test')
data.mkdir(mode=0o700, exist_ok=True)
import pwd
os.chown(data, pwd.getpwnam('lean-erp').pw_uid, gid)
unit_dir = Path('/etc/systemd/system')
(unit_dir / 'lean-erp-wechat-test.service').write_text('''[Unit]
Description=Isolated ERP Weixin acceptance bridge
After=network.target
[Service]
User=lean-erp
Group=lean-erp
WorkingDirectory=/opt/lean-erp-hermes-test
EnvironmentFile=/etc/lean-erp-hermes-test/environment
ExecStart=/opt/lean-erp/node/bin/node --max-old-space-size=64 deploy/lean-erp/hermes/test-server.ts
Restart=no
MemoryMax=128M
CPUQuota=25%
TasksMax=32
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/lean-erp-hermes-test
InaccessiblePaths=/var/lib/lean-erp
''')
(unit_dir / 'hermes-erp-test.service').write_text('''[Unit]
Description=ERP-only Weixin acceptance gateway
After=network.target lean-erp-wechat-test.service
Requires=lean-erp-wechat-test.service
[Service]
WorkingDirectory=/root/.hermes/hermes-agent
Environment=HERMES_HOME=/var/lib/hermes-erp
Environment=PYTHONDONTWRITEBYTECODE=1
EnvironmentFile=/var/lib/hermes-erp/.env
ExecStart=/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run
Restart=no
MemoryMax=384M
MemorySwapMax=128M
CPUQuota=50%
TasksMax=64
UMask=0077
NoNewPrivileges=true
CapabilityBoundingSet=
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/hermes-erp
InaccessiblePaths=/var/lib/lean-erp /var/lib/lean-erp-hermes-test /etc/lean-erp /etc/lean-erp-hermes-test
''')
print('Dedicated test configuration prepared; operator count=1; services not started')
