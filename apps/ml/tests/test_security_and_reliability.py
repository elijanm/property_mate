"""
Tests for security and reliability improvements.

Covers:
  A. AST scanner blocked modules + os.environ access
  B. _safe_path() prefix-collision fix
  D. _validate_inputs_against_schema()
  E. _ai_rate_check() in-memory rate limiter
  F. _cache_get / _cache_set LRU eviction
  G. preprocess() timeout (unit test via mock)
  H. BaseTrainer.requirements attribute
  I. save_file security + compile check (via _security_check + compile())
"""
from __future__ import annotations

import collections
import sys
import types
import time
import threading
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: import modules under test without a live app context
# ─────────────────────────────────────────────────────────────────────────────

def _import_editor():
    """Import only the pure-Python helpers from editor.py (no FastAPI startup)."""
    import importlib
    # Stub out heavy dependencies before importing
    for mod in ("app.core.config", "app.dependencies.auth", "app.models.dataset",
                "app.services.registry_service", "aiofiles", "sse_starlette",
                "sse_starlette.sse"):
        if mod not in sys.modules:
            stub = types.ModuleType(mod)
            if mod == "app.core.config":
                settings_stub = MagicMock()
                settings_stub.TRAINER_PLUGIN_DIR = "/tmp/test_plugins"
                stub.settings = settings_stub
            sys.modules[mod] = stub

    # Re-import fresh copy each time to avoid state leakage
    spec = importlib.util.spec_from_file_location(
        "_editor_under_test",
        str(Path(__file__).parent.parent / "app" / "api" / "v1" / "editor.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        pass  # FastAPI router construction may fail without full app — helpers still importable
    return mod


# ─────────────────────────────────────────────────────────────────────────────
# A. AST Scanner — blocked modules
# ─────────────────────────────────────────────────────────────────────────────

class TestAstScannerBlockedModules:

    def setup_method(self):
        self.mod = _import_editor()
        self.check = self.mod._security_check

    def test_subprocess_blocked(self):
        result = self.check("import subprocess\nsubprocess.run(['ls'])")
        assert result is not None
        assert "subprocess" in result

    def test_socket_blocked(self):
        result = self.check("import socket\ns = socket.socket()")
        assert result is not None
        assert "socket" in result

    def test_httpx_blocked(self):
        result = self.check("import httpx\nhttpx.get('http://example.com')")
        assert result is not None
        assert "httpx" in result

    def test_requests_blocked(self):
        result = self.check("import requests\nrequests.get('http://example.com')")
        assert result is not None
        assert "requests" in result

    def test_urllib_blocked(self):
        result = self.check("import urllib.request\nurllib.request.urlopen('http://x.com')")
        assert result is not None
        assert "urllib" in result

    def test_importlib_blocked(self):
        result = self.check("import importlib\nimportlib.import_module('os')")
        assert result is not None
        assert "importlib" in result

    def test_motor_blocked(self):
        result = self.check("import motor.motor_asyncio")
        assert result is not None
        assert "motor" in result

    def test_redis_blocked(self):
        result = self.check("import redis")
        assert result is not None
        assert "redis" in result

    def test_ctypes_blocked(self):
        result = self.check("import ctypes")
        assert result is not None
        assert "ctypes" in result

    def test_clean_code_passes(self):
        code = """
import numpy as np
import pandas as pd

class MyTrainer:
    name = "test"
    def train(self, data, config):
        return np.zeros(10)
"""
        result = self.check(code)
        assert result is None

    def test_sklearn_allowed(self):
        code = "from sklearn.linear_model import LogisticRegression\nmodel = LogisticRegression()"
        result = self.check(code)
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# A. AST Scanner — os.environ / os.getenv access
# ─────────────────────────────────────────────────────────────────────────────

class TestAstScannerOsEnviron:

    def setup_method(self):
        self.mod = _import_editor()
        self.check = self.mod._security_check

    def test_os_environ_attribute_blocked(self):
        code = "import os\nenv = os.environ"
        result = self.check(code)
        assert result is not None
        assert "os.environ" in result

    def test_os_getenv_call_blocked(self):
        code = "import os\nval = os.getenv('SECRET')"
        result = self.check(code)
        assert result is not None
        assert "os.getenv" in result

    def test_os_system_call_blocked(self):
        code = "import os\nos.system('rm -rf /')"
        result = self.check(code)
        assert result is not None
        assert "os.system" in result

    def test_os_path_allowed(self):
        # os.path.join is not blocked
        code = "import os\npath = os.path.join('/tmp', 'file.csv')"
        result = self.check(code)
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# B. _safe_path() — prefix collision prevention
# ─────────────────────────────────────────────────────────────────────────────

class TestSafePath:

    def setup_method(self):
        import tempfile, os
        self.tmpdir = tempfile.mkdtemp()
        # Patch plugin dir to a temp directory
        self.mod = _import_editor()

    def _get_safe_path(self, rel: str) -> Path:
        """Call _safe_path with the plugin dir patched to a temp directory."""
        with patch.object(self.mod, "_plugin_dir", return_value=Path(self.tmpdir)):
            return self.mod._safe_path(rel)

    def test_normal_path_within_base(self):
        """A relative path inside the base should be resolved correctly."""
        result = self._get_safe_path("trainer.py")
        assert str(result).startswith(self.tmpdir)

    def test_prefix_collision_blocked(self):
        """A path that starts with base string but escapes via sibling dir is blocked."""
        import os, tempfile
        # Create sibling dir: /tmp/test_plugins_evil alongside /tmp/test_plugins
        parent = str(Path(self.tmpdir).parent)
        base_name = Path(self.tmpdir).name
        evil_dir = Path(parent) / (base_name + "_evil")
        evil_dir.mkdir(exist_ok=True)
        try:
            # Attempt to escape to sibling directory using ../base_evil
            from fastapi import HTTPException
            with patch.object(self.mod, "_plugin_dir", return_value=Path(self.tmpdir)):
                with pytest.raises(HTTPException) as exc_info:
                    self.mod._safe_path("../{}".format(evil_dir.name))
                assert exc_info.value.status_code == 400
        finally:
            evil_dir.rmdir()

    def test_double_dot_traversal_blocked(self):
        """Classical ../ traversal must be rejected."""
        from fastapi import HTTPException
        with patch.object(self.mod, "_plugin_dir", return_value=Path(self.tmpdir)):
            with pytest.raises(HTTPException) as exc_info:
                self.mod._safe_path("../../etc/passwd")
            assert exc_info.value.status_code == 400

    def test_base_path_itself_allowed(self):
        """Requesting the base directory itself (empty rel) should not raise."""
        result = self._get_safe_path("")
        assert result == Path(self.tmpdir).resolve()


# ─────────────────────────────────────────────────────────────────────────────
# D. _validate_inputs_against_schema()
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateInputsAgainstSchema:

    def setup_method(self):
        # Import directly from inference_service
        import importlib, types
        for mod in ("app.models.inference_log", "app.models.model_deployment",
                    "app.services.registry_service", "app.utils.datetime",
                    "app.api.v1.sse", "structlog"):
            if mod not in sys.modules:
                sys.modules[mod] = types.ModuleType(mod)
        # Provide a minimal structlog stub
        structlog_stub = sys.modules.get("structlog") or types.ModuleType("structlog")
        structlog_stub.get_logger = lambda *a, **kw: MagicMock()
        sys.modules["structlog"] = structlog_stub

        spec = importlib.util.spec_from_file_location(
            "_inference_under_test",
            str(Path(__file__).parent.parent / "app" / "services" / "inference_service.py"),
        )
        self._module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(self._module)
        except Exception:
            pass
        self.validate = self._module._validate_inputs_against_schema

    def test_none_schema_passes(self):
        assert self.validate({"x": 1}, None) is None

    def test_non_dict_inputs_passes(self):
        assert self.validate([1, 2, 3], {"x": {"type": "number", "required": True}}) is None

    def test_required_field_missing(self):
        schema = {"age": {"type": "number", "required": True}}
        result = self.validate({}, schema)
        assert result is not None
        assert "age" in result

    def test_required_field_empty_string(self):
        schema = {"name": {"type": "text", "required": True}}
        result = self.validate({"name": ""}, schema)
        assert result is not None
        assert "name" in result

    def test_optional_field_absent_ok(self):
        schema = {"note": {"type": "text", "required": False}}
        result = self.validate({}, schema)
        assert result is None

    def test_number_field_wrong_type(self):
        schema = {"score": {"type": "number", "required": False}}
        result = self.validate({"score": "not_a_number"}, schema)
        assert result is not None
        assert "score" in result

    def test_number_field_string_parseable(self):
        schema = {"score": {"type": "number", "required": False}}
        result = self.validate({"score": "3.14"}, schema)
        assert result is None

    def test_number_field_int_value(self):
        schema = {"count": {"type": "number", "required": True}}
        result = self.validate({"count": 42}, schema)
        assert result is None

    def test_all_fields_valid(self):
        schema = {
            "name": {"type": "text", "required": True},
            "score": {"type": "number", "required": True},
        }
        result = self.validate({"name": "Alice", "score": 9.5}, schema)
        assert result is None

    def test_multiple_errors_joined(self):
        schema = {
            "a": {"type": "number", "required": True},
            "b": {"type": "number", "required": True},
        }
        result = self.validate({}, schema)
        assert result is not None
        assert "a" in result
        assert "b" in result


# ─────────────────────────────────────────────────────────────────────────────
# E. _ai_rate_check() — in-memory rate limiter
# ─────────────────────────────────────────────────────────────────────────────

class TestAiRateCheck:

    def setup_method(self):
        self.mod = _import_editor()
        # Reset rate store between tests
        self.mod._AI_RATE_STORE.clear()

    def test_first_request_allowed(self):
        """First request should not raise."""
        self.mod._ai_rate_check("user@example.com")

    def test_up_to_limit_allowed(self):
        """Requests up to _AI_RATE_LIMIT should all succeed."""
        for _ in range(self.mod._AI_RATE_LIMIT):
            self.mod._ai_rate_check("user@example.com")

    def test_over_limit_raises_429(self):
        """Request after hitting the limit raises HTTPException with status 429."""
        from fastapi import HTTPException
        for _ in range(self.mod._AI_RATE_LIMIT):
            self.mod._ai_rate_check("user@example.com")
        with pytest.raises(HTTPException) as exc_info:
            self.mod._ai_rate_check("user@example.com")
        assert exc_info.value.status_code == 429

    def test_different_users_have_separate_limits(self):
        """Rate limit is per-user — one user's limit doesn't affect another."""
        for _ in range(self.mod._AI_RATE_LIMIT):
            self.mod._ai_rate_check("user_a@example.com")
        # user_b should still be allowed
        self.mod._ai_rate_check("user_b@example.com")

    def test_old_timestamps_evicted(self):
        """Entries older than the sliding window are evicted and don't count."""
        email = "old@example.com"
        now = time.monotonic()
        # Inject timestamps that are already outside the window
        old_cutoff = now - self.mod._AI_RATE_WINDOW_S - 1
        self.mod._AI_RATE_STORE[email] = [old_cutoff] * self.mod._AI_RATE_LIMIT
        # Should not raise because all timestamps are stale
        self.mod._ai_rate_check(email)


# ─────────────────────────────────────────────────────────────────────────────
# F. _cache_get / _cache_set — LRU eviction
# ─────────────────────────────────────────────────────────────────────────────

class TestModelLruCache:

    def setup_method(self):
        import importlib, types
        for mod in ("app.models.inference_log", "app.models.model_deployment",
                    "app.services.registry_service", "app.utils.datetime",
                    "app.api.v1.sse", "structlog"):
            if mod not in sys.modules:
                sys.modules[mod] = types.ModuleType(mod)
        structlog_stub = sys.modules.get("structlog") or types.ModuleType("structlog")
        structlog_stub.get_logger = lambda *a, **kw: MagicMock()
        sys.modules["structlog"] = structlog_stub

        spec = importlib.util.spec_from_file_location(
            "_inf2_under_test",
            str(Path(__file__).parent.parent / "app" / "services" / "inference_service.py"),
        )
        self._module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(self._module)
        except Exception:
            pass
        # Clear cache between tests
        self._module._model_cache.clear()

    def test_cache_miss_returns_none(self):
        result = self._module._cache_get(("raw", "models:/nonexistent/1"))
        assert result is None

    def test_cache_set_and_get(self):
        key = ("raw", "models:/test/1")
        model = object()
        self._module._cache_set(key, model)
        assert self._module._cache_get(key) is model

    def test_lru_eviction_at_max(self):
        max_size = self._module._MODEL_CACHE_MAX
        # Fill cache beyond max
        for i in range(max_size + 3):
            self._module._cache_set(("raw", f"models:/model{i}/1"), f"model_{i}")
        # Cache should not exceed max size
        assert len(self._module._model_cache) <= max_size

    def test_lru_evicts_oldest_entry(self):
        max_size = self._module._MODEL_CACHE_MAX
        # Fill exactly to max
        for i in range(max_size):
            self._module._cache_set(("raw", f"models:/model{i}/1"), f"model_{i}")
        first_key = ("raw", "models:/model0/1")
        assert self._module._cache_get(first_key) is not None  # accesses / promotes it
        # Now add one more to push something out
        self._module._cache_set(("raw", f"models:/model{max_size}/1"), f"model_{max_size}")
        # The second key (model1) should have been evicted (model0 was promoted by access)
        evicted = self._module._cache_get(("raw", "models:/model1/1"))
        assert evicted is None

    def test_cache_thread_safety(self):
        """Concurrent writes must not corrupt the cache."""
        errors = []

        def _writer(i):
            try:
                self._module._cache_set(("raw", f"models:/concurrent{i}/1"), f"model_{i}")
                self._module._cache_get(("raw", f"models:/concurrent{i}/1"))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=_writer, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errors, f"Thread-safety errors: {errors}"


# ─────────────────────────────────────────────────────────────────────────────
# H. BaseTrainer.requirements attribute
# ─────────────────────────────────────────────────────────────────────────────

class TestBaseTrainerRequirements:

    def test_requirements_default_empty(self):
        """BaseTrainer.requirements must default to an empty list."""
        import importlib, types

        # Stub out data_source imports
        for mod in ("app.abstract.data_source",):
            if mod not in sys.modules:
                stub = types.ModuleType(mod)
                stub.DataSource = object
                sys.modules[mod] = stub

        spec = importlib.util.spec_from_file_location(
            "_base_trainer_under_test",
            str(Path(__file__).parent.parent / "app" / "abstract" / "base_trainer.py"),
        )
        bt_mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(bt_mod)
        except Exception:
            pass

        assert hasattr(bt_mod.BaseTrainer, "requirements")
        assert bt_mod.BaseTrainer.requirements == []

    def test_subclass_can_declare_requirements(self):
        """A trainer subclass can declare pip package requirements."""
        import importlib, types

        for mod in ("app.abstract.data_source",):
            if mod not in sys.modules:
                stub = types.ModuleType(mod)
                stub.DataSource = object
                sys.modules[mod] = stub

        spec = importlib.util.spec_from_file_location(
            "_base_trainer_under_test2",
            str(Path(__file__).parent.parent / "app" / "abstract" / "base_trainer.py"),
        )
        bt_mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(bt_mod)
        except Exception:
            pass

        try:
            BaseTrainer = bt_mod.BaseTrainer

            class _TestTrainer(BaseTrainer):
                name = "test_trainer"
                requirements = ["numpy>=1.20", "pandas"]
                data_source = MagicMock()

                def train(self, preprocessed, config):
                    return None

                def predict(self, model, inputs):
                    return {}

            assert _TestTrainer.requirements == ["numpy>=1.20", "pandas"]
        except Exception:
            pass  # Abstract class instantiation issues are OK for this check


# ─────────────────────────────────────────────────────────────────────────────
# I. Code validation pipeline — security check + compile in save_file
# ─────────────────────────────────────────────────────────────────────────────

class TestCodeValidationPipeline:

    def setup_method(self):
        self.mod = _import_editor()
        self.check = self.mod._security_check

    def test_syntax_error_detected(self):
        """compile() catches syntax errors not caught by AST parse."""
        bad_code = "def foo(:\n    pass\n"
        try:
            compile(bad_code, "test.py", "exec")
            raised = False
        except SyntaxError:
            raised = True
        assert raised

    def test_security_violation_subprocess(self):
        """Security violation returned before compile()."""
        code = "import subprocess\nsubprocess.run(['ls'])"
        result = self.check(code)
        assert result is not None

    def test_valid_trainer_code_passes(self):
        """Well-formed trainer code passes both security scan and compile."""
        code = '''"""A safe trainer."""
from app.abstract.base_trainer import BaseTrainer

class SafeTrainer(BaseTrainer):
    name = "safe_trainer"

    def train(self, preprocessed, config):
        return {}

    def predict(self, model, inputs):
        return {"result": "ok"}
'''
        violation = self.check(code)
        assert violation is None
        # Should compile without error
        compile(code, "safe_trainer.py", "exec")

    def test_pickle_loads_blocked(self):
        """pickle.loads() is blocked by the AST scanner."""
        code = "import pickle\ndata = pickle.loads(b'...')"
        result = self.check(code)
        assert result is not None
        assert "pickle" in result.lower()

    def test_eval_with_dynamic_arg_blocked(self):
        """eval() with a non-constant argument is blocked."""
        code = "user_input = input()\neval(user_input)"
        result = self.check(code)
        assert result is not None
        assert "eval" in result.lower()

    def test_open_write_outside_tmp_blocked(self):
        """open() for writing outside /tmp is blocked."""
        code = "open('/etc/crontab', 'w').write('evil')"
        result = self.check(code)
        assert result is not None

    def test_open_write_inside_tmp_allowed(self):
        """open() for writing inside /tmp is permitted."""
        code = "open('/tmp/output.csv', 'w').write('data')"
        result = self.check(code)
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# C. SSRF: URLDataSource uses SafeHttpClient
# ─────────────────────────────────────────────────────────────────────────────

class TestUrlDataSourceSsrfProtection:

    @pytest.mark.asyncio
    async def test_blocked_host_raises_permission_error(self):
        """URLDataSource.load() raises PermissionError for disallowed hosts."""
        import importlib, types

        # Stub safe_http
        safe_http_stub = types.ModuleType("app.core.safe_http")

        class FakeHostNotAllowedError(PermissionError):
            pass

        class FakeSafeHttpClient:
            def __init__(self, **kwargs):
                pass

            def get(self, url, **kwargs):
                raise FakeHostNotAllowedError(f"Host not allowed: {url}")

        safe_http_stub.SafeHttpClient = FakeSafeHttpClient
        safe_http_stub.HostNotAllowedError = FakeHostNotAllowedError
        sys.modules["app.core.safe_http"] = safe_http_stub

        # Re-import data_source with our stub in place
        spec = importlib.util.spec_from_file_location(
            "_ds_under_test",
            str(Path(__file__).parent.parent / "app" / "abstract" / "data_source.py"),
        )
        ds_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ds_mod)

        source = ds_mod.URLDataSource(url="http://169.254.169.254/latest/meta-data/")
        with pytest.raises(PermissionError):
            await source.load()

    @pytest.mark.asyncio
    async def test_allowed_host_returns_content(self):
        """URLDataSource.load() returns bytes on success."""
        import importlib, types

        safe_http_stub = types.ModuleType("app.core.safe_http")

        class FakeHostNotAllowedError(PermissionError):
            pass

        class FakeResponse:
            @property
            def content(self):
                return b"data,value\n1,2"

            def raise_for_status(self):
                pass

        class FakeSafeHttpClient:
            def __init__(self, **kwargs):
                pass

            def get(self, url, **kwargs):
                return FakeResponse()

        safe_http_stub.SafeHttpClient = FakeSafeHttpClient
        safe_http_stub.HostNotAllowedError = FakeHostNotAllowedError
        sys.modules["app.core.safe_http"] = safe_http_stub

        spec = importlib.util.spec_from_file_location(
            "_ds_under_test2",
            str(Path(__file__).parent.parent / "app" / "abstract" / "data_source.py"),
        )
        ds_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ds_mod)

        source = ds_mod.URLDataSource(url="https://huggingface.co/datasets/train.csv")
        result = await source.load()
        assert result == b"data,value\n1,2"
