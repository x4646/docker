import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
idx = c.find("def nas_to_smb")
print("found at:", idx)
print("context:", repr(c[idx:idx+150]))

