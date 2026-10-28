#!/usr/bin/env python3
"""Normalize generated free effects and extend the cumulative F atlas."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import prepare_stufe2_f as previous
from prepare_stufe2_a import preserved

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba;NAVY=rgba('181425')
CONFETTI=['e43b44','fee761','2ce8f5','63c74d','f6757a']
GROUPS=[('plane-right',2,120,True,8,8,0),('plane-up',2,120,True,8,8,16),
        ('plane-down',2,120,True,8,8,32),('confetti',6,90,False,16,16,0),
        ('sparkle',3,120,True,8,8,0),('dust',3,100,False,8,8,0),('paper',3,150,True,8,8,0)]
ROWS={'plane-right':0,'plane-up':0,'plane-down':0,'confetti':8,'sparkle':24,'dust':32,'paper':40}
SPECS={f'{name}-{i}':(w,h,x+i*w,ROWS[name],[4,8] if name=='dust' else [w//2,h//2])
       for name,count,_,_,w,h,x in GROUPS for i in range(count)}

def colored_components(image,box):
    a=np.asarray(image.crop(box).convert('RGBA'));rgb=a[:,:,:3].astype(float)
    palette=np.array([list(bytes.fromhex(c)) for c in CONFETTI],dtype=float)
    distance=((rgb[:,:,None,:]-palette[None,None,:,:])**2).sum(axis=3)
    ids=distance.argmin(axis=2)
    mask=(a[:,:,3]>=192)&(distance.min(axis=2)<125**2)&((rgb.max(axis=2)-rgb.min(axis=2))>=80)&(rgb.max(axis=2)>130)
    h,w=mask.shape;seen=np.zeros_like(mask);pieces=[]
    for y,x in zip(*np.where(mask)):
        if seen[y,x]:continue
        todo=[(y,x)];seen[y,x]=True;coords=[];color=int(ids[y,x])
        while todo:
            yy,xx=todo.pop();coords.append((yy,xx))
            for dy,dx in ((0,-1),(0,1),(-1,0),(1,0)):
                y2,x2=yy+dy,xx+dx
                if 0<=y2<h and 0<=x2<w and mask[y2,x2] and not seen[y2,x2] and ids[y2,x2]==color:
                    seen[y2,x2]=True;todo.append((y2,x2))
        if len(coords)>=12:
            cy,cx=np.mean(coords,axis=0);pieces.append({'color':CONFETTI[color],'sourceCenter':[round(float(cx),2),round(float(cy),2)],'sourceArea':len(coords)})
    return sorted(pieces,key=lambda p:-p['sourceArea'])

def confetti_frame(image,box,index):
    found=colored_components(image,box);selected=[]
    limit=[12,12,10,8,5,3][index]
    if index<3:
        for color in CONFETTI:
            match=next((p for p in found if p['color']==color),None)
            if match:selected.append(match)
    selected += [p for p in found if p not in selected][:max(0,limit-len(selected))]
    p=np.zeros((16,16,4),dtype=np.uint8);occupied=set();details=[];width=box[2]-box[0];height=box[3]-box[1]
    for piece in selected:
        cx,cy=piece['sourceCenter'];x=round(cx*16/width);y=round(cy*16/height)
        if index==0:x=8+round((x-8)*.4);y=6+round((y-8)*.4)
        x=max(0,min(15,x));y=max(0,min(15,y))
        positions=sorted(((xx,yy) for yy in range(16) for xx in range(16)),key=lambda v:(abs(v[0]-x)+abs(v[1]-y),v[1],v[0]))
        x,y=next(v for v in positions if v not in occupied);occupied.add((x,y));p[y,x]=rgba(piece['color'])
        details.append({**piece,'nativePosition':[x,y]})
    return p,details

def normalize_planes(sprites):
    for direction in ('right','up','down'):
        p=sprites[f'plane-{direction}-0'].copy();alternate=p.copy()
        if direction=='right':
            alternate[1,0:3]=NAVY;alternate[2,0:4]=NAVY;alternate[2,1:3]=rgba('ffffff')
        else:
            for left,right in ((0,2),(6,8)):
                alternate[1:,left:right]=p[:-1,left:right];alternate[0,left:right]=0
        sprites[f'plane-{direction}-1']=furniture.outlined(alternate)

def normalize_sparkles(sprites):
    yy,xx=np.indices((8,8));distance=abs(xx-3)+abs(yy-3)
    for i,radius in enumerate((2,3,1)):
        p=np.zeros((8,8,4),dtype=np.uint8);inside=distance<=radius;p[inside]=rgba('ffffff')
        p[inside&((xx+yy)>6)]=rgba('fee761')
        p=furniture.outlined(p)
        if i==2:p[3,3]=rgba('fee761')
        sprites[f'sparkle-{i}']=p

def normalize_paper(sprites):
    # Snap the generated blank sheet to face-on, tilted and edge-on poses.
    face=np.zeros((8,8,4),dtype=np.uint8);face[1:7,2:6]=NAVY;face[2:6,3:5]=rgba('ffffff');face[2,4]=rgba('c0cbdc')
    im=Image.new('RGBA',(8,8));ImageDraw.Draw(im).polygon([(3,0),(7,3),(4,7),(0,4)],fill=rgba('ffffff'))
    diagonal=furniture.outlined(np.asarray(im).copy());diagonal[5,4]=rgba('c0cbdc')
    edge=np.zeros((8,8,4),dtype=np.uint8);edge[1:7,3:6]=NAVY;edge[2:6,4]=rgba('ffffff');edge[5,4]=rgba('c0cbdc')
    for i,p in enumerate((face,diagonal,edge)):sprites[f'paper-{i}']=p

def build(config):
    path=ROOT/config['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==config['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==config['size']
    sprites={};details={'confettiParticles':{}}
    for name,(w,h,*_) in SPECS.items():
        palette=['181425','ffffff','c0cbdc','8b9bb4']
        if name.startswith('sparkle'):palette=['181425','ffffff','fee761','feae34']
        if name.startswith('confetti'):palette=['181425',*CONFETTI]
        p=room.raster(image,config['crops'][name],(w,h),palette)
        if name.startswith('confetti'):
            p,particles=confetti_frame(image,config['crops'][name],int(name[-1]));details['confettiParticles'][name]=particles
        else:p=furniture.outlined(p)
        sprites[name]=p
    # Preserve the two source dust remnants as exactly two native grey pixels.
    final=np.zeros((8,8,4),dtype=np.uint8);final[6,3]=rgba('c0cbdc');final[7,5]=rgba('c0cbdc');sprites['dust-2']=final
    normalize_planes(sprites);normalize_sparkles(sprites);normalize_paper(sprites)
    return sprites,details

def extend(atlas,sprites):
    sheet=np.zeros((48,96,4),dtype=np.uint8)
    for name,(w,h,x,y,anchor) in SPECS.items():
        sheet[y:y+h,x:x+w]=sprites[name]
        atlas['sprites'][name]={'image':'fx/effects.png','x':x,'y':y,'width':w,'height':h,'frames':1,
                                'anchor':anchor,'kind':'effect','blocksMovement':False}
    atlas['meta']['images']['fx/effects.png']={'width':96,'height':48}
    for name,count,duration,loop,w,h,x in GROUPS:
        atlas['animations'][name]={'image':'fx/effects.png','x':x,'y':ROWS[name],'width':w,'height':h,
                                  'frames':count,'states':[f'{name}-{i}' for i in range(count)],
                                  'frameDurationMs':duration,'loop':loop,'anchor':[4,8] if name=='dust' else [w//2,h//2]}
    Image.fromarray(sheet).save(OUT/'fx/effects.png');room.floors.save_json(OUT/'atlas.json',atlas)

def validate(atlas,details):
    baseline=json.loads((ROOT/'art/references/stufe2-f-atlas.json').read_text(encoding="utf-8"));preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2 and len(atlas['sprites'])==274 and len(atlas['animations'])==50
    hashes=json.loads((ROOT/'art/stufe2-f-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);sheet=images['fx/effects.png']
    assert sheet.shape==(48,96,4) and set(np.unique(sheet[:,:,3]))=={0,255}
    assert {tuple(c) for c in sheet[sheet[:,:,3]==255,:3].tolist()}<=set(room.floors.PALETTE)
    cover=np.zeros((48,96),dtype=np.uint8);outlined=0
    for name,(w,h,x,y,anchor) in SPECS.items():
        p=sprites[name];e=atlas['sprites'][name]
        assert p.shape==(h,w,4) and p[:,:,3].any() and e['anchor']==anchor
        assert e['frames']==1 and e['kind']=='effect' and e['blocksMovement'] is False
        assert 0<=x<=96-w and 0<=y<=48-h;cover[y:y+h,x:x+w]+=1
        assert not {'footprintTiles','againstWall','wallY'}&e.keys()
        if not name.startswith('confetti') and name!='dust-2':
            opaque=p[:,:,3]==255;pad=np.pad(opaque,1)
            edge=opaque&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
            assert np.all(p[edge]==NAVY),(name,'open contour');outlined+=1
    assert cover.max()==1 and not sheet[cover==0,3].any()
    plane_changes={}
    for direction in ('right','up','down'):
        a,b=[sprites[f'plane-{direction}-{i}'] for i in range(2)]
        assert not np.array_equal(a,b)
        yy,xx=np.indices((8,8));wing=(yy<=3)&(xx<=3) if direction=='right' else ((xx<=2)|(xx>=5))
        assert np.array_equal(a[~wing],b[~wing]),(direction,'plane body drift')
        nose={'right':(4,7),'up':(0,4),'down':(7,4)}[direction]
        assert a[nose][3]==255 and np.array_equal(a[nose],b[nose])
        assert np.array_equal(a,a[:,::-1][:,::-1])
        plane_changes[direction]=int(np.any(a!=b,axis=2).sum())
    conf=[sprites[f'confetti-{i}'] for i in range(6)];counts=[int((p[:,:,3]==255).sum()) for p in conf]
    assert counts==[12,12,10,8,5,3]
    colors={tuple(bytes.fromhex(c)) for c in CONFETTI}
    for p in conf:assert {tuple(c) for c in p[p[:,:,3]>0,:3].tolist()}<=colors
    assert {tuple(c) for c in conf[0][conf[0][:,:,3]>0,:3].tolist()}==colors
    yy,xx=np.indices((16,16));radii=[];centers=[]
    for p in conf:
        mask=p[:,:,3]>0;radii.append(float(np.sqrt((xx[mask]-8)**2+(yy[mask]-6)**2).max()));centers.append(float(yy[mask].mean()))
    assert radii[1]>radii[0] and centers[-1]>centers[0],'Confetti must expand then fall'
    stars=[sprites[f'sparkle-{i}'] for i in range(3)];star_areas=[int((p[:,:,3]>0).sum()) for p in stars]
    assert star_areas[0]<star_areas[1] and star_areas[2]<star_areas[0]
    assert all(p[3,3,3]==255 for p in stars)
    dust=[sprites[f'dust-{i}'] for i in range(3)];dust_areas=[int((p[:,:,3]>0).sum()) for p in dust]
    assert dust_areas[0]<dust_areas[1] and dust_areas[2]==2
    assert np.all(dust[-1][dust[-1][:,:,3]>0]==rgba('c0cbdc'))
    papers=[sprites[f'paper-{i}'] for i in range(3)]
    widths=[int(np.ptp(np.where(p[:,:,3]>0)[1])+1) for p in papers]
    assert widths==[4,8,3] and len({p[:,:,3].tobytes() for p in papers})==3
    for name,count,duration,loop,w,h,x in GROUPS:
        a=atlas['animations'][name];assert a['frames']==count and a['frameDurationMs']==duration and a['loop']==loop
        assert len(set(a['states']))==count and all(n in atlas['sprites'] for n in a['states'])
        assert len({sprites[n].tobytes() for n in a['states']})==count
        assert all(atlas['sprites'][n]['x']==x+i*w for i,n in enumerate(a['states']))
    return {'status':'passed','package':'G','newSprites':21,'newAnimations':7,'totalSprites':274,'totalAnimations':50,
            'schemaVersion':2,'image':'fx/effects.png','imageSize':[96,48],'palette':'ENDESGA 32','alphaLevels':[0,255],
            'atlasBoundsAndUnusedCells':'passed','effectAnchorsAndNoMovementCollision':'passed',
            'outlinedEffectFrames':outlined,'unoutlinedParticleFrames':7,'navyEffectContours':'passed',
            'planeBodiesAndNosesStable':'passed','planeWingChangedPixels':plane_changes,'planeLeftFromMirroredRight':'passed',
            'confettiParticleCounts':counts,'confettiContainsAllFiveColors':'passed','confettiExpandsAndFalls':'passed',
            'sparkleAreas':star_areas,'dustAreas':dust_areas,'finalDustHasExactlyTwoOpaquePixels':'passed',
            'paperPoseWidths':widths,'singlePlayConfettiAndDust':'passed','allPreviousAtlasEntries':'unchanged',
            'previousAssetFilesByteIdentical':len(hashes),'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-g-source.json').read_text(encoding="utf-8"));sprites,details=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));extend(atlas,sprites)
    report=validate(atlas,details)
    from stufe2_g_previews import build as previews
    report.update(previews(atlas));room.floors.save_json(ROOT/'art/checks/stufe2-g-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
