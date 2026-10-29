#!/usr/bin/env python3
"""Normalize generated repeatable surfaces and extend the cumulative B2 kit."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_stufe2_b2 as previous
from prepare_stufe2_a import preserved

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba
NAVY=rgba('181425')
FLOORS=['carpet-blue','carpet-green','carpet-wine','tile-lobby']
RUNNER_PARTS=['top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right']
RUNNER_NAMES=['runner-'+p for p in RUNNER_PARTS]
WALLS=['wall-brick','wall-glass','wall-wood','wall-green']
CARPET_COLORS={'carpet-blue':['3a4466','5a6988'],'carpet-green':['265c42','3e8948'],'carpet-wine':['a22633','733e39']}
WOOD=['e4a672','b86f50','733e39']
SPECS={
 **{name:(16,16,i*16,0,'floor') for i,name in enumerate(FLOORS)},
 **{name:(16,16,(i%3)*16,16+(i//3)*16,'floor') for i,name in enumerate(RUNNER_NAMES)},
 **{name:(16,32,i*16,64,'wall') for i,name in enumerate(WALLS)},
}
PALETTES={
 **{name:colors for name,colors in CARPET_COLORS.items()},
 'tile-lobby':['ffffff','c0cbdc','8b9bb4'],
 **{name:['181425','a22633','733e39','feae34','fee761'] for name in RUNNER_NAMES},
 'wall-brick':['181425',*WOOD,'be4a2f'],
 'wall-glass':['181425','5a6988','8b9bb4','c0cbdc','2ce8f5','ffffff'],
 'wall-wood':['181425',*WOOD],
 'wall-green':['181425',*WOOD,'63c74d','3e8948','265c42'],
}

def carpet_pattern(source,box):
    # Keep the generated dotted weave, snapped to a quiet common 8px repeat.
    raw=np.asarray(source.crop(box).resize((16,16),Image.Resampling.BOX))
    light=raw[:,:,:3].astype(float)@np.array([.2126,.7152,.0722])
    seed=light[4:12,4:12]
    candidates=sorted(((y,x) for y in range(1,7) for x in range(1,7)),key=lambda p:(-seed[p],p))
    points=[]
    for y,x in candidates:
        if all(abs(y-py)+abs(x-px)>1 for py,px in points):points.append((y,x))
        if len(points)==8:break
    assert len(points)==8
    pattern=np.zeros((8,8),dtype=bool)
    for y,x in points:pattern[y,x]=True
    return np.tile(pattern,(2,2)),points

def normalize_runner(name):
    row,col=divmod(RUNNER_NAMES.index(name),3);yy,xx=np.indices((16,16))
    distances=[]
    if row==0:distances.append(yy)
    if row==2:distances.append(15-yy)
    if col==0:distances.append(xx)
    if col==2:distances.append(15-xx)
    d=np.minimum.reduce(distances) if distances else np.full((16,16),99)
    p=np.empty((16,16,4),dtype=np.uint8);p[:]=rgba('a22633')
    p[d==0]=NAVY;p[d==2]=rgba('feae34')
    lit=((row==0)&(yy==2))|((col==0)&(xx==2))
    p[(d==2)&lit]=rgba('fee761')
    return p

def normalize_walls(sprites):
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));_,old=room.read_sprites(atlas)
    approved=old['wall-plain'];yy,xx=np.indices((32,16))
    brick=sprites['wall-brick']
    for y in range(4,29):
        course=(y-4)//4;phase=(y-4)%4
        brick[y]=rgba('733e39' if phase==2 else 'be4a2f')
        if phase==3:brick[y]=rgba('e4a672')
        else:
            for x in range((course%2)*4,16,8):brick[y,x]=rgba('e4a672')
    wood=sprites['wall-wood']
    wood[4:29]=rgba('b86f50');wood[4:29,0::4]=rgba('733e39');wood[4:29,1::4]=rgba('e4a672')
    green=sprites['wall-green'];green[4:19]=rgba('3e8948')
    green[4]=rgba('63c74d');green[19]=rgba('e4a672');green[20]=rgba('733e39')
    green[21:29]=wood[21:29]
    # Retain the generated framed glazing, using clear center pixels rather
    # than fractional alpha. Two thin reflection strokes stay opaque white.
    glass=sprites['wall-glass'];glass[4:29]=rgba('2ce8f5')
    glass[4:29,0]=NAVY;glass[4:29,15]=NAVY
    glass[4:29,1]=rgba('c0cbdc');glass[4:29,14]=rgba('8b9bb4')
    glass[6:27,4:12]=0
    for x,y in [(3+i,15-i) for i in range(9)]+[(4+i,22-i) for i in range(9)]:glass[y,x]=rgba('ffffff')
    for name in WALLS:
        sprites[name][:4]=approved[:4];sprites[name][29:]=approved[29:]
    return approved

def build(config):
    path=ROOT/config['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==config['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==config['size']
    sprites={name:room.raster(image,config['crops'][name],(w,h),list(dict.fromkeys(PALETTES[name]))) for name,(w,h,*_) in SPECS.items()}
    pattern,points=carpet_pattern(image,config['crops']['carpet-blue'])
    for name,(base,dot) in CARPET_COLORS.items():
        sprites[name][:]=rgba(base);sprites[name][pattern]=rgba(dot)
    yy,xx=np.indices((16,16));stone=sprites['tile-lobby'];stone[:]=rgba('c0cbdc')
    stone[(xx%8==1)|(yy%8==1)]=rgba('ffffff')
    stone[(xx%8==0)|(yy%8==0)]=rgba('8b9bb4')
    for name in RUNNER_NAMES:sprites[name]=normalize_runner(name)
    approved=normalize_walls(sprites)
    return sprites,{'carpetRepeatPixels':8,'carpetDotPositionsInRepeat':[list(p) for p in points],
                    'lobbyRepeatPixels':8,'runnerBorderPixels':3,'wallTrimRows':[0,1,2,3,29,30,31]},approved

def extend(atlas,sprites):
    sheet=np.zeros((96,64,4),dtype=np.uint8)
    for name,(w,h,x,y,placement) in SPECS.items():
        sheet[y:y+h,x:x+w]=sprites[name]
        entry={'image':'tiles/surfaces.png','x':x,'y':y,'width':w,'height':h,'frames':1,'anchor':[0,h],'placement':placement}
        if placement=='floor':entry.update(footprintTiles=[1,1],blocksMovement=False,againstWall=False)
        else:entry.update(wallY=0,blocksMovement=True)
        atlas['sprites'][name]=entry
    atlas['meta']['images']['tiles/surfaces.png']={'width':64,'height':96}
    atlas['nineSlice']['runner']={'tileSize':16,'borderPixels':3,'minimumTiles':[3,3],
                                 'parts':[RUNNER_NAMES[:3],RUNNER_NAMES[3:6],RUNNER_NAMES[6:9]]}
    Image.fromarray(sheet).save(OUT/'tiles/surfaces.png');room.floors.save_json(OUT/'atlas.json',atlas)

def assemble_runner(atlas,sprites,width,height):
    spec=atlas['nineSlice']['runner'];minimum=spec['minimumTiles']
    if width<minimum[0] or height<minimum[1]:raise ValueError('Runner must be at least 3 by 3 tiles')
    size=spec['tileSize'];out=np.zeros((height*size,width*size,4),dtype=np.uint8)
    for row in range(height):
        rr=0 if row==0 else 2 if row==height-1 else 1
        for col in range(width):
            cc=0 if col==0 else 2 if col==width-1 else 1
            out[row*size:(row+1)*size,col*size:(col+1)*size]=sprites[spec['parts'][rr][cc]]
    return out

def validate(atlas,details,approved):
    baseline=json.loads((ROOT/'art/references/stufe2-b2-atlas.json').read_text(encoding="utf-8"));preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2 and len(atlas['sprites'])==223 and len(atlas['animations'])==29
    hashes=json.loads((ROOT/'art/stufe2-b2-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);sheet=images['tiles/surfaces.png']
    assert sheet.shape==(96,64,4) and set(np.unique(sheet[:,:,3]))=={0,255}
    assert {tuple(c) for c in sheet[sheet[:,:,3]==255,:3].tolist()}<=set(room.floors.PALETTE)
    cover=np.zeros((96,64),dtype=np.uint8)
    for name,(w,h,x,y,placement) in SPECS.items():
        p=sprites[name];entry=atlas['sprites'][name]
        assert p.shape==(h,w,4) and entry['anchor']==[0,h] and entry['frames']==1
        assert entry['placement']==placement and 0<=x<=64-w and 0<=y<=96-h
        cover[y:y+h,x:x+w]+=1
        if placement=='floor':
            assert entry['footprintTiles']==[1,1] and entry['blocksMovement'] is False
            assert entry['againstWall'] is False and np.all(p[:,:,3]==255)
        else:
            assert entry['wallY']==0 and entry['blocksMovement'] is True
            assert np.array_equal(p[:4],approved[:4]) and np.array_equal(p[29:],approved[29:])
    assert cover.max()==1 and not sheet[cover==0,3].any()
    patterns=[]
    for name in FLOORS:
        p=sprites[name]
        assert np.array_equal(p[:8],p[8:]) and np.array_equal(p[:,:8],p[:,8:])
        assert np.array_equal(np.stack((p[-1],p[0])),np.stack((p[7],p[8]))),'Vertical floor seam'
        assert np.array_equal(np.stack((p[:,-1],p[:,0])),np.stack((p[:,7],p[:,8]))),'Horizontal floor seam'
        if name in CARPET_COLORS:patterns.append(np.all(p==rgba(CARPET_COLORS[name][1]),axis=2))
        assert not np.all(p==NAVY,axis=2).any(),'Repeated flooring must not have navy cut-edge rims'
    assert all(np.array_equal(patterns[0],p) for p in patterns[1:])
    assert int(patterns[0].sum())==32
    for name,period in [('wall-brick',8),('wall-wood',4),('wall-green',4)]:
        p=sprites[name];assert np.all(p[:,:,3]==255)
        assert np.array_equal(p[:,period:],p[:,:-period]),(name,'horizontal period')
        assert np.array_equal(np.stack((p[:,-1],p[:,0])),np.stack((p[:,period-1],p[:,period]))),(name,'wall seam')
    glass=sprites['wall-glass'];assert np.array_equal(glass[:,0],glass[:,-1])
    clear=glass[:,:,3]==0;white=np.all(glass==rgba('ffffff'),axis=2)
    assert 100<int(clear.sum())<200 and not clear[:4].any() and not clear[29:].any()
    assert int(white.sum())==18,'Two nine-pixel white reflection strokes required'
    components=[];remaining={tuple(p) for p in np.argwhere(white)}
    while remaining:
        todo=[remaining.pop()];component=[]
        while todo:
            y,x=todo.pop();component.append((y,x))
            neighbors={(y+dy,x+dx) for dy in (-1,0,1) for dx in (-1,0,1)}&remaining
            remaining-=neighbors;todo.extend(neighbors)
        components.append(component)
    assert sorted(map(len,components))==[9,9]
    parts=atlas['nineSlice']['runner']['parts']
    assert len(parts)==3 and all(len(row)==3 for row in parts)
    assert {n for row in parts for n in row}==set(RUNNER_NAMES)
    for row in range(3):
        for col in range(2):assert np.array_equal(sprites[parts[row][col]][:,-1],sprites[parts[row][col+1]][:,0])
    for row in range(2):
        for col in range(3):assert np.array_equal(sprites[parts[row][col]][-1],sprites[parts[row+1][col]][0])
    sizes=[(3,3),(3,9),(9,3),(4,12),(11,4),(7,5)]
    for width,height in sizes:
        p=assemble_runner(atlas,sprites,width,height);h,w=p.shape[:2];yy,xx=np.indices((h,w))
        d=np.minimum.reduce([yy,xx,h-1-yy,w-1-xx]);expected=np.empty_like(p);expected[:]=rgba('a22633')
        expected[d==0]=NAVY;expected[d==2]=rgba('feae34');expected[(d==2)&((yy==2)|(xx==2))]=rgba('fee761')
        assert np.array_equal(p,expected),(width,height,'Runner border or internal seam')
    return {'status':'passed','package':'D','newSprites':17,'newFloorTiles':13,'newWallTiles':4,
            'newAnimations':0,'totalSprites':223,'totalAnimations':29,'schemaVersion':2,
            'image':'tiles/surfaces.png','imageSize':[64,96],'palette':'ENDESGA 32','alphaLevels':[0,255],
            'atlasBoundsAndOverlap':'passed','opaqueWalkableFloorTiles':'passed','floorCutEdgesWithoutOutline':'passed',
            'floorHorizontalAndVerticalSeams':'passed','floorPeriodPixels':8,'carpetsShareDotPattern':'passed',
            'carpetDotPixelsPerTile':32,'wallHorizontalSeams':'passed','wallCapsAndBaseboardMatchApproved':'passed',
            'wallYAndStructuralCollisionFlags':'passed','glassClearPixels':int(clear.sum()),
            'glassReflectionStrokeLengths':[len(c) for c in components],'glassBinaryTransparency':'passed',
            'runnerNineSliceNamesAndConnections':'passed','runnerStretchSizesTested':[list(s) for s in sizes],
            'runnerContinuousGoldBorder':'passed','allPreviousAtlasEntries':'unchanged',
            'previousAssetFilesByteIdentical':len(hashes),'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-d-source.json').read_text(encoding="utf-8"))
    sprites,details,approved=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));extend(atlas,sprites)
    report=validate(atlas,details,approved)
    from stufe2_d_previews import build as previews
    report.update(previews(atlas));room.floors.save_json(ROOT/'art/checks/stufe2-d-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
