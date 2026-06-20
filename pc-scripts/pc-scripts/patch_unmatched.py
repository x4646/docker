# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    # 复制结束：成功的批量改DB，失败的存表
    import requests as _req
    if updates:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-commit", json={"updates": updates}, timeout=60)
            print(f"[migrate] DB更新: {r.json()}")
        except Exception as e:
            print(f"[migrate] DB更新失败: {e}")
    if failures:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-failures", json={"batch": batch_id, "failures": failures}, timeout=30)
            print(f"[migrate] 失败记录: {r.json()}")
        except Exception as e:
            print(f"[migrate] 失败记录写入失败: {e}")'''

new = '''    # 复制结束：成功的批量改DB，没匹配上的追加到失败表
    import requests as _req
    if updates:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-commit", json={"updates": updates}, timeout=60)
            result = r.json()
            print(f"[migrate] DB更新: updated={result.get('updated',0)} unmatched={len(result.get('unmatched',[]))}")
            # 没匹配上的当作"复制成功但DB未关联",追加到failures
            for u in result.get('unmatched', []):
                failures.append({"src": u["src"], "dst": u["dst"], "error": "复制成功但DB未匹配到记录(源不在数据库中)"})
                with migrate_lock:
                    migrate_state["failed"] += 1
                    migrate_state["copied"] -= 1  # 从复制数里扣回来
        except Exception as e:
            print(f"[migrate] DB更新失败: {e}")
    if failures:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-failures", json={"batch": batch_id, "failures": failures}, timeout=30)
            print(f"[migrate] 失败记录: {r.json()}")
        except Exception as e:
            print(f"[migrate] 失败记录写入失败: {e}")'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
