"""Offline Hermes hook contract tests. No real model or Weixin connection."""
import importlib.util
import asyncio
import json
import os
import sys
from pathlib import Path
import types
import unittest
from unittest.mock import patch

path = Path(__file__).parents[1] / "deploy/lean-erp/hermes/__init__.py"
spec = importlib.util.spec_from_file_location("erp_plugin", path)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)
binding = {"accountId": "bot", "senderId": "owner", "chatId": "owner", "actorId": "operator"}


class Context:
    def __init__(self):
        self.tools = {}
        self.hook = None
        self.calls = 0
        self.llm = self

    def register_tool(self, **tool):
        self.tools[tool["name"]] = tool

    def register_hook(self, name, handler):
        self.raw_hook = handler
        async def invoke(*args):
            before = asyncio.all_tasks()
            reply = handler(*args)
            added = asyncio.all_tasks() - before
            if added:
                await asyncio.gather(*added)
            return reply
        self.hook = invoke

    async def acomplete(self, **kwargs):
        assert 'json_schema' not in kwargs and 'response_format' not in kwargs
        self.calls += 1
        return types.SimpleNamespace(text=json.dumps({"kind": "purchase_receipt", "input": {"lines": []}}))


class Hooks(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ctx = Context()
        with patch.dict(os.environ, {"ERP_HERMES_BINDINGS": json.dumps([binding])}):
            plugin.register(self.ctx)
        self.adapter = types.SimpleNamespace(_account_id="bot", _dedup=types.SimpleNamespace(is_duplicate=lambda key: True))
        self.gateway = types.SimpleNamespace(adapters={"weixin": self.adapter})
        self.event = types.SimpleNamespace(source=types.SimpleNamespace(platform="weixin", user_id="owner", chat_id="owner", chat_type="dm"),
                                          media_urls=[], message_id="123", text="确认")

    async def test_plain_confirmation_bypasses_model_and_acks_after_full_delivery(self):
        calls = []
        def rpc(route, value):
            calls.append(route)
            return {"status": "posted", "text": "已入账"}
        async def send(*args):
            calls.append("send")
        with patch.object(plugin, "rpc", rpc), patch.object(plugin, "send_text", send):
            self.assertEqual((await self.ctx.hook(self.event, self.gateway))["action"], "skip")
        self.assertEqual(calls, ["prepare", "send", "displayed"])
        self.assertEqual(self.ctx.calls, 0)
        self.assertFalse(self.adapter._dedup.is_duplicate("content:owner:same-confirm"))
        self.assertTrue(self.adapter._dedup.is_duplicate("message-id"))

    async def test_registered_proposal_only_has_capability_during_bound_extraction(self):
        tool = self.ctx.tools["erp_purchase_receipt"]
        with self.assertRaises(PermissionError):
            tool["handler"]({})
        calls = []
        def rpc(route, value):
            calls.append((route, value))
            if route == "prepare":
                return {"status": "planning", "context": {"instructions": "extract"}, "schema": {}}
            return {"status": "draft", "text": "完整草稿"}
        async def send(*args):
            pass
        with patch.object(plugin, "rpc", rpc), patch.object(plugin, "send_text", send):
            await self.ctx.hook(self.event, self.gateway)
        self.assertEqual([c[0] for c in calls], ["prepare", "complete", "displayed"])
        self.assertEqual(calls[1][1]["message"]["messageId"], "123")
        self.assertEqual(self.ctx.calls, 1)
        self.assertNotIn("erp_confirm", self.ctx.tools)

    async def test_unbound_and_group_events_never_call_rpc_or_model(self):
        with patch.object(plugin, "rpc", side_effect=AssertionError("unauthorized RPC")):
            self.event.source.user_id = "stranger"
            self.assertEqual((await self.ctx.hook(self.event, self.gateway))["action"], "skip")
            self.event.source.user_id = "owner"
            self.event.source.chat_type = "group"
            self.assertEqual((await self.ctx.hook(self.event, self.gateway))["action"], "skip")
        self.assertEqual(self.ctx.calls, 0)

    async def test_send_failure_never_acknowledges_and_never_falls_through_to_agent(self):
        calls = []
        def rpc(route, value):
            calls.append(route)
            return {"status": "draft", "text": "草稿"}
        async def fail(*args):
            raise RuntimeError("offline")
        with patch.object(plugin, "rpc", rpc), patch.object(plugin, "send_text", fail):
            self.assertEqual((await self.ctx.hook(self.event, self.gateway))["action"], "skip")
        self.assertEqual(calls, ["prepare"])

    async def test_provider_failure_completes_without_posting(self):
        calls = []
        async def fail(**kwargs):
            raise RuntimeError("provider offline")
        self.ctx.acomplete = fail
        def rpc(route, value):
            calls.append((route, value))
            return {"status": "planning", "context": {"instructions": "extract"}, "schema": {}} if route == "prepare" else {"status": "rejected", "text": "未入账"}
        async def send(*args):
            pass
        with patch.object(plugin, "rpc", rpc), patch.object(plugin, "send_text", send):
            self.assertEqual((await self.ctx.hook(self.event, self.gateway))["action"], "skip")
        self.assertIsNone(calls[1][1]["command"])

    async def test_raw_text_sender_uses_stable_ids_and_never_interprets_media(self):
        calls = []
        async def transport(session, **kwargs):
            calls.append(kwargs)
            return {"ret": 0}
        adapter = types.SimpleNamespace(_account_id="bot", _token="secret", _base_url="https://example.invalid",
            _send_session=object(), _token_store=types.SimpleNamespace(get=lambda account, peer: "context"))
        with patch.dict(sys.modules, {"gateway.platforms.weixin": types.SimpleNamespace(_send_message=transport)}):
            await plugin.send_text(adapter, "owner", "MEDIA:/private/file", "event-1")
            await plugin.send_text(adapter, "owner", "MEDIA:/private/file", "event-1")
        self.assertEqual(calls[0]["client_id"], calls[1]["client_id"])
        self.assertIn("MEDIA:/private/file", calls[0]["text"])
        self.assertEqual(calls[0]["context_token"], "context")

    async def test_non_json_model_text_is_rejected_without_tool_execution(self):
        async def malformed(**kwargs):
            return types.SimpleNamespace(text='The purchase is confirmed!')
        self.ctx.acomplete = malformed
        calls = []
        def rpc(route, value):
            calls.append((route, value))
            return {"status": "planning", "context": {"instructions": "extract"}, "schema": {}} if route == "prepare" else {"status": "rejected", "text": "未入账"}
        async def send(*args):
            pass
        with patch.object(plugin, "rpc", rpc), patch.object(plugin, "send_text", send):
            await self.ctx.hook(self.event, self.gateway)
        self.assertIsNone(calls[1][1]['command'])

    async def test_notification_sender_only_acks_after_success(self):
        notify_spec = importlib.util.spec_from_file_location("erp_notify", path.with_name("notify.py"))
        notify = importlib.util.module_from_spec(notify_spec)
        notify_spec.loader.exec_module(notify)
        calls = []
        def rpc(route, data):
            calls.append(route)
            return {"target": binding, "events": [{"id": "daily:date", "text": "daily digest"}]}
        async def fail(*args):
            raise RuntimeError("channel offline")
        with patch.object(notify.bridge, "rpc", rpc), patch.object(notify.bridge, "send_text", fail):
            with self.assertRaises(RuntimeError):
                await notify.drain(self.adapter)
        self.assertEqual(calls, ["notifications"])


if __name__ == "__main__":
    unittest.main()
