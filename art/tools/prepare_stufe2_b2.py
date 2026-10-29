#!/usr/bin/env python3
"""Normalize generated office technology and extend A + B1 + C without replacement."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_stufe2_c as previous
from prepare_stufe2_a import preserved

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba
NAVY=rgba('181425')
WHITE=['ffffff','c0cbdc','8b9bb4']
DARK=['262b44','3a4466','5a6988']
METAL=['8b9bb4','5a6988','3a4466']
FABRIC=['ead4aa','e8b796','b86f50']
WARM=['fee761','feae34','f77622']
ORANGE=['f77622','be4a2f','733e39']
LEDS=['63c74d','2ce8f5','fee761']
PRINTER_NAMES=['printer-idle','printer-1','printer-2','printer-3']
PAPER_LENGTHS=[0,2,4,6]
PAPER_XY=[5,11]
SERVER_UNIT_TOPS=[6,11,16,21,26]
SERVER_LED_X=10
SERVER_LIGHTS=[
 ['63c74d','2ce8f5','fee761','5a6988','63c74d'],
 ['5a6988','63c74d','2ce8f5','fee761','5a6988'],
 ['2ce8f5','fee761','63c74d','5a6988','2ce8f5'],
 ['fee761','5a6988','2ce8f5','63c74d','fee761'],
]
SPECS={
 'printer-idle':(16,24,0,0,True,True),
 **{f'printer-{i}':(16,24,i*16,0,True,True) for i in range(1,4)},
 **{f'server-{i}':(16,32,i*16,24,True,True) for i in range(4)},
 'trash-bin':(16,16,0,72,True,False),
 'trash-bin-full':(16,16,16,72,True,False),
 'floor-lamp-off':(16,32,32,56,True,False),
 'floor-lamp-on':(16,32,48,56,True,False),
 'beanbag':(16,16,0,88,True,False),
 'doormat':(16,16,16,88,False,False),
}
PALETTES={
 **{name:['181425',*WHITE,*DARK,'63c74d'] for name in ['printer-idle','printer-1','printer-2','printer-3']},
 **{f'server-{i}':['181425',*DARK,*LEDS] for i in range(4)},
 'trash-bin':['181425',*METAL],
 'trash-bin-full':['181425',*METAL,*WHITE],
 'floor-lamp-off':['181425',*DARK,*FABRIC],
 'floor-lamp-on':['181425',*DARK,*WARM],
 'beanbag':['181425',*ORANGE],
 'doormat':['181425',*METAL],
}

def printer_frames(generated):
    base=generated.copy()
    base[10:13,5:11]=NAVY;base[12,6:10]=rgba('8b9bb4')
    mask=np.zeros((24,16),dtype=bool);mask[11:17,5:11]=True
    frames=[]
    for length in PAPER_LENGTHS:
        p=base.copy()
        if length:
            p[11:11+length,5:11]=NAVY
            p[11:10+length,6:10]=rgba('ffffff')
        frames.append(furniture.outlined(p))
    return frames,mask

def server_frames(generated):
    base=generated.copy();mask=np.zeros((32,16),dtype=bool)
    # Re-grid the generated five 4px-tall front units, one blank pixel per LED.
    for top in SERVER_UNIT_TOPS:
        base[top:top+4,2:12]=NAVY;base[top+1:top+4,3:11]=rgba('3a4466')
        base[top+1,3:11]=rgba('5a6988')
        for x in (4,6):base[top+2,x]=NAVY
        y=top+2;x=SERVER_LED_X
        base[y-1:y+2,x-1:x+2]=NAVY;mask[y,x]=True
    # Generated non-palette LED fringes may quantize to a bright palette color.
    bright=np.logical_or.reduce([np.all(base==rgba(c),axis=2) for c in LEDS])
    base[bright]=rgba('3a4466')
    frames=[]
    for colors in SERVER_LIGHTS:
        p=base.copy()
        for top,color in zip(SERVER_UNIT_TOPS,colors):p[top+2,SERVER_LED_X]=rgba(color)
        frames.append(furniture.outlined(p))
    return frames,mask

def full_bin(empty,generated):
    yy,xx=np.indices((16,16))
    paper=np.logical_or.reduce([np.all(generated==rgba(c),axis=2) for c in WHITE])&(yy<7)&(xx>=2)&(xx<=12)
    # Retain the generated crumpled-paper shapes, closing their tiny contour.
    padded=np.pad(paper,1);layer=np.zeros_like(paper)
    for dy in (-1,0,1):
        for dx in (-1,0,1):layer |= padded[1+dy:17+dy,1+dx:17+dx]
    p=empty.copy();p[layer]=NAVY;p[paper]=generated[paper]
    return furniture.outlined(p),layer

def lamp_frames(off):
    p=off.copy();mask=np.zeros((32,16),dtype=bool)
    for dim,bright in zip(FABRIC,WARM):
        selected=np.all(off==rgba(dim),axis=2);p[selected]=rgba(bright);mask|=selected
    return [off,p],mask

def build(config):
    path=ROOT/config['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==config['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==config['size']
    sprites={};details={}
    for name,(w,h,*_) in SPECS.items():
        p=room.raster(image,config['crops'][name],(w,h),list(dict.fromkeys(PALETTES[name])))
        before=int((p[:,:,3]==255).sum());p=previous.previous.remove_isolated(p)
        removed=before-int((p[:,:,3]==255).sum())
        rows=np.where(p[:,:,3].any(axis=1))[0];assert len(rows),name
        shift=h-1-int(rows.max())
        if shift:
            bottom=np.zeros_like(p);bottom[shift:]=p[:-shift];p=bottom
        sprites[name]=furniture.outlined(p)
        details[name]={'isolatedPixelsRemoved':removed,'bottomAlignmentShift':shift}
    printer,paper=printer_frames(sprites['printer-idle'])
    for name,p in zip(PRINTER_NAMES,printer):sprites[name]=p
    server,leds=server_frames(sprites['server-0'])
    for i,p in enumerate(server):sprites[f'server-{i}']=p
    sprites['trash-bin-full'],trash=full_bin(sprites['trash-bin'],sprites['trash-bin-full'])
    lamps,shade=lamp_frames(sprites['floor-lamp-off'])
    sprites['floor-lamp-off'],sprites['floor-lamp-on']=lamps
    return sprites,details,{'printerPaper':paper,'serverLEDs':leds,'trashPaper':trash,'lampShade':shade}

def extend(atlas,sprites):
    sheet=np.zeros((112,64,4),dtype=np.uint8)
    for name,(w,h,x,y,blocking,wall) in SPECS.items():
        sheet[y:y+h,x:x+w]=sprites[name]
        entry={'image':'decor/decor-b.png','x':x,'y':y,'width':w,'height':h,'frames':1,
               'anchor':[0,h],'placement':'floor','footprintTiles':[1,1],
               'blocksMovement':blocking,'againstWall':wall}
        if name=='beanbag':entry['spots']=[{'name':'seat','dx':8,'dy':-1,'facing':'front'}]
        atlas['sprites'][name]=entry
    atlas['meta']['images']['decor/decor-b.png']={'width':64,'height':112}
    atlas['animations']['printer-print']={'states':['printer-idle','printer-1','printer-2','printer-3'],'frameDurationMs':200,'loop':False}
    atlas['animations']['server-blink']={'states':[f'server-{i}' for i in range(4)],'frameDurationMs':180,'loop':True}
    Image.fromarray(sheet).save(OUT/'decor/decor-b.png');room.floors.save_json(OUT/'atlas.json',atlas)

def validate(atlas,details,masks):
    baseline=json.loads((ROOT/'art/references/stufe2-c-atlas.json').read_text(encoding="utf-8"));preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2 and len(atlas['sprites'])==206 and len(atlas['animations'])==29
    hashes=json.loads((ROOT/'art/stufe2-c-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);sheet=images['decor/decor-b.png']
    assert sheet.shape==(112,64,4) and set(np.unique(sheet[:,:,3]))=={0,255}
    assert {tuple(c) for c in sheet[sheet[:,:,3]==255,:3].tolist()}<=set(room.floors.PALETTE)
    cover=np.zeros((112,64),dtype=np.uint8)
    for name,(w,h,x,y,blocking,wall) in SPECS.items():
        p=sprites[name];entry=atlas['sprites'][name]
        assert p.shape==(h,w,4) and p[-1,:,3].any(),name
        assert entry['anchor']==[0,h] and entry['placement']=='floor' and entry['frames']==1
        assert entry['footprintTiles']==[1,1] and entry['blocksMovement']==blocking and entry['againstWall']==wall
        assert 0<=x<=64-w and 0<=y<=112-h;cover[y:y+h,x:x+w]+=1
        opaque=p[:,:,3]==255;pad=np.pad(opaque,1)
        edge=opaque&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
        assert np.all(p[edge]==NAVY),(name,'open contour')
    assert cover.max()==1 and not sheet[cover==0,3].any()
    printers=[sprites[n] for n in PRINTER_NAMES];paper=masks['printerPaper']
    assert len({p.tobytes() for p in printers})==4
    for p,length in zip(printers,PAPER_LENGTHS):
        assert np.array_equal(p[~paper],printers[0][~paper])
        assert np.array_equal(p[:,:,3],printers[0][:,:,3])
        if length:assert np.all(p[11:10+length,6:10]==rgba('ffffff')),'Printed page must stay blank'
    servers=[sprites[f'server-{i}'] for i in range(4)];leds=masks['serverLEDs']
    assert leds.sum()==5 and len({p.tobytes() for p in servers})==4
    for p in servers:
        assert np.array_equal(p[~leds],servers[0][~leds])
        assert np.array_equal(p[:,:,3],servers[0][:,:,3])
        bright=np.logical_or.reduce([np.all(p==rgba(c),axis=2) for c in LEDS])
        assert not bright[~leds].any(),'Status lights must be isolated native pixels'
        for y,x in np.argwhere(leds):
            assert all(np.array_equal(p[y+dy,x+dx],NAVY) for dy,dx in ((0,-1),(0,1),(-1,0),(1,0)))
        for top in SERVER_UNIT_TOPS:assert np.all(p[top+1,3:9]==rgba('5a6988')),'Five clear rack units required'
    trash=sprites['trash-bin'];full=sprites['trash-bin-full'];trash_layer=masks['trashPaper']
    assert np.array_equal(trash[~trash_layer],full[~trash_layer])
    assert np.all(full==rgba('ffffff'),axis=2).sum()>0
    off,on=sprites['floor-lamp-off'],sprites['floor-lamp-on'];shade=masks['lampShade']
    assert shade.sum()>10 and not shade[11:].any()
    assert np.array_equal(off[~shade],on[~shade]) and np.array_equal(off[:,:,3],on[:,:,3])
    assert not np.array_equal(off[shade],on[shade])
    assert atlas['sprites']['doormat']['blocksMovement'] is False
    assert sum(atlas['sprites'][n]['blocksMovement'] for n in SPECS)==13
    for name,count,duration,loop in [('printer-print',4,200,False),('server-blink',4,180,True)]:
        a=atlas['animations'][name]
        assert len(a['states'])==count and len(set(a['states']))==count
        assert a['frameDurationMs']==duration and a['loop']==loop
        assert all(n in atlas['sprites'] for n in a['states'])
    return {'status':'passed','package':'B2','newSprites':14,'newAnimations':2,'totalSprites':206,'totalAnimations':29,
            'schemaVersion':2,'image':'decor/decor-b.png','imageSize':[64,112],
            'palette':'ENDESGA 32','alphaLevels':[0,255],'atlasBoundsAndOverlap':'passed',
            'closedNavyContours':'passed','bottomAlignment':'passed','floorFootprintsAndCollisionFlags':'passed',
            'blockingNewSprites':13,'walkableDoormat':'passed','againstWallFlags':'passed',
            'printerBodyAndSilhouettePixelIdentical':'passed','printerPaperLengths':PAPER_LENGTHS,
            'printedPaperBlank':'passed','printerSinglePlay':'passed',
            'serverBodyAndSilhouettePixelIdentical':'passed','serverUnitCount':5,'serverSinglePixelStatusLights':5,
            'trashBodyIdenticalOutsidePaper':'passed','lampSilhouetteAndBasePixelIdentical':'passed',
            'lampOnlyShadeChangesNoHalo':'passed','allPreviousAtlasEntries':'unchanged',
            'previousAssetFilesByteIdentical':len(hashes),'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-b2-source.json').read_text(encoding="utf-8"))
    sprites,details,masks=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));extend(atlas,sprites)
    report=validate(atlas,details,masks)
    from stufe2_b2_previews import build as previews
    report.update(previews(atlas));room.floors.save_json(ROOT/'art/checks/stufe2-b2-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
