"""Compile OSM relation 38566 and Mapzen Skadi N50E006/007 HGT tiles into offline game assets."""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.optimize import minimize
from scipy.ndimage import gaussian_filter1d, map_coordinates

T13_LAT, T13_LON = 50.33783, 6.95077
COUNT = 2604
LON_M = 111320 * np.cos(np.radians(T13_LAT))
LAT_M = 111230


def build(relation, tile_paths, directory):
    elements = json.loads(relation.read_text())['elements']
    nodes = {n['id']: n for n in elements if n['type'] == 'node'}
    ways = {w['id']: w for w in elements if w['type'] == 'way'}
    members = next(r for r in elements if r['type'] == 'relation' and r['id'] == 38566)['members']
    pts, widths, names, last = [], [], [], None
    name = 'Döttinger Höhe'
    for member in members:
        if member['type'] != 'way':
            continue
        way = ways[member['ref']]
        ids, tags = way['nodes'], way['tags']
        assert last is None or last == ids[0], 'disconnected way'
        if tags.get('name') not in (None, 'Nürburgring Nordschleife'):
            name = tags['name']
        for nid in ids[:-1]:
            n = nodes[nid]
            pts.append([(T13_LON - n['lon']) * LON_M, (n['lat'] - T13_LAT) * LAT_M])
            widths.append(float(tags['width']))
            names.append(name)
        last = ids[-1]
    assert members[0]['type'] == 'way' and last == ways[members[0]['ref']]['nodes'][0]
    loop = np.array(pts + [pts[0]])
    dist = np.r_[0., np.cumsum(np.linalg.norm(np.diff(loop, axis=0), axis=1))]
    # Interpolate survey points over long straights without overshooting at unevenly spaced knots.
    chord = CubicSpline(dist, loop, axis=0, bc_type='periodic')
    dense_s = np.arange(0, dist[-1], 2)
    dense = gaussian_filter1d(chord(dense_s), 1.25, axis=0, mode='wrap')
    start = np.argmin(np.sum(dense*dense, axis=1))
    dense = np.roll(dense, -start, axis=0)
    dense_names = np.array(names)[np.searchsorted(dist, (dense_s + dense_s[start]) % dist[-1], side='right')-1]
    dense_widths = np.roll(np.array(widths)[np.searchsorted(dist, dense_s, side='right')-1], -start)
    dense_widths = gaussian_filter1d(dense_widths, 7, mode='wrap')
    tiles = {}
    for lon, path in zip((6, 7), tile_paths):
        pixels = np.frombuffer(gzip.open(path).read(), dtype='>i2')
        size = round(np.sqrt(len(pixels)))
        tiles[lon] = pixels.reshape(size,size).astype(float)

    def elevation(x, z):
        lon, lat = T13_LON-x/LON_M, T13_LAT+z/LAT_M
        result = np.zeros_like(lon)
        for key, tile in tiles.items():
            active = np.floor(lon) == key
            if np.any(active):
                scale = tile.shape[0]-1
                result[active] = map_coordinates(tile, [(51-lat[active])*scale, (lon[active]-key)*scale], order=1, mode='nearest')
        assert result.min() > 150, 'missing terrain tile'
        return result

    heights = gaussian_filter1d(elevation(dense[:,0],dense[:,1]), 16, mode='wrap')
    xyz = np.column_stack([dense[:,0], heights, dense[:,1]])
    closed = np.vstack([xyz,xyz[0]])
    arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(closed,axis=0),axis=1))]
    stations = np.arange(COUNT) * arc[-1]/COUNT
    coordinates = np.column_stack([np.interp(stations, arc, col) for col in closed.T])
    width = np.interp(stations, arc, np.r_[dense_widths,dense_widths[0]])
    ids = np.searchsorted(arc,stations,side='right')-1
    labels = dense_names[ids]
    sections = [[i*8, str(n)] for i,n in enumerate(labels) if i == 0 or n != labels[i-1]]
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/'route.js').open('w') as f:
        f.write('// Derived from OpenStreetMap relation 38566. © OpenStreetMap contributors, ODbL 1.0.\n')
        f.write('export const sections='+json.dumps(sections,ensure_ascii=False,separators=(',',':'))+';\nexport const samples=[\n')
        for (x,y,z),w in zip(coordinates,width):
            f.write(f'[{x:.2f},{y:.2f},{z:.2f},{w:.2f}],\n')
        f.write('];\n')
    # Minimise planar bending energy on a closed path, leaving body clearance at both kerbs.
    points = coordinates[::3, ::2]
    tangent = np.roll(points,-1,axis=0)-np.roll(points,1,axis=0)
    normal = np.column_stack([tangent[:,1],-tangent[:,0]])/np.linalg.norm(tangent,axis=1)[:,None]
    def laplace(v):
        return np.roll(v,1,axis=0)+np.roll(v,-1,axis=0)-2*v
    def objective(offset):
        bend = laplace(points+offset[:,None]*normal)
        diff = offset-np.roll(offset,1)
        energy = np.sum(bend*bend)+.018*np.dot(offset,offset)+.11*np.dot(diff,diff)
        grad = 2*np.sum(laplace(bend)*normal,axis=1)+.036*offset-.22*laplace(offset)
        return energy,grad
    margin = width[::3]/2-1.53
    fit = minimize(objective,np.zeros(len(points)),jac=True,bounds=list(zip(-margin,margin)),method='L-BFGS-B',
                   options={'maxiter':600,'ftol':1e-11})
    offset = CubicSpline(np.arange(0,COUNT+1,3),np.r_[fit.x,fit.x[0]],bc_type='periodic')(np.arange(COUNT))
    offset = np.clip(offset,1.50-width/2,width/2-1.50)
    with (directory/'line.js').open('w') as f:
        f.write('// Minimum-curvature offsets in metres. Derived from OSM relation 38566, ODbL 1.0.\nexport const offsets=[\n')
        for a in range(0,len(offset),32):
            f.write(','.join(f'{v:.2f}' for v in offset[a:a+32])+',\n')
        f.write('];\n')
    step = 50
    lo = np.floor((dense.min(axis=0)-1100)/step).astype(int)*step
    hi = np.ceil((dense.max(axis=0)+1100)/step).astype(int)*step
    x, z = np.meshgrid(np.arange(lo[0],hi[0]+1,step),np.arange(lo[1],hi[1]+1,step))
    heights_grid = np.rint(elevation(x,z)).astype(int)
    with (directory/'relief.js').open('w') as f:
        f.write('// Mapzen Terrain Tiles / EU-DEM. See CREDITS.md. Heights in metres.\n')
        f.write(f'export const origin=[{lo[0]},{lo[1]}], spacing={step}, columns={x.shape[1]};\nexport const heights=[\n')
        for row in heights_grid:
            f.write(','.join(map(str,row))+',\n')
        f.write('];\n')
    print('Mapped centreline', round(arc[-1],1), 'm. Timing stations 20,832 m. Elevation', np.round(coordinates[:,1].min()),np.round(coordinates[:,1].max()), 'm.')
    print('Sections:',sections)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('relation',type=Path)
    parser.add_argument('tile',nargs=2,type=Path)
    args=parser.parse_args()
    build(args.relation,args.tile,Path(__file__).resolve().parents[1]/'assets/nordschleife')
