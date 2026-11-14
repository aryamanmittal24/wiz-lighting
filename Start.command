#!/bin/zsh
cd "${0:A:h}"
if curl -fsS http://127.0.0.1:8765/api/session >/dev/null 2>&1; then
  open http://127.0.0.1:8765
else
  (sleep 4; open http://127.0.0.1:8765) &
  python3 server.py
fi
