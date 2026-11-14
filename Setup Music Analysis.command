#!/bin/zsh
set -e
cd "${0:A:h}"
if command -v python3.13 >/dev/null; then
  analysis_python=python3.13
else
  analysis_python=python3
fi
"$analysis_python" -m venv .venv-analysis
.venv-analysis/bin/python -m pip install -r requirements-analysis.txt
print 'Music analysis ready. Start the WiZ panel and choose a song.'
