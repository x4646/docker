# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()
if 'import re' not in content:
    content = content.replace('import os\nimport time', 'import os\nimport time\nimport re', 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
else:
    print("already exists")
