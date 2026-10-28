#!/usr/bin/env python3
"""Normalize generated lounge furniture and extend the cumulative A + B1 kit."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_stufe2_b1 as previous

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba
NAVY=rgba('181425')
WOOD=['e4a672','b86f50','733e39']
TEAL=['0099db','124e89','193c3e']
METAL=['c0cbdc','8b9bb4','5a6988']
WHITE=['ffffff','c0cbdc','8b9bb4']
SPECS={
 'sofa':(48,32,0,0,'floor',[3,1],False),
 'armchair':(16,24,48,8,'floor',[1,1],False),
 'coffee-table':(32,16,64,16,'floor',[2,1],False),
 'kitchen-table':(32,24,96,8,'floor',[2,1],False),
 'stool':(16,16,128,16,'floor',[1,1],False),
 'counter-sink':(48,24,144,8,'floor',[3,1],True),
 'microwave':(16,16,0,48,'counter',None,None),
 'fruit-bowl':(16,8,16,56,'counter',None,None),
 'vending-0':(16,32,32,32,'floor',[1,1],True),
 'vending-1':(16,32,48,32,'floor',[1,1],True),
 **{f'kicker-{i}':(48,24,i*48,64,'floor',[3,1],False) for i in range(4)},
}
SPOTS={
 'sofa':[{'name':name,'dx':x,'dy':-2,'facing':'front'} for name,x in [('left',8),('middle',24),('right',40)]],
 'armchair':[{'name':'seat','dx':8,'dy':-2,'facing':'front'}],
 'stool':[{'name':'seat','dx':8,'dy':0,'facing':'front'}],
 'kitchen-table':[{'name':'left','dx':-8,'dy':0,'facing':'right'},{'name':'right','dx':40,'dy':0,'facing':'left'}],
 **{f'kicker-{i}':[{'name':'left','dx':-8,'dy':0,'facing':'right'},{'name':'right','dx':56,'dy':0,'facing':'left'}] for i in range(4)},
}
BALLS=[(22,8),(23,10),(27,12),(30,8)]
ROD_OFFSETS=[(0,0,0),(1,-1,1),(0,1,-1),(-1,0,0)]

def cloth_shading(pixels,source,box):
    h,w=pixels.shape[:2]
    raw=np.asarray(source.crop(box).resize((w,h),Image.Resampling.BOX))
    rgb=raw[:,:,:3].astype(float);light=rgb@np.array([.2126,.7152,.0722])
    cloth=(rgb[:,:,1]>rgb[:,:,0]*1.5)&(rgb[:,:,2]>rgb[:,:,0]*1.5)&(light>40)&(pixels[:,:,3]==255)
    for selected,color in ((cloth&(light<65),TEAL[2]),(cloth&(light>=65)&(light<102),TEAL[1]),(cloth&(light>=102),TEAL[0])):
        pixels[selected]=rgba(color)
    return furniture.outlined(pixels)

def normalize_sink(generated):
    # Preserve the approved counter silhouette, timber and cabinet fronts.
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));_,old=room.read_sprites(atlas)
    pixels=old['kitchen-counter'].copy()
    # Snap the generated basin and tap to the existing 10-pixel worktop depth.
    basin=Image.fromarray(generated[5:11,14:33]).resize((18,6),Image.Resampling.NEAREST)
    pixels[3:9,15:33]=np.asarray(basin)
    pixels[3,15:33]=rgba('c0cbdc');pixels[8,15:33]=rgba('c0cbdc')
    pixels[4:8,15]=rgba('c0cbdc');pixels[4:8,32]=rgba('8b9bb4')
    pixels[4:8,16:32]=rgba('5a6988');pixels[4,16:32]=rgba('8b9bb4')
    pixels[6,23:25]=NAVY
    pixels[0:5,23:26]=NAVY;pixels[1:4,24]=rgba('c0cbdc')
    pixels[1,23]=rgba('8b9bb4');pixels[4,24]=rgba('8b9bb4')
    return furniture.outlined(pixels)

def vending_frames(generated):
    p=generated.copy()
    # A stable blank keypad and nine discrete bottles survive the 16px width.
    p[5:24,2:12]=NAVY;p[6:23,3:11]=rgba('262b44')
    for y in (11,17):p[y,3:11]=rgba('8b9bb4')
    bottles=[('e43b44','a22633'),('feae34','fee761'),('3e8948','63c74d'),
             ('0099db','2ce8f5'),('3e8948','63c74d'),('feae34','fee761'),
             ('3e8948','63c74d'),('0099db','2ce8f5'),('c0cbdc','ffffff')]
    bottle_mask=np.zeros((32,16),dtype=bool)
    for i,(body,highlight) in enumerate(bottles):
        x=3+(i%3)*3;y=8+(i//3)*6
        p[y-1,x]=rgba(highlight);p[y:y+3,x:x+2]=rgba(body);p[y,x]=rgba(highlight)
        bottle_mask[y-1,x]=True;bottle_mask[y:y+3,x:x+2]=True
    p[12:19,13:15]=NAVY
    for y in (13,15,17):p[y,13]=rgba('c0cbdc')
    p[1,2:13]=rgba('e43b44')
    p=furniture.outlined(p)
    glass=np.zeros((32,16),dtype=bool);glass[6:23,3:11]=True
    glass &= np.all(p==rgba('262b44'),axis=2)
    lit=p.copy();lit[glass]=rgba('3a4466')
    return [p,lit],glass,bottle_mask

def kicker_frames(generated):
    # One generated case is shared. Re-grid only the tiny playing surface,
    # rods, team pieces and ball; the timber and legs never wobble.
    base=generated.copy()
    base[2:5,7:41]=rgba('b86f50');base[2,8:40]=rgba('e4a672')
    base[4:17,8:40]=NAVY;base[5:16,9:39]=rgba('265c42')
    base[5,10:38]=rgba('ffffff');base[15,10:38]=rgba('ffffff')
    base[5:16,10]=rgba('ffffff');base[5:16,37]=rgba('ffffff')
    base[5:16,24]=rgba('ffffff')
    for x0,x1 in ((10,13),(34,37)):
        base[8,x0:x1+1]=rgba('ffffff');base[12,x0:x1+1]=rgba('ffffff')
        base[8:13,x1 if x0==10 else x0]=rgba('ffffff')
    for x,y in ((22,8),(23,7),(25,7),(26,8),(27,9),(27,11),(26,12),(25,13),(23,13),(22,12),(21,11),(21,9)):
        base[y,x]=rgba('ffffff')
    for y in (6,10,14):
        base[y-1:y+2,0:6]=NAVY;base[y-1:y+2,42:48]=NAVY
    frames=[];motion=np.zeros((24,48),dtype=bool)
    for i,(offsets,(bx,by)) in enumerate(zip(ROD_OFFSETS,BALLS)):
        p=base.copy()
        for row,(y,offset) in enumerate(zip((6,10,14),offsets)):
            p[y,4:44]=rgba('8b9bb4');p[y,6:42]=rgba('c0cbdc')
            for x in (3+offset,43+offset):p[y,x]=rgba('5a6988')
            motion[y-1:y+2,:]=True
            for col,x in enumerate((16,24,32)):
                x+=offset;blue=(row+col)%2==0
                light,dark=('0099db','124e89') if blue else ('e43b44','a22633')
                p[y-1:y+2,x-1:x+2]=NAVY
                p[y-1:y+1,x]=rgba(light);p[y+1,x]=rgba(dark)
        p[by-1:by+2,bx-1:bx+2]=NAVY;p[by,bx]=rgba('ffffff')
        motion[by-1:by+2,bx-1:bx+2]=True
        frames.append(furniture.outlined(p))
    return frames,motion
PALETTES={
 'sofa':['181425',*TEAL,'733e39','b86f50'],
 'armchair':['181425',*TEAL,'733e39','b86f50'],
 'coffee-table':['181425',*WOOD,*WHITE,'0099db','124e89','63c74d','3e8948'],
 'kitchen-table':['181425',*WOOD],
 'stool':['181425','262b44','3a4466','5a6988',*WOOD],
 'counter-sink':['181425',*WOOD,*METAL,'ffffff','262b44'],
 'microwave':['181425',*WHITE,'262b44','3a4466','5a6988'],
 'fruit-bowl':['181425',*WHITE,'e43b44','a22633','feae34','f77622','fee761','63c74d','265c42'],
 **{f'vending-{i}':['181425','be4a2f','a22633','733e39','262b44','3a4466','5a6988',*WHITE,'e43b44','0099db','124e89','2ce8f5','63c74d','3e8948','265c42','feae34','fee761'] for i in range(2)},
 **{f'kicker-{i}':['181425',*WOOD,'63c74d','3e8948','265c42',*WHITE,'e43b44','a22633','0099db','124e89'] for i in range(4)},
}

def build(config):
    path=ROOT/config['file']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==config['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==config['size']
    sprites={};details={}
    for name,(w,h,*_) in SPECS.items():
        pixels=room.raster(image,config['crops'][name],(w,h),list(dict.fromkeys(PALETTES[name])))
        before=int((pixels[:,:,3]==255).sum())
        pixels=previous.remove_isolated(pixels)
        removed=before-int((pixels[:,:,3]==255).sum())
        rows=np.where(pixels[:,:,3].any(axis=1))[0];assert len(rows),name
        shift=h-1-int(rows.max())
        if shift:
            bottom=np.zeros_like(pixels);bottom[shift:]=pixels[:-shift];pixels=bottom
        sprites[name]=furniture.outlined(pixels)
        details[name]={'isolatedPixelsRemoved':removed,'bottomAlignmentShift':shift}
    for name in ('sofa','armchair'):
        sprites[name]=cloth_shading(sprites[name],image,config['crops'][name])
    sofa=sprites['sofa']
    for x in (17,30):
        sofa[3:13,x]=rgba('193c3e');sofa[15:24,x]=NAVY
    sofa[13,5:43]=NAVY;sofa[24,5:44]=NAVY
    for name,y,start,end in [('coffee-table',9,1,31),('kitchen-table',11,2,30)]:
        wood=previous.previous.mask_colors(sprites[name],WOOD)
        pixels=sprites[name];xs=np.arange(start,end);xs=xs[wood[y,xs]]
        pixels[y,xs]=rgba('e4a672')
    sprites['counter-sink']=normalize_sink(sprites['counter-sink'])
    fruit=sprites['fruit-bowl']
    fruit[1,4]=rgba('265c42');fruit[2:4,3:5]=rgba('e43b44')
    fruit[2:4,7:10]=rgba('feae34');fruit[2,8]=rgba('f77622')
    fruit[1:4,12]=rgba('fee761');fruit[2:4,13]=rgba('feae34')
    sprites['fruit-bowl']=furniture.outlined(fruit)
    vending,glass,bottles=vending_frames(sprites['vending-0'])
    for i,p in enumerate(vending):sprites[f'vending-{i}']=p
    kicker,motion=kicker_frames(sprites['kicker-0'])
    for i,p in enumerate(kicker):sprites[f'kicker-{i}']=p
    return sprites,details,{'vendingGlass':glass,'vendingBottles':bottles,'kickerMotion':motion}

def extend(atlas,sprites):
    sheet=np.zeros((96,192,4),dtype=np.uint8)
    for name,(w,h,x,y,placement,footprint,against_wall) in SPECS.items():
        sheet[y:y+h,x:x+w]=sprites[name]
        entry={'image':'decor/lounge.png','x':x,'y':y,'width':w,'height':h,'frames':1,
               'anchor':[0,h],'placement':placement}
        if placement=='floor':entry.update(footprintTiles=footprint,blocksMovement=True,againstWall=against_wall)
        if name in SPOTS:entry['spots']=SPOTS[name]
        if name in ('counter-sink','coffee-table','kitchen-table'):
            entry['surfaceBottomY']={'counter-sink':10,'coffee-table':11,'kitchen-table':14}[name]
        atlas['sprites'][name]=entry
    atlas['meta']['images']['decor/lounge.png']={'width':192,'height':96}
    atlas['animations']['vending-glow']={'states':['vending-0','vending-1'],'frameDurationMs':600,'loop':True}
    atlas['animations']['kicker-play']={'states':[f'kicker-{i}' for i in range(4)],'frameDurationMs':150,'loop':True}
    Image.fromarray(sheet).save(OUT/'decor/lounge.png')
    room.floors.save_json(OUT/'atlas.json',atlas)

def validate(atlas,details,masks):
    baseline=json.loads((ROOT/'art/references/stufe2-b1-atlas.json').read_text(encoding="utf-8"))
    previous.previous.preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2
    assert len(atlas['sprites'])==192 and len(atlas['animations'])==27
    hashes=json.loads((ROOT/'art/stufe2-b1-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);sheet=images['decor/lounge.png']
    assert sheet.shape==(96,192,4)
    assert set(np.unique(sheet[:,:,3]))=={0,255}
    assert {tuple(c) for c in sheet[sheet[:,:,3]==255,:3].tolist()}<=set(room.floors.PALETTE)
    cover=np.zeros((96,192),dtype=np.uint8)
    for name,(w,h,x,y,placement,footprint,against_wall) in SPECS.items():
        entry=atlas['sprites'][name];pixels=sprites[name]
        assert pixels.shape==(h,w,4) and pixels[-1,:,3].any(),name
        assert entry['anchor']==[0,h] and entry['frames']==1 and entry['placement']==placement
        assert 0<=x<=192-w and 0<=y<=96-h
        cover[y:y+h,x:x+w]+=1
        if placement=='floor':
            assert entry['footprintTiles']==footprint and entry['blocksMovement'] is True
            assert entry['againstWall']==against_wall
            assert footprint[0]*16==w and footprint[1]==1
        else:assert not {'footprintTiles','blocksMovement','againstWall'} & entry.keys()
        mask=pixels[:,:,3]==255;pad=np.pad(mask,1)
        edge=mask&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
        assert np.all(pixels[edge]==NAVY),(name,'open contour')
    assert cover.max()==1 and not sheet[cover==0,3].any()
    for name in ('sofa','armchair'):
        assert all(np.all(sprites[name]==rgba(c),axis=2).any() for c in TEAL),(name,'cloth shades')
    sofa_spots=atlas['sprites']['sofa']['spots']
    assert len(sofa_spots)==3 and all(s['facing']=='front' for s in sofa_spots)
    assert [s['dx'] for s in sofa_spots]==[8,24,40]
    assert all(-32<s['dy']<=0 and 0<s['dx']<48 for s in sofa_spots)
    for name in ('kitchen-table','kicker-0','kicker-1','kicker-2','kicker-3'):
        left,right=atlas['sprites'][name]['spots'];w=atlas['sprites'][name]['width']
        assert left['dx']<0 and right['dx']>w
        assert left['facing']=='right' and right['facing']=='left'
        assert left['dy']==right['dy']==0
    counter=sprites['counter-sink'];approved=sprites['kitchen-counter']
    sink=np.zeros((24,48),dtype=bool);sink[3:9,15:33]=True;sink[0:5,23:26]=True
    assert np.array_equal(counter[~sink],approved[~sink]),'Approved counter changed outside sink/tap'
    v0,v1=[sprites[f'vending-{i}'] for i in range(2)]
    glass=masks['vendingGlass'];assert glass.sum()>20
    assert np.array_equal(v0[~glass],v1[~glass])
    assert not np.array_equal(v0[glass],v1[glass])
    assert np.array_equal(v0[masks['vendingBottles']],v1[masks['vendingBottles']])
    frames=[sprites[f'kicker-{i}'] for i in range(4)];motion=masks['kickerMotion']
    assert len({p.tobytes() for p in frames})==4
    for i,p in enumerate(frames):
        assert np.array_equal(p[~motion],frames[0][~motion]),'Kicker case wobble'
        assert np.array_equal(p[:,:,3],frames[0][:,:,3]),'Kicker silhouette wobble'
        bx,by=BALLS[i];assert np.all(p[by,bx]==rgba('ffffff'))
        assert np.all(p[by-1,bx-1:bx+2]==NAVY) and np.all(p[by+1,bx-1:bx+2]==NAVY)
        assert all(np.all(p==rgba(c),axis=2).any() for c in ('e43b44','0099db','c0cbdc'))
    for key,count,duration in [('vending-glow',2,600),('kicker-play',4,150)]:
        animation=atlas['animations'][key]
        assert len(animation['states'])==count and len(set(animation['states']))==count
        assert all(s in atlas['sprites'] for s in animation['states'])
        assert animation['frameDurationMs']==duration and animation['loop'] is True
    return {'status':'passed','package':'C','newSprites':14,'newUniqueObjects':10,
            'newFloorSpriteFrames':12,'newCounterSprites':2,'newAnimations':2,
            'totalSprites':192,'totalAnimations':27,'schemaVersion':2,'image':'decor/lounge.png',
            'imageSize':[192,96],'palette':'ENDESGA 32','alphaLevels':[0,255],
            'atlasBoundsAndOverlap':'passed','floorFootprintsAndCollisionFlags':'passed',
            'againstWallFlags':'passed','counterPropsWithoutFloorCollision':'passed',
            'closedNavyContours':'passed','bottomAlignment':'passed','matchingClothShades':'passed',
            'sofaSeatCount':3,'interactionSpotsRelativeToBottomLeft':'passed',
            'approvedCounterUnchangedOutsideSinkAndTap':'passed',
            'vendingBodyAndBottlesPixelIdentical':'passed','vendingGlassPixelsChanged':int(glass.sum()),
            'kickerBodyAndSilhouettePixelIdentical':'passed','kickerDistinctFrames':4,
            'kickerBallCenters':[list(p) for p in BALLS],'kickerRodOffsets':[list(p) for p in ROD_OFFSETS],
            'allPreviousAtlasEntries':'unchanged','previousAssetFilesByteIdentical':len(hashes),
            'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-c-source.json').read_text(encoding="utf-8"))
    sprites,details,masks=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"))
    extend(atlas,sprites)
    report=validate(atlas,details,masks)
    from stufe2_c_previews import build as previews
    report.update(previews(atlas))
    room.floors.save_json(ROOT/'art/checks/stufe2-c-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
