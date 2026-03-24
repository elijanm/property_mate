import os
from pathlib import Path

SESSION_FILE = Path.home() / ".mldock" / "session.json"
DEFAULT_BASE_URL = os.environ.get("MLDOCK_BASE_URL", "http://localhost:5200")
