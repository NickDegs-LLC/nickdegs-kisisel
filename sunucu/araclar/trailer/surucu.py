# Render kuyruğu sürücüsü: 3 paralel. Her iş: (ad, fps, sn, zoom, pitch, kabartma, noOutro)
import subprocess, concurrent.futures as cf, time
W = '/tmp/claude-0/-opt-matrix/dd0bbf58-490d-4987-9395-dbfb719e512f/scratchpad/trailer'
ISLER = [('stelvio', 30, 12, '15.6', '62', 0, 1),
         ('ist', 30, 8, '', '', 0, 0),
         ('amalfi', 30, 8, '', '', 0, 1),
         ('dubai', 30, 8, '', '', 1, 1),
         ('norway', 30, 8, '15.9', '', 0, 1)]


def kos(i):
    t = time.time()
    r = subprocess.run([W + '/render_clip.sh', i[0], str(i[1]), str(i[2]), i[3], i[4], str(i[5]), str(i[6])],
                       capture_output=True, text=True)
    return '%s: %s (%.0fs)' % (i[0], (r.stdout.strip().replace('\n', ' | ') or r.stderr[-200:]), time.time() - t)


with cf.ThreadPoolExecutor(3) as ex:
    for s in ex.map(kos, ISLER):
        print(s, flush=True)
print('HEPSİ BİTTİ', flush=True)
