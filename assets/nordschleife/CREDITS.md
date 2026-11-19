# Nordschleife

The derived data in `route.js` uses the ordered circuit, section names and widths from © OpenStreetMap contributors, licensed under the Open Database License 1.0. It is available in machine-readable form in this directory. Processing projects the coordinates into metres west/north of T13, smooths and resamples the closed circuit, then assigns timing stations every eight metres. [OSM relation 38566](https://www.openstreetmap.org/relation/38566) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Road and landscape elevations are derived from Mapzen Terrain Tiles, produced with EU-DEM and Copernicus data and information funded by the European Union. The two Skadi tiles are N50E006 and N50E007. [Terrain Tiles dataset](https://registry.opendata.aws/terrain-tiles/) · [Terrain source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

The public circuit timing distance is 20.832 km, with the timing line at T13. [Nürburgring record drives](https://nuerburgring.de/info/nuerburgring/records?locale=en).

The orthophotos `eifel-aerial.webp` and `t13-aerial.webp` are resampled and compressed DOP20 WMS exports. The second is a 0.4 m/pixel inset of the T13 paddock. ©GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]. [State survey and mapping office](https://lvermgeo.rlp.de/geodaten-geoshop/open-data/) · [Data licence Germany, attribution 2.0](https://www.govdata.de/dl-de/by-2-0).

`roadside.js` and `woodland.js` are derived from OpenStreetMap ways and multipolygons around the circuit, © OpenStreetMap contributors, ODbL 1.0. Building envelopes, surveyed protection lines, wooded areas and the T13 pit lane have been simplified and projected into the same coordinate system as the route. [T13 grandstand](https://www.openstreetmap.org/way/34435441) · [T13 working apron](https://www.openstreetmap.org/way/32894842).

`material-detail.webp` combines the luminance detail of three Poly Haven scans, [Asphalt Track](https://polyhaven.com/a/asphalt_track), [Grass Ground](https://polyhaven.com/a/grass_ground) and [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02). These assets are distributed under [CC0](https://polyhaven.com/license).
