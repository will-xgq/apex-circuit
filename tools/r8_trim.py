"""Make packed base-color maps from the optical and trim details in the two reference sheets."""
import bpy
import numpy as np

# Scene-linear Suzuka silver. All four projections meet on this paint value.
PAINT = (.51, .525, .545)


def shut_lines(rgb, scale, offset, paths):
    height,width=rgb.shape[:2]
    coverage=np.zeros((height,width),dtype=np.float32)
    for points in paths:
        points=np.asarray(points)*scale+offset
        padded=np.concatenate(([points[0]],points,[points[-1]]))
        for a,b,c,d in zip(padded,padded[1:],padded[2:],padded[3:]):
            samples=[]
            for t in np.linspace(0,1,7):
                samples.append(.5*(2*b+(c-a)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
            for start,end in zip(samples,samples[1:]):
                dx,dy=end-start
                left,top=np.floor(np.minimum(start,end)-2).astype(int)
                right,bottom=np.ceil(np.maximum(start,end)+2).astype(int)
                y,x=np.mgrid[top:bottom,left:right]+.5
                k=np.clip(((x-start[0])*dx+(y-start[1])*dy)/max(.0001,dx*dx+dy*dy),0,1)
                dist=np.hypot(x-start[0]-k*dx,y-start[1]-k*dy)
                patch=coverage[top:bottom,left:right]
                np.maximum(patch,np.clip(1.05-dist,0,1),out=patch)
    rgb[:,:,:3] *= 1-.50*coverage[:,:,None]


def trim_sheet(path, views, name, lines):
    source = bpy.data.images.load(str(path))
    width, height = source.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    source.pixels.foreach_get(pixels)
    original = pixels.reshape(height, width, 4)[::-1]
    result = np.empty_like(original)
    # Blender byte-backed image buffers expose display-encoded RGB.
    result[:, :, :3] = 1.055 * np.power(PAINT, 1/2.4) - .055
    result[:, :, 3] = 1
    for scale, offset, polygons in views:
        for polygon in polygons:
            points = np.asarray(polygon) * scale + offset
            left, top = np.maximum(0, np.floor(points.min(axis=0) - 2).astype(int))
            right, bottom = np.minimum([width, height], np.ceil(points.max(axis=0) + 2).astype(int))
            y, x = np.mgrid[top:bottom, left:right] + .5
            inside = np.zeros(x.shape, dtype=bool)
            distance = np.full(x.shape, np.inf)
            for a, b in zip(points, np.roll(points, -1, axis=0)):
                dx, dy = b-a
                if dy:
                    inside ^= ((a[1] > y) != (b[1] > y)) & (x < a[0] + dx*(y-a[1])/dy)
                t = np.clip(((x-a[0])*dx + (y-a[1])*dy)/(dx*dx+dy*dy), 0, 1)
                distance = np.minimum(distance, np.hypot(x-a[0]-t*dx, y-a[1]-t*dy))
            coverage = np.clip(.5 + np.where(inside, distance, -distance)/1.6, 0, 1)[..., None]
            region = result[top:bottom, left:right, :3]
            region += (original[top:bottom, left:right, :3] - region) * coverage
    for scale, offset, paths in lines:
        shut_lines(result,scale,offset,paths)
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.pixels.foreach_set(np.ascontiguousarray(result[::-1]).ravel())
    image.pack()
    bpy.data.images.remove(source)
    return image


def make_trim(design):
    lamp = [(292,128),(393,147),(361,168),(291,160)]
    intake = [(292,163),(318,170),(343,178),(362,225),(359,228),(311,226),(297,184)]
    slot = [(288,180),(300,217),(301,229),(286,237)]
    top_slot = [(395,150),(447,147),(448,153),(383,155)]
    features = [lamp, intake, slot, top_slot]
    front = features + [[(958-x,y) for x,y in shape] for shape in features]
    front += [[(371,170),(397,154),(559,154),(587,171),(568,235),(392,235)],
              [(452,148),(505,148),(508,153),(450,153)]]
    hatch = [(583,386),(711,386),(718,392),(722,420),(724,464),(723,504),
             (719,535),(712,547),(583,547)]
    shut=[(324,367),(295,371),(258,378),(223,389),(190,404),(169,416),(166,435),(166,467)]
    top_lines=[shut,[(x,934-y) for x,y in shut]]
    upper = trim_sheet(design/'orthographic.png', [(1.6,(0,0),front+[hatch])],
                       'Optics and engine glass', [(1.6,(0,0),top_lines)])
    flank = [
        [(487,247),(552,249),(567,252),(568,258),(549,310),(537,328),(522,334),(465,340)],
        [(438,248),(466,249),(463,255),(440,254)],
        [(248,253),(261,253),(263,257),(249,257)],
        [(266,354),(459,335),(460,339),(452,346),(269,359)],
        [(717,244),(732,238),(741,256),(722,265)],
    ]
    rear = [
        [(163,216),(185,214),(259,214),(277,216),(283,221),(294,241),(289,250),(162,250)],
        [(492,240),(502,220),(515,215),(594,214),(619,216),(622,250),(495,250)],
        [(160,252),(623,252),(623,293),(618,300),(164,300),(160,294)],
        [(172,323),(195,320),(245,320),(254,329),(530,329),(537,321),(599,320),(612,324),
         (628,378),(622,405),(162,405),(154,380)],
        [(296,229),(329,229),(330,242),(296,243)],[(361,217),(428,217),(428,241),(361,241)],
    ]
    door=[(282,229),(274,237),(270,254),(271,291),(273,329),(274,349),(279,354),
          (313,354),(368,350),(424,345),(454,342),(462,337),(469,317),(481,278),(488,251),(492,226)]
    side = trim_sheet(design/'rodin-views.png', [(1,(0,512),flank),(1,(768,512),rear)],
                      'Side blades and rear optics', [(1,(0,512),[door])])
    return upper, side
