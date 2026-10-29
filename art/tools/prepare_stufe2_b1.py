#!/usr/bin/env python3
"""Reduce generated plants and storage furniture and extend packages 1 + A."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_stufe2_a as previous

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba
NAVY=rgba('181425')
GREENS=['63c74d','3e8948','265c42']
WHITE=['ffffff','c0cbdc','8b9bb4']
WOOD=['e4a672','b86f50','733e39']
METAL=['c0cbdc','8b9bb4','5a6988']
BOOKS=['e43b44','a22633','0099db','124e89','2ce8f5','feae34','fee761',*GREENS,*WHITE]
SPECS={
 'plant-tall':(16,32,0,0,'floor',[1,1],False),
 'plant-bush':(16,24,16,8,'floor',[1,1],False),
 'plant-palm':(16,32,32,0,'floor',[1,1],False),
 'plant-desk':(8,12,48,20,'desk',None,None),
 'cactus-desk':(8,12,56,20,'desk',None,None),
 'bookshelf':(32,32,0,32,'floor',[2,1],True),
 'bookshelf-low':(32,24,32,40,'floor',[2,1],True),
 'filing-cabinet':(16,32,0,64,'floor',[1,1],True),
 'coat-rack':(16,32,16,64,'floor',[1,1],False),
}
PALETTES={
 'plant-tall':['181425',*GREENS,*WHITE,'3e2731','733e39'],
 'plant-bush':['181425',*GREENS,*WOOD],
 'plant-palm':['181425',*GREENS,*METAL,'3e2731','733e39'],
 'plant-desk':['181425',*GREENS,*WHITE,'3e2731','733e39'],
 'cactus-desk':['181425',*GREENS,*WOOD],
 'bookshelf':['181425',*WOOD,'262b44',*BOOKS],
 'bookshelf-low':['181425',*WOOD,'262b44',*BOOKS],
 'filing-cabinet':['181425',*METAL],
 'coat-rack':['181425',*WOOD,'262b44','3a4466','124e89','ead4aa','c0cbdc'],
}

def remove_isolated(pixels):
    result=pixels.copy();mask=pixels[:,:,3]==255
    pad=np.pad(mask,1);neighbors=np.zeros_like(mask,dtype=np.uint8)
    h,w=mask.shape
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if dx or dy:neighbors+=pad[1+dy:1+dy+h,1+dx:1+dx+w]
    result[mask&(neighbors==0)]=0
    return result

def build(config):
    path=ROOT/config['file']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==config['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==config['size']
    sprites={};details={}
    for name,(w,h,*_) in SPECS.items():
        palette=list(dict.fromkeys(PALETTES[name]))
        pixels=room.raster(image,config['crops'][name],(w,h),palette)
        if name in ('bookshelf','bookshelf-low'):
            # Palette separation keeps red book colors out of the wooden case.
            wood=room.raster(image,config['crops'][name],(w,h),['181425',*WOOD])
            interior=np.zeros((h,w),dtype=bool)
            if name=='bookshelf':
                for top,bottom in ((6,13),(16,22),(25,30)):interior[top:bottom,3:28]=True
                frame=(pixels[:,:,3]==255)&~interior
            else:
                for top,bottom in ((11,16),(18,22)):interior[top:bottom,3:29]=True
                yy,_=np.indices((h,w))
                plant=previous.mask_colors(pixels,[*GREENS,*WHITE])&(yy<=10)
                frame=(pixels[:,:,3]==255)&~interior&~plant&(yy>=7)
            frame &= ~np.all(pixels==NAVY,axis=2)
            pixels[frame]=wood[frame]
        if name=='filing-cabinet':
            # Restore three clear drawer fronts and small blank metal handles.
            for top in (6,14,22):
                pixels[top:top+8,1:13]=rgba('8b9bb4')
                pixels[top,1:13]=NAVY
                pixels[top+1:top+8,1]=NAVY
                pixels[top+1:top+8,12]=NAVY
                pixels[top+1,2:12]=rgba('c0cbdc')
                pixels[top+3,5:10]=NAVY
                pixels[top+3,6:9]=rgba('c0cbdc')
            pixels[30,1:13]=NAVY
        before=int((pixels[:,:,3]==255).sum())
        pixels=remove_isolated(pixels)
        removed=before-int((pixels[:,:,3]==255).sum())
        rows=np.where(pixels[:,:,3].any(axis=1))[0]
        assert len(rows),name
        shift=h-1-int(rows.max())
        if shift:
            bottom=np.zeros_like(pixels);bottom[shift:]=pixels[:-shift];pixels=bottom
        pixels=furniture.outlined(pixels)
        highlight_edits=0
        if name in ('plant-tall','plant-bush','plant-palm','plant-desk','cactus-desk'):
            leaf=previous.mask_colors(pixels,GREENS)
            yy,xx=np.where(leaf)
            assert len(yy)>=3,(name,'Too few leaf pixels')
            ordered=sorted(zip(yy,xx),key=lambda p:(p[0]+p[1],p[0]))
            for shade,rank in ((GREENS[0],0),(GREENS[1],len(ordered)//2),(GREENS[2],-1)):
                if not np.all(pixels==rgba(shade),axis=2).any():
                    y,x=ordered[rank];pixels[y,x]=rgba(shade);highlight_edits+=1
        sprites[name]=pixels
        details[name]={'isolatedPixelsRemoved':removed,'bottomAlignmentShift':shift,'leafShadeCorrections':highlight_edits}
    return sprites,details

def extend(atlas,sprites):
    sheet=np.zeros((96,64,4),dtype=np.uint8)
    for name,(w,h,x,y,placement,footprint,against_wall) in SPECS.items():
        sheet[y:y+h,x:x+w]=sprites[name]
        entry={'image':'decor/decor-a.png','x':x,'y':y,'width':w,'height':h,'frames':1,
               'anchor':[0,h],'placement':placement}
        if placement=='floor':entry.update(footprintTiles=footprint,blocksMovement=True,againstWall=against_wall)
        atlas['sprites'][name]=entry
    atlas['meta']['images']['decor/decor-a.png']={'width':64,'height':96}
    Image.fromarray(sheet).save(OUT/'decor/decor-a.png')
    room.floors.save_json(OUT/'atlas.json',atlas)

def validate(atlas,details):
    baseline=json.loads((ROOT/'art/references/stufe2-a-atlas.json').read_text(encoding="utf-8"))
    previous.preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2
    assert len(atlas['sprites'])==178 and len(atlas['animations'])==25
    hashes=json.loads((ROOT/'art/stufe2-a-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);sheet=images['decor/decor-a.png']
    assert sheet.shape==(96,64,4)
    assert set(np.unique(sheet[:,:,3]))=={0,255}
    assert {tuple(c) for c in sheet[sheet[:,:,3]==255,:3].tolist()}<=set(room.floors.PALETTE)
    cover=np.zeros((96,64),dtype=np.uint8)
    for name,(w,h,x,y,placement,footprint,against_wall) in SPECS.items():
        entry=atlas['sprites'][name];pixels=sprites[name]
        assert pixels.shape==(h,w,4) and pixels[-1,:,3].any(),name
        assert entry['anchor']==[0,h] and entry['frames']==1 and entry['placement']==placement
        assert 0<=x<=64-w and 0<=y<=96-h
        cover[y:y+h,x:x+w]+=1
        if placement=='floor':
            assert entry['footprintTiles']==footprint and entry['blocksMovement'] is True
            assert entry['againstWall']==against_wall
        else:
            assert not {'footprintTiles','blocksMovement','againstWall'} & entry.keys()
        mask=pixels[:,:,3]==255;pad=np.pad(mask,1)
        edge=mask&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
        assert np.all(pixels[edge]==NAVY),(name,'open contour')
    assert cover.max()==1 and not sheet[cover==0,3].any()
    for name in ('plant-tall','plant-bush','plant-palm','plant-desk','cactus-desk'):
        p=sprites[name]
        visible={tuple(c) for c in p[p[:,:,3]==255,:3].tolist()}
        assert {tuple(bytes.fromhex(h)) for h in GREENS}<=visible,(name,'leaf shades lost')
    cabinet=sprites['filing-cabinet']
    handles=[y for y in range(6,30) if np.all(cabinet[y,5]==NAVY) and np.all(cabinet[y,9]==NAVY)
             and np.all(cabinet[y,6:9]==rgba('c0cbdc'))]
    assert len(handles)==3,'Cabinet must have three separate handles/drawers'
    compartments={}
    for name,start in (('bookshelf',6),('bookshelf-low',11)):
        book=previous.mask_colors(sprites[name],BOOKS)[:,3:28].sum(axis=1)>=3
        count=0;inside=False
        for occupied in book[start:]:
            if occupied and not inside:count+=1
            inside=bool(occupied)
        assert count==(3 if name=='bookshelf' else 2),(name,'Book compartments',count)
        compartments[name]=count
    return {'status':'passed','package':'B1','newSprites':9,'newFloorSprites':7,'newDeskSprites':2,
            'totalSprites':178,'totalAnimations':25,'schemaVersion':2,'image':'decor/decor-a.png',
            'imageSize':[64,96],'palette':'ENDESGA 32','alphaLevels':[0,255],
            'atlasBoundsAndOverlap':'passed','floorFootprintsAndCollisionFlags':'passed',
            'againstWallFlags':'passed','deskPlantsWithoutFloorCollision':'passed',
            'closedNavyContours':'passed','bottomAlignment':'passed','greenFoliagePreserved':'passed',
            'threeGreenLeafShades':'passed','cabinetDrawerCount':len(handles),'bookCompartments':compartments,
            'allPreviousAtlasEntries':'unchanged','previousAssetFilesByteIdentical':len(hashes),
            'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-b1-source.json').read_text(encoding="utf-8"))
    sprites,details=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"))
    extend(atlas,sprites);report=validate(atlas,details)
    from stufe2_b1_previews import build as previews
    report.update(previews(atlas))
    room.floors.save_json(ROOT/'art/checks/stufe2-b1-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
