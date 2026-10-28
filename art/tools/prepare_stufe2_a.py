#!/usr/bin/env python3
"""Normalize generated wall decorations and extend the frozen Stage 1 atlas."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_emotes as base

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/office'
room, furniture = base.room, base.furniture
rgba = room.rgba
PALETTE = [''.join(f'{v:02x}' for v in color) for color in room.floors.PALETTE]
NAVY, WHITE = rgba('181425'), rgba('ffffff')
SPECS = {
 'window-day': (32,24,3,0,0), 'window-dawn': (32,24,3,32,0),
 'window-dusk': (32,24,3,64,0), 'window-night': (32,24,3,96,0),
 'whiteboard': (48,24,3,0,24), 'corkboard': (32,24,4,48,24),
 'wall-tv': (32,24,3,80,24), 'wall-clock': (16,16,4,0,48),
 'calendar': (16,16,6,16,48), 'picture-landscape': (16,16,6,32,48),
 'picture-abstract': (16,16,6,48,48), 'poster-mountain': (16,24,4,64,48),
 'wall-shelf': (32,16,6,0,80),
}
CONTENT = {'whiteboard': [3,3,42,16], 'wall-tv': [3,3,26,17], 'calendar': [3,6,10,8]}

def mask_colors(pixels, colors):
    return np.logical_or.reduce([np.all(pixels == rgba(h), axis=2) for h in colors])

def build(config):
    source = ROOT / config['file']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == config['sha256']
    image = Image.open(source).convert('RGBA')
    assert list(image.size) == config['size']
    sprites = {name: furniture.outlined(room.raster(image, config['crops'][name], (w,h), PALETTE))
               for name,(w,h,*_) in SPECS.items()}
    day = sprites['window-day'].copy()
    glass = np.zeros((24,32), dtype=bool)
    glass[3:21,3:29] = True
    glass[:,15:17] = False
    yy,xx = np.indices(glass.shape)
    # Retain one frame, crossbar and sill for all four views. Carry the same
    # generated city/foliage silhouettes across lighting states as well.
    city_seed = mask_colors(day, ['8b9bb4','5a6988','3a4466','124e89','0099db']) & glass & (yy >= 9)
    vegetation = mask_colors(day, ['63c74d','3e8948','265c42','193c3e']) & glass
    city = np.zeros_like(glass)
    for x in range(32):
        rows = np.where(city_seed[:,x])[0]
        if len(rows): city[rows.min():21,x] = glass[rows.min():21,x]
    clouds = mask_colors(day,['ffffff','c0cbdc']) & glass & (yy < 12)
    moon = sprites['window-night'].copy()
    moon_mask = mask_colors(moon,['ffffff','c0cbdc','ead4aa','fee761']) & (xx>=22)&(xx<=27)&(yy>=3)&(yy<=8)&glass
    frame_area = ~glass & (day[:,:,3]==255)
    frame_dark = mask_colors(day,['b86f50','733e39','3e2731','5a6988','3a4466']) & frame_area
    frame_light = mask_colors(day,['ead4aa','e8b796','e4a672','feae34','fee761']) & frame_area
    frame_outline = np.all(day==NAVY,axis=2)&frame_area
    day[frame_area]=rgba('e4a672');day[frame_dark]=rgba('b86f50');day[frame_light]=rgba('ead4aa');day[frame_outline]=NAVY
    palettes = {
        'window-day': ('0099db','2ce8f5','2ce8f5','5a6988','3e8948','ffffff'),
        'window-dawn': ('f6757a','d77643','feae34','3a4466','265c42','fee761'),
        'window-dusk': ('68386c','b55088','f77622','262b44','265c42','feae34'),
        'window-night': ('124e89','124e89','124e89','181425','193c3e','124e89'),
    }
    for name, shades in palettes.items():
        p = sprites[name]
        p[~glass] = day[~glass]
        for band,(top,bottom) in enumerate(((3,7),(7,11),(11,21))):
            p[glass & (yy>=top)&(yy<bottom)] = rgba(shades[band])
        p[clouds] = rgba(shades[5])
        p[city] = rgba(shades[3])
        p[vegetation] = rgba(shades[4])
        if name=='window-night':p[moon_mask]=rgba('ead4aa')
        if name in ('window-dusk', 'window-night'):
            candidates = [(x,y) for x,y in ((7,14),(11,17),(21,14),(25,17),(9,19),(23,19)) if city[y,x] and not vegetation[y,x]]
            for x,y in candidates[:3 if name == 'window-dusk' else len(candidates)]: p[y,x] = rgba('fee761')
    night = sprites['window-night']
    # The raw image has three stars; snap them to isolated native pixels.
    moon_roi = (xx >= 22) & (xx <= 27) & (yy >= 3) & (yy <= 8)
    old_stars = mask_colors(night, ['ffffff','c0cbdc','ead4aa','fee761']) & glass & (yy < 12) & ~moon_roi
    night[old_stars] = rgba('124e89')
    for x,y in ((8,5),(12,8),(20,9)): night[y,x] = WHITE
    for name in ('whiteboard', 'calendar'):
        x,y,w,h = CONTENT[name]; sprites[name][y:y+h,x:x+w] = WHITE
    sprites['whiteboard'][21,12:17]=rgba('e43b44')
    sprites['whiteboard'][21,24:29]=rgba('0099db')
    # Snap the five blank note papers to their intended palette hues; pale
    # generated greens/blues would otherwise quantize to beige and grey.
    board=sprites['corkboard'];board[3:21,3:29]=rgba('e4a672')
    for x,y,color,pin in ((7,5,'fee761','a22633'),(21,5,'f6757a','124e89'),
                          (5,14,'2ce8f5','265c42'),(14,12,'63c74d','feae34'),(24,14,'fee761','a22633')):
        board[y+1:y+7,x+1:x+6]=rgba('b86f50')
        board[y:y+6,x:x+5]=rgba(color)
        board[y,x+2]=rgba(pin)
    # Preserve the generated TV body while making its writable screen precise.
    x,y,w,h = CONTENT['wall-tv']; sprites['wall-tv'][y:y+h,x:x+w] = NAVY
    for offset in range(16): sprites['wall-tv'][y+offset,x+w-3-offset] = rgba('3a4466')
    # A clock face has ticks, but the runtime owns the hands and pivot.
    clock = sprites['wall-clock']; clock[3:13,3:13] = WHITE
    for x,y in ((8,3),(12,8),(8,12),(3,8)): clock[y,x] = NAVY
    # Five source spines collapse into four readable, blank book spines.
    shelf = sprites['wall-shelf']
    for start,end,top,color in ((4,7,3,'e43b44'),(7,10,4,'0099db'),(10,14,4,'3e8948'),(14,17,2,'feae34')):
        shelf[top:11,start:end] = rgba(color)
        shelf[top:11,start] = NAVY
        shelf[top,start+1:end] = rgba('fee761' if color=='feae34' else color)
    return sprites, glass, city

def extend(atlas, sprites):
    sheet = np.zeros((96,128,4), dtype=np.uint8)
    for name,(w,h,wall_y,x,y) in SPECS.items():
        sheet[y:y+h,x:x+w] = sprites[name]
        entry = {'image':'decor/wall.png','x':x,'y':y,'width':w,'height':h,'frames':1,
                 'anchor':[0,h],'placement':'wall','wallY':wall_y}
        if name in CONTENT: entry['contentRect'] = CONTENT[name]
        if name == 'wall-clock': entry['handsCenter'] = [8,8]
        atlas['sprites'][name] = entry
    atlas['meta']['images']['decor/wall.png'] = {'width':128,'height':96}
    atlas['stateGroups']['window'] = ['window-day','window-dawn','window-dusk','window-night']
    (OUT/'decor').mkdir(exist_ok=True)
    Image.fromarray(sheet).save(OUT/'decor/wall.png')
    room.floors.save_json(OUT/'atlas.json',atlas)

def preserved(old, new, location='atlas'):
    if isinstance(old,dict):
        assert isinstance(new,dict),location
        for key,value in old.items():
            assert key in new,(location,key)
            preserved(value,new[key],location+'.'+key)
    else: assert old == new,location

def validate(atlas, glass):
    baseline = json.loads((ROOT/'art/references/stufe1-atlas.json').read_text(encoding="utf-8"))
    preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion'] == 2
    assert len(atlas['sprites']) == 169 and len(atlas['animations']) == 25
    hashes = json.loads((ROOT/'art/stufe1-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items(): assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites = room.read_sprites(atlas)
    pixels = images['decor/wall.png']
    assert pixels.shape == (96,128,4)
    assert set(np.unique(pixels[:,:,3])) == {0,255}
    assert {tuple(c) for c in pixels[pixels[:,:,3]==255,:3].tolist()} <= set(room.floors.PALETTE)
    cover = np.zeros((96,128),dtype=np.uint8)
    for name,(w,h,wall_y,x,y) in SPECS.items():
        p=sprites[name];entry=atlas['sprites'][name]
        assert p.shape==(h,w,4) and p[:,:,3].any(),name
        assert entry['placement']=='wall' and entry['wallY']==wall_y and 0<=wall_y<=32-h
        assert entry['anchor']==[0,h] and entry['frames']==1
        cover[y:y+h,x:x+w]+=1
        if name in CONTENT:
            cx,cy,cw,ch=entry['contentRect'];assert 0<=cx<=w-cw and 0<=cy<=h-ch
            if name!='wall-tv':assert np.all(p[cy:cy+ch,cx:cx+cw]==WHITE),(name,'writing area')
    assert cover.max()==1 and not pixels[cover==0,3].any()
    windows=[sprites[name] for name in ('window-day','window-dawn','window-dusk','window-night')]
    assert all(np.array_equal(p[~glass],windows[0][~glass]) for p in windows[1:])
    assert len({p[glass].tobytes() for p in windows})==4
    assert all(np.array_equal(p[:,:,3],windows[0][:,:,3]) for p in windows)
    skyline = mask_colors(windows[0],['5a6988']) & glass
    for p,colors in zip(windows[1:],(['3a4466'],['262b44','fee761'],['181425','fee761'])):
        assert np.array_equal(mask_colors(p,colors)&glass,skyline),'City silhouette changed'
    assert (mask_colors(windows[3],['ffffff'])&glass).sum()==3,'Night must have three single-pixel stars'
    clock=sprites['wall-clock']
    assert np.all(clock[6:11,6:11]==WHITE),'Clock must have no hands or pivot'
    report={'status':'passed','package':'A','newSprites':13,'totalSprites':169,'totalAnimations':25,
            'schemaVersion':2,'image':'decor/wall.png','imageSize':[128,96],'alphaLevels':[0,255],
            'palette':'ENDESGA 32','atlasBoundsAndOverlap':'passed','allPreviousAtlasEntries':'unchanged',
            'previousAssetFilesByteIdentical':len(hashes),'windowFramesPixelIdentical':'passed',
            'windowViewsDistinct':'passed','windowSilhouettesIdentical':'passed',
            'citySilhouettesIdentical':'passed','nightThreePixelStars':'passed',
            'blankWhiteboardAndCalendar':'passed','clockHasNoHands':'passed',
            'placementWallYContentRectHandsCenter':'passed','previewScale':3}
    return report

def main():
    base.main()
    config=json.loads((ROOT/'art/stufe2-a-source.json').read_text(encoding="utf-8"))
    sprites,glass,_=build(config)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"))
    extend(atlas,sprites)
    report=validate(atlas,glass)
    from stufe2_a_previews import build as previews
    report.update(previews(atlas))
    room.floors.save_json(ROOT/'art/checks/stufe2-a-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
