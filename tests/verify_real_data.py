"""Offline consistency test for the change polygons traced over Wayback imagery."""
import json
import re
from pathlib import Path
root = Path(__file__).resolve().parents[1]
text = (root / 'src/app/real-data.ts').read_text()
imagery = sorted(int(key) for key in re.findall(r'^\s+(\d{6}): \{ id:', text, re.M))
features = json.loads(re.search(r'export const REAL_FEATURES: DemoFeature\[\] = (\[.*?\]);', text, re.S).group(1))
center = (31.679, 29.9805)
categories = {'Building', 'Construction', 'Road', 'Vehicles', 'Earthwork'}

def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

assert len(imagery) == 10, imagery
assert 30 <= len(features) <= 60, len(features)
assert len({f['id'] for f in features}) == len(features)
for f in features:
    name = f['id']
    assert f['category'] in categories, name
    assert f['created'] in imagery, f'{name}: created must be an imagery month'
    assert f['retired'] is None or (f['retired'] in imagery and f['retired'] > f['created']), name
    epochs = [r['epoch'] for r in f['revisions']]
    assert epochs[0] == f['created'] and epochs == sorted(set(epochs)), name
    assert all(e in imagery for e in epochs), name
    for r in f['revisions']:
        ring = r['ring']
        assert len(ring) >= 4 and ring[0] == ring[-1], f'{name}: ring must be closed'
        assert signed_area(ring) < 0, f'{name}: outer rings must be clockwise'
        assert r['height'] > 0, name
        # About 3 km across: every vertex within ~2 km of the centre.
        assert all(abs(x - center[0]) < 0.02 and abs(y - center[1]) < 0.018 for x, y in ring), f'{name}: outside the area'

def snapshot(f, epoch):
    if f['created'] > epoch or (f['retired'] is not None and epoch >= f['retired']): return None
    return [r for r in f['revisions'] if r['epoch'] <= epoch][-1]

def stats(a, b):
    cnt = {'added': 0, 'removed': 0, 'modified': 0}
    for f in features:
        old, new = snapshot(f, a), snapshot(f, b)
        if old is None and new is not None: cnt['added'] += 1
        elif old is not None and new is None: cnt['removed'] += 1
        elif old and new and old['epoch'] != new['epoch']: cnt['modified'] += 1
    return cnt

# Every imagery update brings at least one change, so any window that contains one shows something.
for before, after in zip(imagery, imagery[1:]):
    assert sum(stats(before, after).values()) > 0, f'no change between {before} and {after}'
assert all(stats(201801, 202609)[k] > 0 for k in ('added', 'removed'))
print('OK - real change polygons consistent.')
print('Features:', len(features), 'by category:', {c: sum(f['category'] == c for f in features) for c in sorted(categories)})
for window in [(202606, 202609), (202204, 202207), (202208, 202211)]:
    print(f'{window[0]} -> {window[1]}:', stats(*window))
