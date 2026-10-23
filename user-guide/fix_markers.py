"""A [[key]] marker only works in the step that holds the screenshot. In other steps,
replace it with the element's bold name from that task's callouts (or drop it).
Usage: python fix_markers.py guide.en.json"""
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
guide = json.loads(path.read_text(encoding="utf-8"))
changed = []


def first_bold(label):
    m = re.search(r"\*\*[^*]+\*\*", label)
    return m.group(0) if m else ""


def fix(text, allowed, names):
    def sub(m):
        key = m.group(1)
        if key in allowed:
            return m.group(0)
        changed.append(key)
        return names.get(key, "")
    out = re.sub(r"\[\[([\w-]+)\]\]", sub, text)
    out = re.sub(r"\*\*([^*]+)\*\* \*\*\1\*\*", r"**\1**", out)  # "**Save** **Save**" -> "**Save**"
    return re.sub(r"  +", " ", out).replace(" .", ".").replace(" ,", ",").strip()


for part in guide["parts"]:
    for ch in part["chapters"]:
        for task in ch["tasks"]:
            names = {}
            for st in task["steps"]:
                if isinstance(st, dict) and st.get("shot"):
                    for c in st["shot"].get("callouts", []):
                        names.setdefault(c["key"], first_bold(c["label"]))
            for i, st in enumerate(task["steps"]):
                if isinstance(st, str):
                    task["steps"][i] = fix(st, set(), names)
                    continue
                allowed = {c["key"] for c in (st.get("shot") or {}).get("callouts", [])}
                st["text"] = fix(st["text"], allowed, names)
                if "sub" in st:
                    st["sub"] = [fix(s, set(), names) for s in st["sub"]]  # the builder only links markers in the step text

path.write_text(json.dumps(guide, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{path.name}: {len(changed)} markers replaced: {sorted(set(changed))}")
