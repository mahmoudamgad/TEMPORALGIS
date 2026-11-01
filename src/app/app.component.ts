import { AfterViewInit, Component, computed, ElementRef, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import ArcMap from '@arcgis/core/Map.js';
import Basemap from '@arcgis/core/Basemap.js';
import Camera from '@arcgis/core/Camera.js';
import Extent from '@arcgis/core/geometry/Extent.js';
import Polygon from '@arcgis/core/geometry/Polygon.js';
import Graphic from '@arcgis/core/Graphic.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import MediaLayer from '@arcgis/core/layers/MediaLayer.js';
import OpenStreetMapLayer from '@arcgis/core/layers/OpenStreetMapLayer.js';
import WebTileLayer from '@arcgis/core/layers/WebTileLayer.js';
import ImageElement from '@arcgis/core/layers/support/ImageElement.js';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference.js';
import SimpleRenderer from '@arcgis/core/renderers/SimpleRenderer.js';
import SizeVariable from '@arcgis/core/renderers/visualVariables/SizeVariable.js';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import PolygonSymbol3D from '@arcgis/core/symbols/PolygonSymbol3D.js';
import ExtrudeSymbol3DLayer from '@arcgis/core/symbols/ExtrudeSymbol3DLayer.js';
import SolidEdges3D from '@arcgis/core/symbols/edges/SolidEdges3D.js';
import MapView from '@arcgis/core/views/MapView.js';
import SceneView from '@arcgis/core/views/SceneView.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import {
  DEMO_BOUNDS, DEMO_CENTER, DEMO_EPOCHS, DEMO_FEATURES,
  type DemoFeature, type Revision
} from './demo-data';
import { REAL_CENTER, REAL_EPOCHS, REAL_FEATURES, REAL_IMAGERY, WAYBACK_RELEASES } from './real-data';

type MapMode = '2d' | '3d';
type Scene = 'satellite' | 'images' | 'loadtest';
type Side = 'left' | 'right';
type GISView = MapView | SceneView;
type ChangeKind = 'added' | 'removed' | 'modified';
interface Snapshot { feature: DemoFeature; revision: Revision; }
interface Change { id: string; name: string; category: string; kind: ChangeKind; lon: number; lat: number; before?: Snapshot; after?: Snapshot; }
interface Pane { map: ArcMap; view: GISView; backdrops: Map<number, Layer>; buildings: FeatureLayer; overlay: GraphicsLayer; highlights: Map<string, Graphic>; }
interface ViewportBounds { xmin: number; ymin: number; xmax: number; ymax: number; webMercator: boolean; }
// `epochs` are the months that can be picked; `stops` are the months with new imagery, shown on the timeline.
interface SceneConfig { label: string; epochs: readonly number[]; stops: readonly number[]; center: [number, number]; zoom: number; left: number; right: number; }

// Every epoch is a YYYYMM month, e.g. 202403 is March 2024. Integer order is date order.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const yearOf = (epoch: number) => Math.floor(epoch / 100);
const monthOf = (epoch: number) => epoch % 100;
const epochLabel = (epoch: number) => `${MONTHS[monthOf(epoch) - 1]} ${yearOf(epoch)}`;
// Same list as tools/generate-load-test.mjs.
const LOAD_TEST_EPOCHS = [201801, 202003, 202206, 202409, 202607] as const;

const SCENES: Record<Scene, SceneConfig> = {
  satellite: { label: 'WAYBACK SATELLITE', epochs: REAL_EPOCHS, stops: REAL_IMAGERY, center: REAL_CENTER, zoom: 15.5, left: 202206, right: 202609 },
  images: { label: 'SYNTHETIC AERIAL', epochs: DEMO_EPOCHS, stops: DEMO_EPOCHS, center: DEMO_CENTER, zoom: 16, left: 201911, right: 202608 },
  loadtest: { label: 'SYNTHETIC LOAD TEST', epochs: LOAD_TEST_EPOCHS, stops: LOAD_TEST_EPOCHS, center: DEMO_CENTER, zoom: 13.5, left: 202003, right: 202607 }
};
const WAYBACK_TILES = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile';
const LIST_LIMIT = 200;

function changeIsInViewport(change: Change, viewport: ViewportBounds | null): boolean {
  if (!viewport) return true;
  const r = 6378137;
  const x = viewport.webMercator ? change.lon * Math.PI / 180 * r : change.lon;
  const y = viewport.webMercator ? Math.log(Math.tan(Math.PI / 4 + change.lat * Math.PI / 360)) * r : change.lat;
  return x >= viewport.xmin && x <= viewport.xmax && y >= viewport.ymin && y <= viewport.ymax;
}

// All change events are derived from local snapshot metadata. There is no image analysis.
function atEpoch(feature: DemoFeature, epoch: number): Snapshot | undefined {
  if (feature.created > epoch || (feature.retired !== null && feature.retired <= epoch)) return undefined;
  const revision = [...feature.revisions].reverse().find((item) => item.epoch <= epoch);
  return revision ? { feature, revision } : undefined;
}
function makeComparison(features: DemoFeature[], beforeEpoch: number, afterEpoch: number): Change[] {
  if (beforeEpoch === afterEpoch) return [];
  const reversed = beforeEpoch > afterEpoch;
  const older = Math.min(beforeEpoch, afterEpoch);
  const newer = Math.max(beforeEpoch, afterEpoch);
  const changes: Change[] = [];
  for (const feature of features) {
    const before = atEpoch(feature, older);
    const after = atEpoch(feature, newer);
    let kind: ChangeKind | undefined;
    if (!before && after) kind = 'added';
    else if (before && !after) kind = 'removed';
    else if (before && after && before.revision.epoch !== after.revision.epoch) kind = 'modified';
    if (kind) {
      const ring = (after ?? before)!.revision.ring;
      changes.push({ id: feature.id, name: feature.name, category: feature.category,
        kind: reversed ? kind === 'added' ? 'removed' : kind === 'removed' ? 'added' : kind : kind,
        lon: ring.reduce((sum, item) => sum + item[0], 0) / ring.length,
        lat: ring.reduce((sum, item) => sum + item[1], 0) / ring.length,
        before: reversed ? after : before, after: reversed ? before : after });
    }
  }
  return changes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

const COLOR: Record<ChangeKind, [number, number, number]> = {
  added: [16, 185, 129], removed: [244, 91, 105], modified: [245, 173, 43]
};

@Component({
  selector: 'app-root', standalone: true, imports: [FormsModule],
  templateUrl: './app.component.html', styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('leftCanvas', { static: true }) leftCanvas!: ElementRef<HTMLDivElement>;
  @ViewChild('rightCanvas', { static: true }) rightCanvas!: ElementRef<HTMLDivElement>;

  readonly listLimit = LIST_LIMIT;
  readonly mode = signal<MapMode>('2d');
  readonly scene = signal<Scene>('satellite');
  readonly leftEpoch = signal<number>(SCENES.satellite.left);
  readonly rightEpoch = signal<number>(SCENES.satellite.right);
  readonly linked = signal(true);
  readonly showBuildings = signal(true);
  readonly showChanges = signal(true);
  readonly busy = signal(true);
  readonly error = signal('');
  readonly selectedId = signal<string | null>(null);
  readonly changeFilter = signal<ChangeKind | 'all'>('all');
  readonly viewport = signal<ViewportBounds | null>(null);
  readonly timelineTarget = signal<Side>('right');
  readonly playing = signal(false);
  readonly fps = signal(0);
  private readonly loadTestFeatures = signal<DemoFeature[]>([]);
  readonly sceneLabel = computed(() => SCENES[this.scene()].label);
  readonly epochs = computed(() => SCENES[this.scene()].epochs);
  readonly features = computed(() => {
    const scene = this.scene();
    return scene === 'satellite' ? REAL_FEATURES : scene === 'images' ? DEMO_FEATURES : this.loadTestFeatures();
  });
  readonly changes = computed(() => makeComparison(this.features(), this.leftEpoch(), this.rightEpoch()));
  readonly mapChanges = computed(() => this.changes().filter(c => this.changeFilter() === 'all' || this.changeFilter() === c.kind));
  readonly viewportChanges = computed(() => this.changes().filter(c => changeIsInViewport(c, this.viewport())));
  readonly filteredChanges = computed(() => this.viewportChanges().filter(c => this.changeFilter() === 'all' || this.changeFilter() === c.kind));
  readonly listedChanges = computed(() => this.filteredChanges().slice(0, LIST_LIMIT));
  readonly count = computed(() => ({
    added: this.viewportChanges().filter(x => x.kind === 'added').length,
    removed: this.viewportChanges().filter(x => x.kind === 'removed').length,
    modified: this.viewportChanges().filter(x => x.kind === 'modified').length
  }));
  readonly selectedChange = computed(() => this.changes().find(c => c.id === this.selectedId()) ?? null);
  readonly visibleLeft = computed(() => this.features().filter(f => atEpoch(f, this.leftEpoch())).length);
  readonly visibleRight = computed(() => this.features().filter(f => atEpoch(f, this.rightEpoch())).length);
  readonly stops = computed(() => SCENES[this.scene()].stops);
  readonly years = computed(() => [...new Set(this.epochs().map(yearOf))]);
  // Number of changes between each timeline stop and the one before it.
  readonly timeline = computed(() => this.stops().map((epoch, index, all) => ({
    epoch, month: MONTHS[monthOf(epoch) - 1], year: yearOf(epoch),
    firstOfYear: index === 0 || yearOf(all[index - 1]) !== yearOf(epoch),
    changes: index === 0 ? null : makeComparison(this.features(), all[index - 1], epoch).length
  })));
  readonly label = epochLabel;
  readonly yearOf = yearOf;
  readonly monthOf = monthOf;

  // The timeline stop whose imagery a month shows: the latest stop up to that month.
  stopOf(epoch: number): number {
    const stops = this.stops();
    return [...stops].reverse().find(stop => stop <= epoch) ?? stops[0];
  }

  imageryNote(side: Side): string {
    const stop = this.stopOf(side === 'left' ? this.leftEpoch() : this.rightEpoch());
    return this.scene() === 'satellite' ? `Imagery ${WAYBACK_RELEASES[stop].date}` : this.scene() === 'images' ? `Image ${epochLabel(stop)}` : '';
  }

  private panes: Partial<Record<Side, Pane>> = {};
  private activeSide: Side = 'left';
  private subscriptions: Array<{ remove(): void }> = [];
  private symbols = new Map<string, SimpleFillSymbol | PolygonSymbol3D>();
  private playTimer: ReturnType<typeof setInterval> | undefined;
  private instanceId = 0;
  private disposed = false;

  ngAfterViewInit(): void {
    void this.createViews();
    this.trackFps();
  }

  // Frame-rate readout for the load test, so performance can be judged on the presenter's own GPU.
  private trackFps(): void {
    let frames = 0;
    let started = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      frames++;
      if (now - started >= 1000) {
        this.fps.set(Math.round(frames * 1000 / (now - started)));
        frames = 0;
        started = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private makeBackdrops(): Map<number, Layer> {
    const scene = this.scene();
    const backdrops = new Map<number, Layer>();
    if (scene === 'loadtest') return backdrops;
    for (const epoch of this.stops()) {
      backdrops.set(epoch, scene === 'satellite' ? this.waybackLayer(epoch) : this.rasterLayer(epoch));
    }
    return backdrops;
  }

  private makeBasemap(backdrops: Map<number, Layer>): Basemap {
    if (this.scene() === 'satellite') {
      return new Basemap({ title: 'World Imagery Wayback', baseLayers: [...backdrops.values()] });
    }
    return new Basemap({ title: 'OpenStreetMap', baseLayers: [new OpenStreetMapLayer()] });
  }

  private async createViews(keepCamera = true): Promise<void> {
    this.instanceId++;
    const id = this.instanceId;
    this.busy.set(true);
    this.error.set('');
    const config = SCENES[this.scene()];
    const existing = keepCamera ? this.panes.left?.view : undefined;
    const lon = existing?.center?.longitude;
    const lat = existing?.center?.latitude;
    const center: [number, number] = lon != null && lat != null ? [lon, lat] : [...config.center];
    const zoom = existing?.zoom && Number.isFinite(existing.zoom) ? existing.zoom : config.zoom;
    this.clearViews();
    try {
      const zoomFactor = Math.min(4, Math.max(0.6, Math.pow(2, 15.25 - zoom)));
      for (const side of ['left', 'right'] as const) {
        const backdrops = this.makeBackdrops();
        const map = new ArcMap({ basemap: this.makeBasemap(backdrops), ground: { surfaceColor: '#a69b77' } });
        const buildings = this.buildingLayer();
        const overlay = new GraphicsLayer({ title: 'Predefined change highlights' });
        if (this.scene() === 'images') map.addMany([...backdrops.values()]);
        map.addMany([buildings, overlay]);
        const container = side === 'left' ? this.leftCanvas.nativeElement : this.rightCanvas.nativeElement;
        const view: GISView = this.mode() === '2d'
          ? new MapView({ container, map, center, zoom, constraints: { snapToZoom: false } })
          : new SceneView({ container, map, qualityProfile: 'medium',
              camera: new Camera({ position: { x: center[0], y: center[1] - 0.012 * zoomFactor,
                z: 1450 * zoomFactor, spatialReference: { wkid: 4326 } }, heading: 0, tilt: 58 }) });
        this.panes[side] = { map, view, backdrops, buildings, overlay, highlights: new Map() };
        this.drawEpoch(side);
      }
      const left = this.panes.left!.view;
      const right = this.panes.right!.view;
      await Promise.all([left.when(), right.when()]);
      if (id !== this.instanceId || this.disposed) return;
      right.viewpoint = left.viewpoint.clone();
      this.updateViewport(left);
      for (const side of ['left', 'right'] as const) {
        const source = this.panes[side]!.view;
        // Mouse-wheel zoom does not set `interacting`, so the map under the pointer also claims the lead.
        const container = side === 'left' ? this.leftCanvas.nativeElement : this.rightCanvas.nativeElement;
        const claim = () => { this.activeSide = side; };
        container.addEventListener('pointerenter', claim);
        this.subscriptions.push({ remove: () => container.removeEventListener('pointerenter', claim) });
        this.subscriptions.push(reactiveUtils.watch(
          () => [source.interacting, source.viewpoint] as const,
          ([interacting, viewpoint]) => {
            if (interacting) this.activeSide = side;
            if (!this.linked()) return;
            if (!viewpoint || this.activeSide !== side) return;
            const target = this.panes[side === 'left' ? 'right' : 'left']?.view;
            if (target) target.viewpoint = viewpoint.clone();
          }
        ));
        this.subscriptions.push(reactiveUtils.watch(
          () => [source.stationary, source.extent] as const,
          ([stationary]) => {
            if (stationary && (this.activeSide === side || !this.linked())) this.updateViewport(source);
          }
        ));
      }
    } catch (err) {
      if (id === this.instanceId) this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === this.instanceId && !this.disposed) this.busy.set(false);
    }
  }

  private updateViewport(view: GISView): void {
    const extent = view.extent;
    if (!extent) return;
    this.viewport.set({
      xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax,
      webMercator: extent.spatialReference.isWebMercator
    });
  }

  private clearViews(): void {
    for (const handle of this.subscriptions) handle.remove();
    this.subscriptions = [];
    this.panes.left?.view.destroy();
    this.panes.right?.view.destroy();
    this.panes = {};
  }

  private makePolygon(ring: number[][]): Polygon {
    return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
  }

  private rasterLayer(epoch: number): MediaLayer {
    return new MediaLayer({
      title: `Synthetic aerial epoch ${epoch}`,
      visible: false,
      source: [new ImageElement({
        image: `epochs/${yearOf(epoch)}.png`,
        georeference: new ExtentAndRotationGeoreference({
          extent: new Extent({ ...DEMO_BOUNDS, spatialReference: { wkid: 4326 } })
        })
      })]
    });
  }

  private waybackLayer(epoch: number): WebTileLayer {
    const release = WAYBACK_RELEASES[epoch];
    return new WebTileLayer({
      title: `World Imagery Wayback ${release.date}`,
      visible: false,
      urlTemplate: `${WAYBACK_TILES}/${release.id}/{level}/{row}/{col}`,
      copyright: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
  }

  // One row per building version, so switching epoch is a filter instead of a redraw.
  private buildingLayer(): FeatureLayer {
    let oid = 0;
    const source = this.features().flatMap(feature => feature.revisions.map((revision, index) => new Graphic({
      geometry: this.makePolygon(revision.ring),
      attributes: { oid: ++oid, feature_id: feature.id, height: revision.height, valid_from: revision.epoch,
        valid_to: feature.revisions[index + 1]?.epoch ?? feature.retired ?? 999912 }
    })));
    return new FeatureLayer({
      title: 'Buildings', source, objectIdField: 'oid', geometryType: 'polygon', spatialReference: { wkid: 4326 },
      fields: [
        { name: 'oid', type: 'oid' }, { name: 'feature_id', type: 'string' }, { name: 'height', type: 'double' },
        { name: 'valid_from', type: 'integer' }, { name: 'valid_to', type: 'integer' }
      ],
      renderer: this.buildingRenderer()
    });
  }

  private buildingRenderer(): SimpleRenderer {
    if (this.mode() === '2d') {
      return new SimpleRenderer({ symbol: new SimpleFillSymbol({ color: [92, 166, 183, 0.06], outline: { color: [119, 218, 238, 0.45], width: 0.6 } }) });
    }
    return new SimpleRenderer({
      symbol: new PolygonSymbol3D({ symbolLayers: [new ExtrudeSymbol3DLayer({ material: { color: [56, 132, 157, 0.85] } })] }),
      visualVariables: [new SizeVariable({ field: 'height', valueUnit: 'meters' })]
    });
  }

  // Symbols are shared between graphics; a few thousand highlights should not mean a few thousand symbols.
  // A ghost marks a footprint that does not exist in this map's epoch, so the two maps read differently.
  private changeSymbol(kind: ChangeKind, height: number, selected: boolean, ghost: boolean): SimpleFillSymbol | PolygonSymbol3D {
    const size = Math.round(height);
    const key = `${this.mode()}|${kind}|${selected}|${ghost}|${this.mode() === '2d' || ghost ? 0 : size}`;
    let symbol = this.symbols.get(key);
    if (symbol) return symbol;
    const [r, g, b] = COLOR[kind];
    if (this.mode() === '2d') {
      symbol = ghost
        ? new SimpleFillSymbol({ color: [r, g, b, 0],
            outline: { color: [r, g, b, 0.9], width: selected ? 2.5 : 1.2, style: 'dash' } })
        : new SimpleFillSymbol({ color: [r, g, b, selected ? 0.6 : 0.42],
            outline: { color: [r, g, b, 1], width: selected ? 3 : 2 } });
    } else {
      symbol = new PolygonSymbol3D({ symbolLayers: [
        new ExtrudeSymbol3DLayer({ size: ghost ? 1 : Math.max(1, size + (selected ? 2 : 0.6)),
          material: { color: [r, g, b, ghost ? 0.08 : selected ? 0.75 : 0.5] },
          edges: new SolidEdges3D({ color: [r, g, b, ghost ? 0.7 : 1], size: selected ? 2.5 : ghost ? 0.8 : 1.3 }) })
      ] });
    }
    this.symbols.set(key, symbol);
    return symbol;
  }

  private sideSnapshot(change: Change, side: Side): Snapshot | undefined {
    return side === 'left' ? change.before : change.after;
  }

  // The footprint highlighted on this side: its own version if it exists here, otherwise a ghost of the other epoch's.
  private changeItem(change: Change, side: Side): { item: Snapshot; ghost: boolean } | undefined {
    const own = this.sideSnapshot(change, side);
    if (own) return { item: own, ghost: false };
    const other = change.after ?? change.before;
    return other ? { item: other, ghost: true } : undefined;
  }

  private drawEpoch(side: Side): void {
    const pane = this.panes[side];
    if (!pane) return;
    const epoch = side === 'left' ? this.leftEpoch() : this.rightEpoch();
    const stop = this.stopOf(epoch);
    for (const [backdropEpoch, layer] of pane.backdrops) layer.visible = backdropEpoch === stop;
    pane.buildings.definitionExpression = `valid_from <= ${epoch} AND valid_to > ${epoch}`;
    pane.buildings.visible = this.showBuildings();
    pane.overlay.visible = this.showChanges();
    this.drawChanges(side);
  }

  private drawChanges(side: Side): void {
    const pane = this.panes[side];
    if (!pane) return;
    pane.overlay.removeAll();
    pane.highlights.clear();
    const graphics: Graphic[] = [];
    for (const change of this.mapChanges()) {
      const entry = this.changeItem(change, side);
      if (!entry) continue;
      const graphic = new Graphic({
        geometry: this.makePolygon(entry.item.revision.ring),
        symbol: this.changeSymbol(change.kind, entry.item.revision.height, change.id === this.selectedId(), entry.ghost),
        attributes: { id: change.id, kind: change.kind, name: change.name }
      });
      pane.highlights.set(change.id, graphic);
      graphics.push(graphic);
      // A modified footprint also shows its other version as a ghost, so the edit itself is visible.
      const other = side === 'left' ? change.after : change.before;
      if (change.kind === 'modified' && other && this.mode() === '2d') {
        graphics.push(new Graphic({
          geometry: this.makePolygon(other.revision.ring),
          symbol: this.changeSymbol(change.kind, other.revision.height, false, true)
        }));
      }
    }
    pane.overlay.addMany(graphics);
  }

  private redrawBoth(): void { this.drawEpoch('left'); this.drawEpoch('right'); }

  private setSelected(id: string | null): void {
    const previous = this.selectedId();
    this.selectedId.set(id);
    for (const side of ['left', 'right'] as const) {
      for (const [changeId, selected] of [[previous, false], [id, true]] as const) {
        const graphic = changeId ? this.panes[side]?.highlights.get(changeId) : undefined;
        const change = changeId ? this.changes().find(c => c.id === changeId) : undefined;
        const entry = change && this.changeItem(change, side);
        if (graphic && change && entry) graphic.symbol = this.changeSymbol(change.kind, entry.item.revision.height, selected, entry.ghost);
      }
    }
  }

  setEpoch(side: Side, value: number | string): void {
    const epoch = Number(value);
    if (!this.epochs().includes(epoch)) return;
    (side === 'left' ? this.leftEpoch : this.rightEpoch).set(epoch);
    if (!this.changes().some(c => c.id === this.selectedId())) this.selectedId.set(null);
    this.redrawBoth();
  }

  // The twelve months of the side's current year; months with no epoch are shown but disabled.
  monthOptions(side: Side): { month: number; label: string; available: boolean }[] {
    const year = yearOf(side === 'left' ? this.leftEpoch() : this.rightEpoch());
    return MONTHS.map((label, index) => ({ month: index + 1, label, available: this.epochs().includes(year * 100 + index + 1) }));
  }

  setMonth(side: Side, month: number | string): void {
    const epoch = side === 'left' ? this.leftEpoch() : this.rightEpoch();
    this.setEpoch(side, yearOf(epoch) * 100 + Number(month));
  }

  // Picking a year keeps the month when that year has it, otherwise takes the nearest month it does have.
  setYear(side: Side, year: number | string): void {
    const month = monthOf(side === 'left' ? this.leftEpoch() : this.rightEpoch());
    const candidates = this.epochs().filter(e => yearOf(e) === Number(year));
    const nearest = [...candidates].sort((a, b) => Math.abs(monthOf(a) - month) - Math.abs(monthOf(b) - month))[0];
    if (nearest) this.setEpoch(side, nearest);
  }

  setMode(mode: MapMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    void this.createViews();
  }

  async setScene(scene: Scene): Promise<void> {
    if (scene === this.scene()) return;
    this.stopPlaying();
    this.busy.set(true);
    this.error.set('');
    if (scene === 'loadtest' && !this.loadTestFeatures().length) {
      try {
        const response = await fetch('data/load-test.json');
        if (!response.ok) throw new Error(`load-test.json: HTTP ${response.status}`);
        this.loadTestFeatures.set(await response.json());
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : String(err));
        this.busy.set(false);
        return;
      }
    }
    const config = SCENES[scene];
    this.scene.set(scene);
    this.leftEpoch.set(config.left);
    this.rightEpoch.set(config.right);
    this.selectedId.set(null);
    this.changeFilter.set('all');
    this.viewport.set(null);
    await this.createViews(false);
  }

  toggleSync(): void {
    this.linked.update(value => !value);
    if (this.linked() && this.panes.left && this.panes.right) {
      this.activeSide = 'left';
      this.panes.right.view.viewpoint = this.panes.left.view.viewpoint.clone();
    }
  }

  toggleChanges(): void {
    this.showChanges.update(v => !v);
    for (const side of ['left', 'right'] as const) {
      const overlay = this.panes[side]?.overlay;
      if (overlay) overlay.visible = this.showChanges();
    }
  }

  toggleBuildings(): void {
    this.showBuildings.update(v => !v);
    for (const side of ['left', 'right'] as const) {
      const buildings = this.panes[side]?.buildings;
      if (buildings) buildings.visible = this.showBuildings();
    }
  }

  setFilter(filter: ChangeKind | 'all'): void {
    this.changeFilter.set(filter);
    this.drawChanges('left');
    this.drawChanges('right');
  }

  selectChange(change: Change): void {
    this.setSelected(change.id);
    const target = change.after ?? change.before;
    if (!target) return;
    const extent = this.makePolygon(target.revision.ring).extent;
    const view = this.panes[this.activeSide]?.view ?? this.panes.left?.view;
    if (!view || !extent) return;
    if (this.mode() === '2d') {
      void (view as MapView).goTo({ target: extent.expand(6) }, { duration: 550 }).catch(() => {});
    } else {
      void (view as SceneView).goTo({ target: extent.expand(8), tilt: 53 }, { duration: 650 }).catch(() => {});
    }
  }

  async resetView(): Promise<void> {
    const left = this.panes.left?.view;
    if (!left) return;
    const config = SCENES[this.scene()];
    this.activeSide = 'left';
    if (left instanceof MapView) {
      await left.goTo({ center: config.center, zoom: config.zoom }, { animate: false });
    } else {
      const zoomFactor = Math.min(4, Math.max(0.6, Math.pow(2, 15.25 - config.zoom)));
      await left.goTo(new Camera({ position: { x: config.center[0], y: config.center[1] - 0.012 * zoomFactor, z: 1450 * zoomFactor, spatialReference: { wkid: 4326 } },
        heading: 0, tilt: 58 }), { animate: false });
    }
    if (this.linked() && this.panes.right) this.panes.right.view.viewpoint = left.viewpoint.clone();
  }

  pickTimelineEpoch(epoch: number): void { this.setEpoch(this.timelineTarget(), epoch); }

  nextEpoch(): void {
    const stops = this.stops();
    const i = stops.indexOf(this.stopOf(this.rightEpoch()));
    this.setEpoch('right', stops[i < stops.length - 1 ? i + 1 : 0]);
  }

  togglePlay(): void {
    if (this.playing()) { this.stopPlaying(); return; }
    this.playing.set(true);
    this.playTimer = setInterval(() => this.nextEpoch(), 1800);
  }

  private stopPlaying(): void {
    clearInterval(this.playTimer);
    this.playing.set(false);
  }

  ngOnDestroy(): void { this.disposed = true; this.instanceId++; this.stopPlaying(); this.clearViews(); }
}
