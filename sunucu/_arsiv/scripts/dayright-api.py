#!/usr/bin/env python3
# DayRight backend API (beta) — feed + video servis + render tetikleme.
# Render motoru: /opt/matrix/scripts/route-video.py (onaylanan preset). Bind: 127.0.0.1:8770 (nginx subdomain + basic-auth arkasi).
# Uclar:
#   GET  /feed?dev=1            -> uretilmis videolarin listesi (JSON) + video_url
#   GET  /video/<dosya.mp4>     -> mp4 stream
#   POST /render  {date,dev,mode,speed,aspect,tier,line,dot,zoom} -> render baslat, {job} doner
#   GET  /status?job=<id>       -> render durumu/log kuyrugu
#   GET  /health                -> ok
import os, json, re, subprocess, time, urllib.parse, glob
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT="/opt/matrix/routes"; JOBS=os.path.join(OUT,"api_jobs"); RV="/opt/matrix/scripts/route-video.py"
os.makedirs(JOBS,exist_ok=True)
PORT=8770
NAME_RE=re.compile(r"rota_(\d{4}-\d{2}-\d{2})_(\d+)_(flat|flyover|3d)_(fast|medium|slow)(?:_(16x9|9x16))?(_free)?\.mp4$")

def feed_items(dev=None):
    items=[]
    for p in sorted(glob.glob(os.path.join(OUT,"rota_*.mp4")), key=os.path.getmtime, reverse=True):
        fn=os.path.basename(p); m=NAME_RE.search(fn)
        if not m: continue
        date,epoch,mode,speed,asp,free=m.groups()
        items.append({"id":fn,"date":date,"start_epoch":int(epoch),"mode":mode,"speed":speed,
                      "aspect":(asp or "16x9").replace("x",":"),"tier":("free" if free else "premium"),
                      "size":os.path.getsize(p),"ready":True,
                      "video_url":"/video/"+urllib.parse.quote(fn),"mtime":int(os.path.getmtime(p))})
    return items

def launch_render(b):
    date=str(b.get("date") or time.strftime("%Y-%m-%d"))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$",date): raise ValueError("date")
    args=[ "/usr/bin/python3", RV, date ]
    if (b.get("tier")=="free"): args.append("free")
    sp=b.get("speed","medium");  args.append(sp if sp in("fast","medium","slow") else "medium")
    md=b.get("mode","3d");       args.append(md if md in("flat","flyover","3d") else "3d")
    asp=b.get("aspect","16:9");  args.append("9:16" if str(asp).startswith("9") else "16:9")
    dev=int(b.get("dev",1));     args.append(f"dev={dev}")
    if b.get("zoom"): args.append(f"zoom={float(b['zoom'])}")
    hexok=lambda s: bool(re.match(r"^#?[0-9a-fA-F]{6}$",str(s or "")))
    if hexok(b.get("line")): args.append("line=#"+str(b["line"]).lstrip("#"))
    if hexok(b.get("dot")):  args.append("dot=#"+str(b["dot"]).lstrip("#"))
    job=f"{int(time.time())}_{dev}_{date}"
    log=open(os.path.join(JOBS,job+".log"),"w")
    subprocess.Popen(args,stdout=log,stderr=log,start_new_session=True)
    return job

class H(BaseHTTPRequestHandler):
    def _send(self,code,body,ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type",ctype)
        self.send_header("Access-Control-Allow-Origin","*")
        if isinstance(body,(dict,list)): body=json.dumps(body).encode()
        self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(u.query)
        if u.path=="/health": return self._send(200,{"ok":True})
        if u.path=="/feed":
            return self._send(200,{"items":feed_items(q.get("dev",[None])[0])})
        if u.path.startswith("/video/"):
            fn=urllib.parse.unquote(u.path[len("/video/"):])
            if "/" in fn or ".." in fn: return self._send(400,{"error":"bad"})
            fp=os.path.join(OUT,fn)
            if not os.path.exists(fp): return self._send(404,{"error":"yok"})
            data=open(fp,"rb").read()
            return self._send(200,data,"video/mp4")
        if u.path=="/status":
            job=q.get("job",[""])[0]; lp=os.path.join(JOBS,job+".log")
            if not job or not os.path.exists(lp): return self._send(404,{"error":"job yok"})
            txt=open(lp).read()[-2000:]
            done="video:" in txt or "gonderildi" in txt; err="HATA" in txt or "BAŞAR" in txt and "video:" not in txt
            return self._send(200,{"job":job,"done":done,"error":err,"log":txt})
        return self._send(404,{"error":"yol yok"})
    def do_POST(self):
        u=urllib.parse.urlparse(self.path)
        if u.path!="/render": return self._send(404,{"error":"yol yok"})
        n=int(self.headers.get("Content-Length",0)); raw=self.rfile.read(n) if n else b"{}"
        try: b=json.loads(raw or b"{}"); job=launch_render(b)
        except Exception as e: return self._send(400,{"error":str(e)})
        return self._send(200,{"job":job,"status_url":"/status?job="+job})
    def log_message(self,*a): pass

if __name__=="__main__":
    print(f"DayRight API 127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
