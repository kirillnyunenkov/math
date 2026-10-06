#!/usr/bin/env python3
"""render.py in.svg out.png [scale]  -- headless Chrome, size from the svg width/height (px or pt)."""
import re, sys, os, subprocess, tempfile
src, out = sys.argv[1], sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2
s = open(src, encoding='utf-8').read(6000)
head = re.search(r'<svg\b[^>]*>', s, re.S).group(0)
def dim(name):
    m = re.search(r'\s%s=[\'"]([\d.]+)(pt|px)?[\'"]' % name, head)
    v, u = float(m.group(1)), m.group(2)
    return v * 96 / 72 if u == 'pt' else v
w, h = dim('width'), dim('height')
w, h = int(w + 1), int(h + 1)
d = tempfile.mkdtemp()
open(d + '/p.html', 'w').write('<html><body style="margin:0;background:#fff"><img src="file://%s" width="%d" height="%d" style="display:block"></body></html>' % (os.path.abspath(src), w, h))
subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--force-device-scale-factor=%s' % scale, '--window-size=%d,%d' % (w, h), '--screenshot=' + os.path.abspath(out), 'file://' + d + '/p.html'],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
