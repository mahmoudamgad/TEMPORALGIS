"""Small offline consistency test for the synthetic snapshot geometry."""
import json
import re
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
text = (root / 'src/app/demo-data.ts').read_text()
epochs = json.loads(re.search(r'export const DEMO_EPOCHS = (\[.*?\]) as const', text).group(1))
assert epochs == sorted(epochs) and all(2000 <= e // 100 <= 2100 and 1 <= e % 100 <= 12 for e in epochs), 'epochs are YYYYMM months'
features = json.loads(re.search(r'export const DEMO_FEATURES: DemoFeature\[\] = (\[.*?\]);\nexport const DEMO_PARKS', text, re.S).group(1))
assert len(features) >= 100
assert len({f['id'] for f in features}) == len(features)
for f in features:
    assert f['created'] in epochs
    assert f['retired'] is None or f['retired'] in epochs
    assert f['revisions'][0]['epoch'] == f['created']
    assert all(revision['epoch'] in epochs for revision in f['revisions'])
    for revision in f['revisions']:
        ring = revision['ring']
        assert len(ring) >= 5 and ring[0] == ring[-1]
        assert revision['height'] > 0
        assert all(31.65 < x < 31.70 and 29.96 < y < 30.00 for x,y in ring)
for epoch in epochs:
    image = Image.open(root / 'public' / 'epochs' / f'{epoch // 100}.png')
    assert image.size == (1320, 1037)

def snapshot(f, epoch):
    if f['created'] > epoch or (f['retired'] is not None and epoch >= f['retired']): return None
    revs = [v for v in f['revisions'] if v['epoch'] <= epoch]
    return revs[-1] if revs else None

def stats(a, b):
    cnt = {'added':0, 'removed':0, 'modified':0}
    for f in features:
        old, new = snapshot(f,a),snapshot(f,b)
        if old is None and new is not None: cnt['added']+=1
        elif old is not None and new is None: cnt['removed']+=1
        elif old and new and old['epoch'] != new['epoch']: cnt['modified']+=1
    return cnt
assert stats(201911, 201911) == dict(added=0, removed=0, modified=0)
assert all(stats(201911, 202608)[k] > 0 for k in ('added','removed','modified'))
print('OK - static epoch images, geometries and changes consistent.')
print('201911 -> 202608:', stats(201911, 202608))
print('Assets:', len(features))
