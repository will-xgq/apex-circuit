"""Build the local R8 exterior study in Blender. Uses metres, Y up and +Z nose in glTF."""
import math
import sys
from bisect import bisect_right
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'design/r8'
ASSETS = ROOT / 'assets/r8'
TAU = math.tau
NOSE, TAIL = 2.2145, -2.2145
FRONT_AXLE, REAR_AXLE = NOSE - .993, TAIL + .786
LIP_JOIN = 29/30

bpy.ops.wm.read_factory_settings(use_empty=True)


def interpolate(knots, z):
    for (a, va), (b, vb) in zip(knots, knots[1:]):
        if z <= b:
            t = min(1, max(0, (z - a) / (b - a)))
            return va + (vb - va) * t
    return knots[-1][1]


def smoothstep(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t*t*(3-2*t)


def material(name, color, metal=0, rough=.45, image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Metallic'].default_value = metal
    node.inputs['Roughness'].default_value = rough
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        mat.node_tree.links.new(tex.outputs['Color'], node.inputs['Base Color'])
    return mat


sys.path.insert(0, str(Path(__file__).resolve().parent))
from r8_trim import PAINT, make_trim

plan_ref, side_ref = make_trim(DESIGN)
side_paint = material('Silver • side and rear', PAINT, .57, .29, side_ref)
plan_paint = material('Silver • nose and upper surfaces', PAINT, .57, .29, plan_ref)
alloy = material('Machined alloy', (.44,.46,.48), .82, .25)
graphite = material('Graphite wheel spokes', (.12,.13,.145), .74, .32)
carbon = material('Satin carbon', (.036,.039,.043), .35, .37)
rubber = material('Tire rubber', (.018,.019,.020), 0, .88)
rubber_edge = material('Tire shoulder', (.031,.032,.033), 0, .80)
liner = material('Wheel arch and undertray', (.013,.015,.017), .02, .82)
rotor = material('Brake rotor', (.29,.29,.28), .77, .42)
caliper_mat = material('Brake calipers', (.34,.038,.025), .32, .4)
silver = material('Suzuka silver', PAINT, .57, .29)
mirror = material('Mirror glass', (.38,.46,.51), .9, .12)
glazing = material('Laminated windshield', (.026,.038,.046), .48, .19)


def side_uv(p):
    _, height, z = p
    pixel = interpolate([(TAIL,747), (REAR_AXLE,644), (FRONT_AXLE,196), (NOSE,43)], z)
    return pixel/1536, 1-(512+396-height*198.3)/1024


def top_uv(p):
    x, _, z = p
    return (476-z*142.1)/960, 1-(467+x*148.2)/640


def rear_uv(p):
    x, y, _ = p
    return (768+393-x*265.8)/1536, 1-(512+440-y*289)/1024


def front_uv(p):
    x, y, _ = p
    return (479+x*223)/960, 1-(275-y*214)/640


def blender(p):
    x, y, z = p
    return x, -z, y


class Part:
    def __init__(self, name, pivot=(0,0,0), explosion=(0,0,0), wheel=False, front=False):
        self.name, self.pivot = name, pivot
        self.skin, self.building_skin = [], False
        self.meta = dict(explosion=list(explosion), wheel=wheel, front=front)
        self.positions, self.indices, self.faces, self.uvs, self.slots, self.materials = [], {}, [], [], [], []

    def face(self, pts, mat, facing, uv=None):
        a,b,c = (Vector(p) for p in pts[:3])
        if (b-a).cross(c-a).dot(Vector(facing)) < 0:
            pts = list(reversed(pts))
        indices=[]
        for p in pts:
            key=tuple(round(x,6) for x in p)
            if key not in self.indices:
                self.indices[key]=len(self.positions)
                self.positions.append(blender([x-y for x,y in zip(p,self.pivot)]))
            indices.append(self.indices[key])
        if len(set(indices)) < 3:
            return
        self.faces.append(indices)
        self.skin.append(self.building_skin)
        self.uvs.extend([uv(p) for p in pts] if uv else [(0,0)]*len(pts))
        if mat not in self.slots:
            self.slots.append(mat)
        self.materials.append(self.slots.index(mat))

    def object(self):
        mesh=bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.positions,[],self.faces)
        mesh.update()
        for mat in self.slots:
            mesh.materials.append(mat)
        for polygon,slot in zip(mesh.polygons,self.materials):
            polygon.material_index=slot
            polygon.use_smooth = self.slots[slot] != liner
        if any(self.skin):
            skin=mesh.attributes.new('exterior_skin', 'BOOLEAN', 'FACE')
            skin.data.foreach_set('value', self.skin)
        uv=mesh.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [x for pair in self.uvs for x in pair])
        obj=bpy.data.objects.new(self.name,mesh)
        bpy.context.collection.objects.link(obj)
        obj.location=blender(self.pivot)
        for key,value in self.meta.items():
            obj[key]=value
        return obj


# Measured elevations and plan widths at longitudinal stations of the coupe.
stations = [
    (TAIL,.94,.791,.776),(-2.10,.948,.819,.765),(-1.85,.967,.892,.795),
    (-1.43,.970,.958,.809),(-1.10,.955,1.038,.804),(-.74,.928,1.127,.800),
    (-.46,.918,1.191,.80),(-.11,.91,1.236,.81),(.18,.914,1.232,.819),
    (.40,.916,1.194,.824),(.64,.925,1.085,.824),(.88,.946,.962,.823),
    (1.09,.961,.866,.830),(1.24,.970,.838,.825),(1.47,.962,.809,.807),
    (1.72,.951,.762,.783),(1.94,.936,.721,.750),(2.11,.919,.680,.718),(NOSE,.899,.649,.693),
]
profiles = [[(row[0],row[col]) for row in stations] for col in (1,2,3)]


# Shape-preserving cubic profiles give the hood and wings a continuous highlight.
depths = [row[0] for row in stations]
slopes = []
for profile in profiles:
    secants = [(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(profile,profile[1:])]
    slopes.append([secants[0]] + [2*a*b/(a+b) if a*b>0 else 0 for a,b in zip(secants,secants[1:])] + [secants[-1]])


def section(z):
    i = max(0, min(len(stations)-2, bisect_right(depths,z)-1))
    h=depths[i+1]-depths[i]
    t=max(0,min(1,(z-depths[i])/h))
    return tuple((1-t)**2*((1+2*t)*p[i][1] + h*t*m[i]) +
                 t*t*((3-2*t)*p[i+1][1] - h*(1-t)*m[i+1]) for p,m in zip(profiles,slopes))


def lip_radius(z):
    return .062*smoothstep(1.80,NOSE,z) - .038*smoothstep(1.84,-TAIL,-z)


def surface(z,u):
    w,ridge,shoulder=section(z)
    lateral=abs(u)
    roll=smoothstep(.62,1.0,lateral)
    cabin=max(0,ridge-shoulder)
    y=ridge*(1-roll)+shoulder*roll-.018*lateral*lateral*(1-roll)
    y+=.018*math.exp(-((lateral-.81)/.15)**2)*(1-min(1,cabin/.29))
    hood=smoothstep(.98,1.31,z)*(1-smoothstep(2.00,NOSE,z))
    crease=.77-.14*smoothstep(1.14,2.06,z)
    y+=hood*(.031*math.exp(-((lateral-crease)/.085)**2)-.011*math.exp(-((lateral-crease+.12)/.12)**2))
    # Roll the top into the vertical flank, with a tangent along the side at the outer edge.
    edge=max(0,(lateral-.90)/.10)*math.pi/2
    width=lateral if lateral<=.90 else .90+.10*math.sin(edge)
    y-=.047*(1-math.cos(edge))
    rounding=.405*smoothstep(1.22,NOSE,z)-.203*smoothstep(1.40,-TAIL,-z)
    return math.copysign(w*width,u), y, z-rounding*lateral**2.8-lip_radius(z)


def arch(z):
    y=.105
    for axle,r in [(FRONT_AXLE,.379),(REAR_AXLE,.384)]:
        d=abs(z-axle)
        if d<=r:
            y=max(y,.335+math.sqrt(max(0,r*r-d*d)))
        elif d<r+.035:
            y=max(y,.105+.230*(1-smoothstep(r,r+.035,d)))
    return y


def wall_bottom(z, end):
    return max(arch(end),.115+.048*smoothstep(1.64,NOSE,z),.115+.082*smoothstep(1.76,-TAIL,-z))


def bumper_roll(z,t):
    # A quarter-round from the hood lip into the fascia, shared with each outer corner.
    angle=min(1,(1-t)/.20)*math.pi/2
    height=t if t<=.8 else 1-.20*(1-math.cos(angle))
    return height, lip_radius(z)*math.sin(angle)


def side_inset(t):
    return .048*(1-t)**2+.023*math.sin(math.pi*t)**2


def sidewall(z,sign,t):
    x,upper,end=surface(z,sign)
    height,dz=bumper_roll(z,t)
    lower=wall_bottom(z,end+dz)
    door=smoothstep(-1.30,-.87,z)*(1-smoothstep(.79,1.19,z))
    belt=.60+.12*smoothstep(-.73,.90,z)
    inset=side_inset(t)+door*(.041*math.exp(-((t-.30)/.21)**2)-.014*math.exp(-((t-belt)/.092)**2))
    return x-sign*inset,lower+(upper-lower)*height,end+dz


def roof_station(z,u):
    # Fit the windshield, A-pillars and quarter lights to actual edges in the body mesh.
    a=abs(u)
    side=smoothstep(.745,.972,a)
    shoulder=1-smoothstep(.972,1,a)
    endglass=(-.52-.60*side) * shoulder - .82*(1-shoulder)
    roof=(.405-.075*min(1,(a/.69)**2)+.60*side)*shoulder+.405*(1-shoulder)
    cowl=1.18-.17*min(1,(a/.69)**2)*shoulder
    return interpolate([(TAIL,TAIL),(-1.36,-1.36),(-.82,endglass),(.405,roof),(1.18,cowl),(1.53,1.53),(NOSE,NOSE)],z)


def shell(body,nose,tail):
    rear_join,front_join=-1.865,1.774
    # Fit the arches to the actual wheel centers after the plan-view nose taper.
    zs={TAIL+(NOSE-TAIL)*i/40 for i in range(41)}
    for axle,radius in [(FRONT_AXLE,.379),(REAR_AXLE,.384)]:
        targets=[axle+radius*math.cos(math.pi*i/13) for i in range(14)]
        targets.extend(axle+sign*(radius+feather) for sign in [-1,1] for feather in [.014,.036])
        for target in targets:
            low,high=TAIL,NOSE
            for _ in range(20):
                z=(low+high)*.5
                if sidewall(z,1,0)[2]<target: low=z
                else: high=z
            zs.add((low+high)*.5)
    anchors=[TAIL,NOSE,rear_join,front_join,-1.36,-.82,-.80,-.41,-.38,.385,.405,.425,1.16,1.18,1.53]
    zs=sorted(set(anchors + [z for z in zs if all(abs(z-k)>.008 for k in anchors)]))
    widths=[0,.20,.39,.52,.59,.64,.675,.69,.72,.745,.755,.80,.85,.90,.935,.962,.972,.987,1]
    us=sorted({sign*u for sign in [-1,1] for u in widths})
    def top(z,u):
        depth=roof_station(z,u)
        cowl=smoothstep(.34,1.12,depth)*(1-smoothstep(1.21,1.53,depth))
        width=interpolate([(0,0),(.69,.69+.158*cowl),(.745,.745+.134*cowl),
                           (.972,.972+.008*cowl),(1,1)],abs(u))
        return surface(depth,math.copysign(width,u))
    for a,b in zip(zs,zs[1:]):
        mid=(a+b)/2
        bumper=nose if mid>front_join else tail if mid<rear_join else body
        for u,v in zip(us,us[1:]):
            lateral=abs((u+v)/2)
            pts=[top(a,u),top(b,u),top(b,v),top(a,v)]
            if lateral<.69 and .405<mid<1.18:
                border=lateral>.675 or mid<.425 or mid>1.16
                body.face(pts,carbon if border else glazing,(0,1,0))
            elif .745<lateral<.972 and -.82<mid<.405:
                border=lateral<.755 or lateral>.962 or mid<-.80 or mid>.385 or -.41<mid<-.38
                body.face(pts,carbon if border else glazing,(0,1,0))
            else:
                body.face(pts,plan_paint,(0,1,0),top_uv)
        for sign in [-1,1]:
            levels=[j/10 for j in range(10)]+[LIP_JOIN,1]
            for lo,hi in zip(levels,levels[1:]):
                pts=[sidewall(a,sign,lo),sidewall(b,sign,lo),sidewall(b,sign,hi),sidewall(a,sign,hi)]
                part=body if lo>=LIP_JOIN else bumper
                part.face(pts,side_paint,(sign,0,0),side_uv)
            def under(z):
                x,y,end=sidewall(z,sign,0)
                return x-sign*.24,y+.009,end
            bumper.face([sidewall(a,sign,0),under(a),under(b),sidewall(b,sign,0)],liner,(0,-1,0))
    return us


def end_panel(body,bumper,front,us):
    z=NOSE if front else TAIL
    sign=1 if front else -1
    def point(u,v):
        x,upper,end=surface(z,u)
        height,dz=bumper_roll(z,v)
        bottom=.115+(.048 if front else .082)*abs(u)**3
        y=bottom+(upper-bottom)*height
        # Recess the center grille and both side intakes. All edges meet the side return exactly.
        inset=.047*(1-abs(u)**3)*(1-v)
        if front:
            grille=(1-smoothstep(.43,.67,abs(u)))*smoothstep(.13,.25,y)*(1-smoothstep(.52,.60,y))
            duct=smoothstep(.60,.71,abs(u))*(1-smoothstep(.86,.98,abs(u)))
            inset+=.048*grille+.035*duct*smoothstep(.16,.26,y)*(1-smoothstep(.47,.55,y))
        return x-u*side_inset(v), y, end+dz-sign*inset
    for u,un in zip(us,us[1:]):
        levels=[j/15 for j in range(15)]+[LIP_JOIN,1]
        for v,vn in zip(levels,levels[1:]):
            part=body if v>=LIP_JOIN else bumper
            mat=carbon if v==0 else plan_paint if front else side_paint
            part.face([point(u,v),point(un,v),point(un,vn),point(u,vn)],mat,(0,0,sign),front_uv if front else rear_uv)
        # The return follows the back of the lamp/grille carrier, below the painted edge.
        def flange(u,depth):
            x,y,end=point(u,LIP_JOIN)
            return x*(1-.025*depth),y-.004-.020*depth,end-sign*(.008+.065*depth)
        bumper.face([flange(u,0),flange(un,0),flange(un,1),flange(u,1)],liner,(0,1,0))


def ellipsoid(part,center,scale,mat,segments=30,rings=16):
    def point(i,j):
        a=i*TAU/segments; b=(j/rings-.5)*math.pi
        unit=(math.cos(b)*math.cos(a),math.sin(b),math.cos(b)*math.sin(a))
        return tuple(c+v*s for c,v,s in zip(center,unit,scale))
    for i in range(segments):
        for j in range(rings):
            pts=[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)]
            if j==0: pts.pop(0)
            if j==rings-1: pts.pop(2)
            facing=[sum(pt[k]-center[k] for pt in pts) for k in range(3)]
            part.face(pts,mat,facing)


def cylinder(part,center,axis,outer,inner,depth,mat,segments=60):
    # A short open tube, used for wheel rims, rotor surfaces and exhaust finishers.
    x,y,z=center
    def at(i,r,d):
        a=TAU*i/segments
        if axis=='x': return x+d,y+r*math.cos(a),z+r*math.sin(a)
        return x+r*math.sin(a),y+r*math.cos(a),z+d
    for j in range(segments):
        for r0,r1,d0,d1,normal in [(outer,outer,-depth/2,depth/2,'out'),(inner,inner,depth/2,-depth/2,'in'),
                                    (inner,outer,depth/2,depth/2,'cap+'),(inner,outer,-depth/2,-depth/2,'cap-')]:
            pts=[at(j,r0,d0),at(j+1,r0,d0),at(j+1,r1,d1),at(j,r1,d1)]
            if normal.startswith('cap'):
                face_dir=([1,0,0] if axis=='x' else [0,0,1])
                if normal=='cap-': face_dir=[-a for a in face_dir]
            else:
                face_dir=[(a-b)*(1 if normal=='out' else -1) for a,b in zip(pts[0],center)]
                face_dir[0 if axis=='x' else 2]=0
            part.face(pts,mat,face_dir)


def wheel(part,x,y,z,side,width,radius):
    count=112
    # Cross-section from inner bead to outer bead; the valleys are circumferential tread grooves.
    profile=[(-.5,.73),(-.52,.87),(-.50,.95),(-.44,.99),(-.34,1),
             (-.30,1),(-.29,.983),(-.27,.983),(-.26,1),(-.11,1),(-.10,.980),(-.08,.980),(-.07,1),
             (.08,1),(.09,.980),(.11,.980),(.12,1),(.26,1),(.27,.983),(.29,.983),(.30,1),(.36,1),
             (.44,.989),(.50,.95),(.52,.87),(.51,.79),(.49,.751),(.45,.734),(-.5,.73)]
    def on(a,r,d):
        return x+side*d,y+math.cos(a)*r,z+math.sin(a)*r
    for i in range(count):
        a,b=i*TAU/count,(i+1)*TAU/count
        for j in range(1,len(profile)):
            d0,r0=profile[j-1];d1,r1=profile[j]
            normal=(side*math.copysign(.6,d0),math.cos(a),math.sin(a))
            part.face([on(a,r0*radius,d0*width),on(b,r0*radius,d0*width),
                       on(b,r1*radius,d1*width),on(a,r1*radius,d1*width)],
                      rubber_edge if (j==25 or j==2) else rubber,normal)
    rim=radius*.759
    cylinder(part,(x+side*.015,y,z),'x',rim,rim-.014,width*.80,graphite,96)
    cylinder(part,(x+side*(width*.47),y,z),'x',rim,rim-.009,.011,alloy,96)
    cylinder(part,(x+side*width*.27,y,z),'x',.059,.012,.056,graphite,64)
    ellipsoid(part,(x+side*(width*.37),y,z),(.014,.036,.036),alloy,24,10)
    for n in range(5):
        a=n*TAU/5+.23
        for fork in [-1,1]:
            rows=[]
            for step in range(10):
                t=step/9
                r=.045+(rim-.050)*t
                phase=a+fork*(.03+.205*t**1.65)
                offset=width*(.29+.19*t)
                breadth=.014+.002*math.sin(t*math.pi)
                ring=[]
                for k in range(8):
                    q=k*TAU/8
                    delta=breadth*math.cos(q)
                    ring.append((x+side*(offset+.0105*math.sin(q)),y+r*math.cos(phase)-delta*math.sin(phase),
                                 z+r*math.sin(phase)+delta*math.cos(phase)))
                rows.append(ring)
            for row in range(1,len(rows)):
                for k in range(8):
                    next_k=(k+1)%8
                    pts=[rows[row-1][k],rows[row][k],rows[row][next_k],rows[row-1][next_k]]
                    q=(k+.5)*TAU/8
                    part.face(pts,alloy if math.sin(q)>.7 else graphite,
                              (side*math.sin(q),-math.sin(a)*math.cos(q),math.cos(a)*math.cos(q)))
        center=on(a,.043,width*.35)
        ellipsoid(part,center,(.009,.009,.009),alloy,12,7)


def wheel_well(body,x,y,z,sign,r):
    def p(t,d):
        return (x-sign*d, y+r*math.sin(t), z+r*math.cos(t))
    for i in range(58):
        a=-.19+i/58*(math.pi+.38); b=-.19+(i+1)/58*(math.pi+.38)
        body.face([p(a,0),p(b,0),p(b,.29),p(a,.29)],liner,(0,-math.sin(a),-math.cos(a)))
        body.face([p(a,.28),p(b,.28),(x-sign*.28,.105,z)],liner,(sign,0,0))
    for a in [-.19, math.pi+.19]:
        outer=p(a,0)
        inner=p(a,.29)
        foot=(outer[0],.106,outer[2])
        inside=(inner[0],.106,inner[2])
        body.face([outer,inner,inside,foot],liner,(0,0,-math.cos(a)))
        body.face([inner,inside,(inner[0],.105,z)],liner,(sign,0,0))


def beam(part,center,extent,mat):
    x,y,z=center
    w,h,d=(v/2 for v in extent)
    q=[(x+sx*w,y+sy*h,z+sz*d) for sz in (-1,1) for sy in (-1,1) for sx in (-1,1)]
    for idx,axis in [([0,1,3,2],(0,0,-1)),([4,5,7,6],(0,0,1)),([0,2,6,4],(-1,0,0)),
                     ([1,3,7,5],(1,0,0)),([0,1,5,4],(0,-1,0)),([2,3,7,6],(0,1,0))]:
        part.face([q[i] for i in idx],mat,axis)


def carrier(body,z,front):
    sign=1 if front else -1
    # The fascia lifts away from its carrier. The fin stack and bumper beam are visual approximations.
    beam(body,(0,.40,z+sign*.016),(1.27,.39,.045),liner)
    for i in range(17):
        beam(body,(0,.23+i*.021,z+sign*.049),(1.22,.006,.015),graphite)
    beam(body,(0,.43,z+sign*.085),(1.55,.064,.075),alloy)
    for side in (-1,1):
        beam(body,(side*.58,.42,z+sign*.011),(.115,.15,.16),graphite)
        beam(body,(side*.70,.58,z+sign*.051),(.16,.045,.11),carbon)


def hood_emblem(nose):
    for ring in range(4):
        for j in range(36):
            for k in range(6):
                def at(i,tube):
                    a=i*TAU/36
                    q=tube*TAU/6
                    x=(ring-1.5)*.033+(.025+.0027*math.cos(q))*math.cos(a)
                    z=2.111+(.024+.0027*math.cos(q))*math.sin(a)
                    width=section(z)[0]
                    _,y,z=surface(z,x/width)
                    return (x,y+.004+.0027*math.sin(q),z)
                a=(j+.5)*TAU/36;q=(k+.5)*TAU/6
                pts=[at(j,k),at(j+1,k),at(j+1,k+1),at(j,k+1)]
                nose.face(pts,alloy,(math.cos(q)*math.cos(a),math.sin(q),math.cos(q)*math.sin(a)))


def foil(part):
    rows=[]
    for i in range(65):
        x=(i/64-.5)*1.53
        z=-1.99+.074*(abs(x)/.765)**1.7
        y=.942+.025*(abs(x)/.765)**1.45
        row=[]
        for j in range(22):
            a=TAU*j/22
            row.append((x,y+.021*math.sin(a)-.020*math.cos(a),z+.111*math.cos(a)))
        rows.append(row)
    for i in range(1,len(rows)):
        for j in range(22):
            k=(j+1)%22;a=(j+.5)*TAU/22
            part.face([rows[i-1][j],rows[i][j],rows[i][k],rows[i-1][k]],carbon,(0,math.sin(a),math.cos(a)))
    for sign in [-1,1]:
        row=rows[0 if sign<0 else -1]
        part.face(row,carbon,(sign,0,0))
        ellipsoid(part,(sign*.48,.87,-1.985),(.023,.08,.064),carbon)


def build():
    body=Part('Body shell',explosion=(0,.48,0))
    nose=Part('Front fascia',explosion=(0,.05,1.30))
    tail=Part('Rear fascia',explosion=(0,.06,-1.22))
    spoiler=Part('Rear spoiler',explosion=(0,1.0,-.55))
    for part in [body,nose,tail]: part.building_skin=True
    us=shell(body,nose,tail)
    end_panel(body,nose,True,us)
    end_panel(body,tail,False,us)
    for part in [body,nose,tail]: part.building_skin=False
    hood_emblem(body)
    foil(spoiler)
    carrier(body,1.772,True)
    carrier(body,-1.863,False)
    body.face([(-.74,.118,-1.91),(.74,.118,-1.91),(.74,.118,1.79),(-.74,.118,1.79)],liner,(0,-1,0))
    parts=[body,nose,tail,spoiler]
    for sign in [-1,1]:
        ellipsoid(body,(sign*.929,.849,.64),(.078,.032,.056),carbon,32,16)
        ellipsoid(body,(sign*.988,.880,.606),(.0305,.041,.108),silver,48,20)
        ellipsoid(body,(sign*.988,.876,.552),(.028,.032,.057),mirror,32,16)
        for z,track,width,r,front in [(FRONT_AXLE,1.645,.242,.331,True),(REAR_AXLE,1.599,.298,.339,False)]:
            x=sign*track/2
            label=('F' if front else 'R')+('L' if sign>0 else 'R')
            wh=Part('Wheel '+label,(x,r,z),(sign*.84,0,0),True,front)
            wheel(wh,x,r,z,sign,width,r)
            parts.append(wh)
            # Rotor and caliper stay at the hub during disassembly.
            hub=Part('Hub '+label,(x,r,z),(sign*.22,.08,0))
            cylinder(hub,(x+sign*.043,r,z),'x',.192,.043,.016,rotor,88)
            cylinder(hub,(x+sign*.048,r,z),'x',.066,.006,.056,graphite,48)
            for k in range(38):
                a=TAU*k/38
                for rd in [.145,.172]:
                    ellipsoid(hub,(x+sign*.052,r+math.cos(a)*rd,z+math.sin(a)*rd),(.0015,.005,.005),liner,6,4)
            ellipsoid(hub,(x+sign*.054,r+.038,z-.164),(.035,.086,.039),caliper_mat,28,18)
            wheel_well(body,sign*.907,r,z,sign,r+.077)
            parts.append(hub)
    return [part.object() for part in parts]


if __name__=='__main__':
    objects=build()
    ASSETS.mkdir(parents=True,exist_ok=True)
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.preferences.filepaths.save_version=0
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type=='FILE_BROWSER' and space.params:
                    space.params.directory=b'//'
    bpy.ops.wm.save_as_mainfile(filepath=str(DESIGN/'r8-exterior.blend'), compress=True)
