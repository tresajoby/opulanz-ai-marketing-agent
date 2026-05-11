import os
import subprocess
import sys

port = os.environ.get("PORT", "8000")
sys.exit(subprocess.call([
    "uvicorn", "api.main:app",
    "--host", "0.0.0.0",
    "--port", port,
]))
