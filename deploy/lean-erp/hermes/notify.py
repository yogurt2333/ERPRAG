"""Run one sender under the selected Hermes venv. No model or ERP database access."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location("lean_erp", Path(__file__).with_name("__init__.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


async def drain(adapter):
    result = await asyncio.to_thread(bridge.rpc, "notifications", {})
    target = result["target"]
    if target["accountId"] != adapter._account_id:
        raise RuntimeError("Notification account mismatch")
    for event in result["events"]:
        await bridge.send_text(adapter, target["chatId"], event["text"], event["id"])
        await asyncio.to_thread(bridge.rpc, "ack", {"id": event["id"]})


async def main(once=False):
    from gateway.platforms import weixin
    from gateway.platforms.weixin import WeixinAdapter, ContextTokenStore
    from gateway.config import PlatformConfig
    from hermes_constants import get_hermes_home
    account = os.environ["WEIXIN_ACCOUNT_ID"]
    adapter = WeixinAdapter(PlatformConfig(enabled=True, token=os.environ["WEIXIN_TOKEN"], extra={"account_id": account}))
    adapter._token_store = ContextTokenStore(str(get_hermes_home()))
    # The deployed July-derived build predates _new_session.
    import aiohttp
    session_factory = getattr(weixin, "_new_session", None)
    session_context = session_factory() if session_factory else aiohttp.ClientSession(
        trust_env=True, connector=weixin._make_ssl_connector())
    async with session_context as session:
        adapter._send_session = session
        if once:
            adapter._token_store.restore(account)
            await drain(adapter)
            print("ERP notification batch acknowledged", flush=True)
            return
        while True:
            try:
                adapter._token_store.restore(account)
                await drain(adapter)
            except Exception:
                print("ERP notification delivery pending; retrying", flush=True)
            await asyncio.sleep(60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Send one pending batch and exit; failures return nonzero")
    asyncio.run(main(parser.parse_args().once))
