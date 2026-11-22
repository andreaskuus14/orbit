# CORE code sandbox

CORE runs Python (numpy, pandas, matplotlib, openpyxl) or plain JavaScript here for data analysis and charts.

- One-time setup: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox\setup.ps1` (creates `.venv` here).
- Each run: its own temp folder (`%TEMP%\orbit-sandbox\sb…`, removed after 3 hours), only the files attached in the chat or
  VAULT files the owner named (never journal/LIFE files), an empty environment, no network, limits on memory, CPU and time.
- Python (`run.py`): Windows Job Object (memory cap, one process, CPU time) or POSIX rlimits, a watchdog, and an audit hook
  that refuses sockets, new processes, ctypes, the registry, writes outside the run folder and reads outside it and Python itself.
- JavaScript (`run.mjs`): Node's permission model (files only in the run folder, no child processes or workers), and
  fetch / network modules / process.binding removed before the code runs.
- The network block is inside the interpreter, not an OS firewall rule. It stops ordinary code (and code written after reading
  a web page); it is not a defence against a deliberate native-code exploit.
