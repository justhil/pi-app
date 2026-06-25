import json, os
p = os.path.expanduser("~/.codex/auth.json")
if not os.path.isfile(p):
    print("missing")
else:
    d = json.load(open(p, encoding="utf-8"))
    for k, v in d.items():
        if isinstance(v, str):
            print(k, "str", len(v))
        elif isinstance(v, dict):
            print(k, "dict", list(v.keys())[:10])
        else:
            print(k, type(v).__name__)