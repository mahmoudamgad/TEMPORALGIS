"""Offline consistency test for the synthetic load-test geometry."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
epochs = [201801, 202003, 202206, 202409, 202607]  # YYYYMM, same as tools/generate-load-test.mjs
features = json.loads((root / 'public/data/load-test.json').read_text())
assert len(features) == 20000
assert len({f['id'] for f in features}) == len(features)

def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

vertices = []
for f in features:
    assert f['created'] in epochs
    assert f['retired'] is None or f['retired'] > f['created']
    assert f['revisions'][0]['epoch'] == f['created']
    for revision in f['revisions']:
        ring = revision['ring']
        assert ring[0] == ring[-1]
        assert 30 <= len(ring) - 1 <= 100
        assert signed_area(ring) < 0, 'outer rings must be clockwise'
        assert revision['height'] > 0
        assert f['retired'] is None or revision['epoch'] < f['retired']
        vertices.append(len(ring))

def snapshot(f, epoch):
    if f['created'] > epoch or (f['retired'] is not None and epoch >= f['retired']): return None
    return [v for v in f['revisions'] if v['epoch'] <= epoch][-1]

def stats(a, b):
    cnt = {'added': 0, 'removed': 0, 'modified': 0}
    for f in features:
        old, new = snapshot(f, a), snapshot(f, b)
        if old is None and new is not None: cnt['added'] += 1
        elif old is not None and new is None: cnt['removed'] += 1
        elif old and new and old['epoch'] != new['epoch']: cnt['modified'] += 1
    return cnt
assert all(stats(201801, 202607)[k] > 0 for k in ('added', 'removed', 'modified'))
print('OK - load-test geometry consistent.')
print('Features:', len(features), 'Vertices:', sum(vertices), 'Per ring:', min(vertices), '-', max(vertices))
print('202003 -> 202607:', stats(202003, 202607))
