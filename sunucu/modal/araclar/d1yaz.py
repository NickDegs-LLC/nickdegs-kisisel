import sys, json
j = json.load(sys.stdin)
if not j.get("success"):
    print("   SORGU HATASI:", j.get("errors")); sys.exit()
rows = j["result"][0]["results"]
if not rows: print("   (boş)")
for r in rows: print("  ", r)
