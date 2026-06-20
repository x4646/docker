# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '        print(f"图片处理失败: {nas_path} - {e}")\n        requests.post(f"{NAS_SYNC_URL.replace(\'3040\',\'3050\')}/api/photos/result",\n                      json={\'path\': nas_path, \'status\': \'error\'}, timeout=10)\n        return {\'status\': \'failed\', \'error\': str(e)}'

new = "        err = str(e)\n        print(f\"[ERROR] {nas_path} - {err}\")\n        try:\n            requests.post(f\"{NAS_SYNC_URL.replace('3040','3050')}/api/photos/result\",\n                          json={'path': nas_path, 'status': 'error'}, timeout=10)\n        except Exception: pass\n        return {'status': 'failed', 'error': err}"

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
