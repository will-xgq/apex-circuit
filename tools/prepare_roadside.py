"""Build offline roadside geometry from OSM API map JSON and an LVermGeoRP DOP20 WMS image.

Use the same west/north metre projection as prepare_nordschleife.py. The north-up aerial
image covers the bounds of relief.js. Requires numpy, scipy, shapely and Pillow.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import median_filter, gaussian_filter1d
from shapely import LineString, Point, Polygon, STRtree
from shapely.ops import polygonize, triangulate, unary_union
from shapely.geometry.polygon import orient

from prepare_nordschleife import T13_LAT, T13_LON, LON_M, LAT_M

DEST = Path(__file__).resolve().parents[1] / 'assets/nordschleife'
BOUNDS = -5000, -1200, 3300, 5900
CELL = 10

def build(osm, aerial, pit_aerial=None):
    data = json.loads(osm.read_text())['elements']
    nodes = {n['id']: ((T13_LON-n['lon'])*LON_M, (n['lat']-T13_LAT)*LAT_M) for n in data if n['type']=='node'}
    ways = {w['id']: w for w in data if w['type']=='way'}
    def coords(w):
        return [nodes[n] for n in w['nodes'] if n in nodes]
    def line(w):
        points = coords(w)
        return LineString(points) if len(points)>1 else LineString()
    def poly(w):
        points = coords(w)
        return Polygon(points).buffer(0) if len(points)>3 and points[0]==points[-1] else Polygon()
    def wood(t):
        return t.get('natural') in ('wood','scrub') or t.get('landuse')=='forest'
    def pairs(pts):
        return [[round(x,1),round(z,1)] for x,z in pts]
    samples = json.loads((DEST/'route.js').read_text().split('samples=')[1].replace(',\n];','\n]'))
    road = np.array(samples)[:,[0,2]]
    circuit = LineString(np.vstack((road,road[0])))
    tangent = np.roll(road,-1,axis=0)-np.roll(road,1,axis=0)
    normal = np.stack((tangent[:,1],-tangent[:,0]),axis=1) / np.linalg.norm(tangent,axis=1)[:,None]
    by_type = {k:[] for k in ('steel','fence')}
    buildings, surfaces, lanes, bridges = [], [], [], []
    xmin,zmin,xmax,zmax = BOUNDS
    forest_map = Image.new('L',((xmax-xmin)//CELL,(zmax-zmin)//CELL))
    draw = ImageDraw.Draw(forest_map)
    def fill_forest(p):
        polygons = [p] if p.geom_type=='Polygon' else list(p.geoms)
        for part in polygons:
            if part.is_empty or part.geom_type!='Polygon': continue
            for ring,fill in [(part.exterior,1)]+[(r,0) for r in part.interiors]:
                draw.polygon([((x-xmin)/CELL,(z-zmin)/CELL) for x,z in ring.coords],fill=fill)
    for w in ways.values():
        t=w.get('tags',{}); g=line(w)
        if g.is_empty: continue
        if wood(t): fill_forest(poly(w))
        if t.get('barrier') in ('guard_rail','fence','wall','jersey_barrier') and g.distance(circuit)<38:
            key='fence' if t['barrier']=='fence' else 'steel'
            # Separate segments so transverse roads and gates cannot register as parallel rails.
            for a,b in zip(g.coords,list(g.coords)[1:]):
                if a!=b: by_type[key].append(LineString([a,b]))
        d=g.distance(circuit)
        if d>520: continue
        t13=t.get('name')=='Boxengasse an T13'; gp_pit=t.get('raceway')=='pitlane'
        if t13 or gp_pit or (t.get('highway')=='raceway' and t.get('name','').startswith('Anbindung')):
            lanes.append([7.0 if t13 else 8.5 if gp_pit else 9.0, pairs(g.simplify(.4).coords)])
        if t.get('bridge')=='yes' and t.get('highway') in ('primary','tertiary','secondary','unclassified','service','track') and g.distance(circuit)<3 and g.length>6:
            bridges.append([7.5 if t['highway'] in ('primary','tertiary','secondary') else 4.3, pairs(g.simplify(1).coords)])
        tstand=w['id']==34435441
        if not(t.get('building') or tstand or (t.get('amenity')=='parking' and d<95) or (t.get('surface')=='gravel' and 'gravel' in t.get('raceway',''))): continue
        p=poly(w).simplify(.52,preserve_topology=True)
        if p.geom_type!='Polygon' or p.area<9: continue
        p=orient(p,sign=1.0); pts=list(p.exterior.coords)[:-1]
        idx={pt:i for i,pt in enumerate(pts)}
        tris=[[idx[a] for a in list(tri.exterior.coords)[:3]] for tri in triangulate(p) if p.covers(tri) and all(a in idx for a in list(tri.exterior.coords)[:3])]
        if t.get('amenity')=='parking' or t.get('raceway')=='gravel trap':
            surfaces.append([int(t.get('surface') in ('fine_gravel','gravel') or t.get('raceway')=='gravel trap'),pairs(pts),tris]);continue
        name=t.get('name','')
        kind='stand' if tstand else 'garage' if (t.get('building') in ('garage','garages','industrial') or name=='Werkstätten') else 'hall' if p.area>420 or t.get('building') in ('retail','commercial','public','roof') else 'house'
        if kind=='house' and d>240:continue
        try: height=float(t.get('height', '0').split(' ')[0]) or float(t.get('building:levels','0'))*3
        except ValueError: height=0
        height=height or {'stand':6,'garage':4.1,'hall':6.3,'house':5.5}[kind]
        buildings.append([kind,round(min(32,height),1),pairs(pts),tris])
    for rel in data:
        if rel['type']!='relation' or not wood(rel.get('tags',{})):continue
        outlines={r:[] for r in ['outer','inner']}
        for m in rel['members']:
            role=m.get('role') or 'outer'
            if role in outlines and m['type']=='way' and m['ref'] in ways: outlines[role].append(line(ways[m['ref']]))
        shell=unary_union(list(polygonize(outlines['outer'])))
        holes=unary_union(list(polygonize(outlines['inner'])))
        if not shell.is_empty:fill_forest(shell.difference(holes))
    rows=[]
    for row in np.array(forest_map):
        edges=np.flatnonzero(np.diff(np.r_[0,row,0])).tolist();rows.append(edges)
    with (DEST/'woodland.js').open('w') as f:
        f.write('// OSM forest and scrub polygons, including clearings. ODbL 1.0.\nexport const woodlandRows='+json.dumps(rows,separators=(',',':'))+';\n')
    trees=[]
    for n in data:
        if n['type']=='node' and n.get('tags',{}).get('natural')=='tree':
            x,z=nodes[n['id']]
            if circuit.distance(Point(x,z))<400:trees.append([round(x,1),round(z,1)])
    for w in ways.values():
        if w.get('tags',{}).get('natural')!='tree_row':continue
        g=line(w)
        if g.is_empty or circuit.distance(g)>300:continue
        trees.extend(pairs([(g.interpolate(d).x,g.interpolate(d).y) for d in np.arange(2,g.length,7.5)]))
    profiles={}
    for key,segments in by_type.items():
        tree=STRtree(segments); offsets=np.full((len(road),2),np.nan)
        for i,(center,n) in enumerate(zip(road,normal)):
            for k,side in enumerate((-1,1)):
                side_vec=n*side; ray=LineString([center,center+side_vec*40]);candidates=[]
                for j in tree.query(ray,predicate='intersects'):
                    seg=segments[j];a,b=np.array(seg.coords);v=b-a
                    if abs(v@side_vec)>np.linalg.norm(v)*.54:continue
                    hit=ray.intersection(seg)
                    if hit.geom_type!='Point':continue
                    dist=hit.distance(Point(center))
                    if samples[i][3]*.5+.4<dist<34:candidates.append(dist)
                if candidates:offsets[i,k]=min(candidates)
        print(key,'mapped samples on each side',np.isfinite(offsets).sum(axis=0))
        if key=='steel':
            for k in range(2):
                a=offsets[:,k];mask=np.isfinite(a);good=np.flatnonzero(mask);indices=np.arange(len(a));
                interp=np.interp(indices,good,a[good],period=len(a));gap=np.min([np.abs((indices-i+len(a)/2)%len(a)-len(a)/2) for i in good],axis=0)
                blend=np.clip(1-gap/7,0,1);a[:]=interp*blend+(np.array(samples)[:,3]/2+2)*(1-blend)
                a[:]=gaussian_filter1d(median_filter(a,size=3,mode='wrap'),1,mode='wrap')
                a[:]=np.maximum(a,np.array(samples)[:,3]/2+1.03)
            profiles[key]=offsets
        else:profiles[key]=np.nan_to_num(offsets)
    border=np.column_stack((profiles['steel'],profiles['fence']));
    # Follow the working apron from T13 along the mapped outbound branch to the circuit merge.
    pit = coords(ways[32894842])
    branch = coords(ways[710354617]); join = min(range(len(branch)), key=lambda i: math.dist(pit[-1],branch[i]))
    pit += branch[join+1:]
    for wid in (199642469,199642470): pit += coords(ways[wid])[1:]
    with (DEST/'roadside.js').open('w') as f:
        f.write('// Derived from OpenStreetMap. © OpenStreetMap contributors, ODbL 1.0.\n')
        for name,obj in [('edges',np.rint(border*10).astype(int).tolist()),('buildings',buildings),('pavedAreas',surfaces),('accessRoads',lanes),('bridges',bridges),('pitDeparture',pairs(pit)),('roadsideTrees',trees)]:
            f.write('export const '+name+'='+json.dumps(obj,ensure_ascii=False,separators=(',',':'))+';\n')
    Image.open(aerial).convert('RGB').save(DEST/'eifel-aerial.webp',quality=82,method=6)
    if pit_aerial:
        # This DOP20 inset covers west/north metres [-160,-100] to [180,172].
        Image.open(pit_aerial).convert('RGB').save(DEST/'t13-aerial.webp',quality=86,method=6)
    print(len(buildings),'footprints,',len(surfaces),'paved areas,',len(lanes),'pit/access roads,',len(bridges),'bridges;',round(np.array(forest_map).mean()*100,1),'% wooded')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm',type=Path);parser.add_argument('aerial',type=Path)
    parser.add_argument('--pit-aerial',type=Path);args=parser.parse_args();build(args.osm,args.aerial,args.pit_aerial)
