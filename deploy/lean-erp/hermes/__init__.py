"""Hermes v2026.9.24 and ECS 7cd48733db hook compatibility.

Only the trusted inbound hook can acquire a proposal capability. No generic agent
loop, shell, database, transcript history or model-generated confirmation is used.
"""
import asyncio
import contextvars
import hashlib
import json
import os
import urllib.request

_active = contextvars.ContextVar("erp_message", default=None)


def rpc(route, data):
    # Loopback is deliberately exempt from ambient HTTP proxies.
    port = int(os.environ.get("ERP_HERMES_PORT", "3101"))
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/{route}",
        json.dumps(data, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["ERP_HERMES_TOKEN"]},
    )
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=15) as response:
        return json.load(response)


async def send_text(adapter, chat_id, text, delivery_id):
    # Bypass send()'s MEDIA/local-file extraction. ERP names are untrusted text.
    # Fixed client IDs survive retries; iLink end-to-end dedupe is NOT assumed.
    from gateway.platforms.weixin import _send_message
    token = adapter._token_store.get(adapter._account_id, chat_id)
    parts = [text[i:i + 1500] for i in range(0, len(text), 1500)]
    for index, part in enumerate(parts):
        client_id = "erp-" + hashlib.sha256(f"{delivery_id}:{index}".encode()).hexdigest()[:40]
        result = await asyncio.wait_for(_send_message(
            adapter._send_session, base_url=adapter._base_url, token=adapter._token,
            to=chat_id, text=f"[{index + 1}/{len(parts)}] {part}", context_token=token, client_id=client_id,
        ), 20)
        if result.get("ret", 0) not in (0, None) or result.get("errcode", 0) not in (0, None):
            raise RuntimeError("Weixin delivery failed")


class IdentityOnlyDedup:
    """Same text with DIFFERENT message IDs is a new human action (e.g. 确认)."""
    def __init__(self, original):
        self.original = original

    def is_duplicate(self, key):
        return False if key.startswith("content:") else self.original.is_duplicate(key)


def register(ctx):
    # Deployment must set identical bindings in ERP and this dedicated gateway.
    bindings = json.loads(os.environ["ERP_HERMES_BINDINGS"])
    locks = {}
    tasks = set()

    def proposal(kind, params):
        message = _active.get()
        if message is None:
            raise PermissionError("ERP tools require a bound inbound Weixin event")
        return rpc("complete", {"message": message, "command": {"kind": kind, "input": params}})

    # Schemas are exported from the same TypeScript validators, never hand-copied.
    with open(os.path.join(os.path.dirname(__file__), "schemas.json"), encoding="utf-8") as source:
        schemas = json.load(source)
    handlers = {}
    for variant in schemas["anyOf"]:
        kind = variant["properties"]["kind"]["const"]
        def handle(params, _kind=kind, **kwargs):
            return json.dumps(proposal(_kind, params), ensure_ascii=False)
        handlers[kind] = handle
        ctx.register_tool(name="erp_" + kind, toolset="lean_erp", schema={
            "name": "erp_" + kind, "description": "Propose a validated ERP draft; never posts. Bound Weixin only.",
            "parameters": variant["properties"]["input"],
        }, handler=handle)

    async def on_message(event, gateway, session_store=None, **kwargs):
        src = event.source
        if getattr(src.platform, "value", src.platform) != "weixin":
            return None
        # Hook runs BEFORE Hermes auth. Every Weixin path must fail closed here.
        skip = {"action": "skip", "reason": "lean-erp-owned-weixin"}
        adapter = gateway.adapters.get(src.platform)
        try:
            account = adapter._account_id
            allowed = any(b["accountId"] == account and b["senderId"] == src.user_id and
                          b["chatId"] == src.chat_id for b in bindings)
            if not allowed or src.chat_type != "dm" or event.media_urls or not event.message_id:
                return skip
            if not isinstance(adapter._dedup, IdentityOnlyDedup):
                adapter._dedup = IdentityOnlyDedup(adapter._dedup)
            message = {"accountId": account, "senderId": src.user_id, "chatId": src.chat_id,
                       "messageId": str(event.message_id), "text": event.text}
            key = (account, src.user_id, src.chat_id)
            async with locks.setdefault(key, asyncio.Lock()):
                reply = await asyncio.to_thread(rpc, "prepare", message)
                if reply["status"] == "planning":
                    try:
                        # Some configured providers reject response_format, even
                        # for a trivial schema. Request JSON as text and enforce
                        # the authoritative schema at the ERP boundary instead.
                        result = await asyncio.wait_for(ctx.llm.acomplete(
                            messages=[{"role": "system", "content": reply["context"]["instructions"] +
                                " Return only JSON matching this schema (or null if information is missing): " + json.dumps(reply["schema"])},
                                {"role": "user", "content": json.dumps(reply["context"], ensure_ascii=False)}],
                            max_tokens=3000, temperature=0,
                            purpose="lean-erp.extract-draft",
                        ), 30)
                        plan = json.loads(result.text)
                    except Exception:
                        plan = None
                    if isinstance(plan, dict) and plan.get("kind") in handlers:
                        cap = _active.set(message)
                        try:
                            reply = json.loads(await asyncio.to_thread(handlers[plan["kind"]], plan.get("input")))
                        finally:
                            _active.reset(cap)
                    else:
                        reply = await asyncio.to_thread(rpc, "complete", {"message": message, "command": None})
                await send_text(adapter, src.chat_id, reply["text"], json.dumps([account, src.chat_id, event.message_id]))
                await asyncio.to_thread(rpc, "displayed", message)
        except Exception:
            # Never let an exception fall through into a general-purpose agent.
            # No raw messages, credentials, or provider exception text are logged.
            try:
                await send_text(adapter, src.chat_id, "ERP 暂不可用，未确认成功。请使用 Web 核对或重试原消息。", "error:" + str(event.message_id))
            except Exception:
                pass
        return skip

    def dispatch(event, gateway, session_store=None, **kwargs):
        # The deployed July-derived build invokes callbacks synchronously on the
        # gateway loop. Return skip NOW and own the async work on that same loop.
        # This also works with v2026.9.24's async-aware hook dispatcher.
        if getattr(event.source.platform, "value", event.source.platform) != "weixin":
            return None
        try:
            if len(tasks) < 8:
                task = asyncio.get_running_loop().create_task(on_message(event, gateway, session_store, **kwargs))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        except Exception:
            pass
        return {"action": "skip", "reason": "lean-erp-owned-weixin"}

    ctx.register_hook("pre_gateway_dispatch", dispatch)
