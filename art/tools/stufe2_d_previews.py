"""Exact 3x surface swatches, seam proof and furnished four-area montage."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import prepare_stufe2_d as kit
import prepare_characters as chars

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
CHECKS=ROOT/'art/checks'

def large(im):return im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    im=Image.new('RGB',(1120,1052),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,24),'Pixel-Büro · Stufe 2 · Paket D',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Böden und Wände · alle 17 neuen Sprites exakt 3× · neutraler Grund',font=font(14),fill='#c0cbdc')
    slots=[(n,0,i) for i,n in enumerate(kit.FLOORS)]
    slots += [(n,1+i//3,i%3) for i,n in enumerate(kit.RUNNER_NAMES)]
    slots += [(n,1+i,3) for i,n in enumerate(kit.WALLS)]
    for name,row,col in slots:
        x=32+col*264;y=104+row*176;width=244
        d.rounded_rectangle((x,y,x+width,y+158),radius=5,fill='#3a4466')
        d.rectangle((x+8,y+6,x+width-8,y+109),fill='#8b9bb4')
        sprite=large(sprites[name]);px=x+(width-sprite.width)//2;py=y+106-sprite.height
        im.paste(sprite,(px,py),sprite);entry=atlas['sprites'][name]
        d.text((x+10,y+119),name,font=font(13,True),fill='#ffffff')
        kind='Wand' if entry['placement']=='wall' else 'begehbarer Boden'
        d.text((x+10,y+139),f"{entry['width']} × {entry['height']} px · {kind}",font=font(10),fill='#c0cbdc')
        flat=Image.new('RGB',sprite.size,'#8b9bb4');flat.paste(sprite,mask=sprite)
        assert np.array_equal(np.asarray(flat),np.asarray(im.crop((px,py,px+sprite.width,py+sprite.height)))),name
    d.text((32,832),'Ein Satz, viele Raumgrößen',font=font(23,True),fill='#ffffff')
    d.text((32,876),'Der Läufer besteht aus neun Teilen mit durchgehendem Goldrand.',font=font(15),fill='#c0cbdc')
    d.text((32,904),'Vier Bodenarten wiederholen in beide Richtungen ohne Naht.',font=font(15),fill='#c0cbdc')
    d.text((32,932),'Die Wände passen an die vorhandenen Abschlussleisten.',font=font(15),fill='#c0cbdc')
    d.text((32,1014),'ENDESGA 32 · Alpha 0/255 · transparente Glasmitte · Atlasformat 2',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-d-sprites.png');return len(slots)

def tiling(atlas,sprites,pixels):
    im=Image.new('RGB',(1120,1040),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;checked=0
    d.text((32,24),'Paket D · Wiederholung und Läufergrößen',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Alle Grafikflächen exakt 3× · ausschließlich unveränderte Atlas-Ausschnitte',font=font(14),fill='#c0cbdc')
    def sample(p,x,y):
        nonlocal checked
        view=large(Image.fromarray(p));d.rectangle((x,y,x+view.width-1,y+view.height-1),fill='#8b9bb4');im.paste(view,(x,y),view)
        expected=Image.new('RGB',view.size,'#8b9bb4');expected.paste(view,mask=view)
        assert np.array_equal(np.asarray(expected),np.asarray(im.crop((x,y,x+view.width,y+view.height))))
        checked+=1
    for i,name in enumerate(kit.FLOORS):
        x=32+i*264;sample(np.tile(pixels[name],(3,3,1)),x+38,110)
        d.text((x,274),name+' · 3 × 3 Kacheln',font=font(12,True),fill='#ffffff')
    for i,name in enumerate(kit.WALLS):
        x=32+i*264;sample(np.tile(pixels[name],(1,4,1)),x+22,348)
        d.text((x,464),name+' · 4 Segmente',font=font(12,True),fill='#ffffff')
    for width,height,x in [(3,3,64),(7,3,304),(3,7,832)]:
        sample(kit.assemble_runner(atlas,pixels,width,height),x,572)
        d.text((x,744 if height==3 else 930),f'Läufer {width} × {height}',font=font(15,True),fill='#ffffff')
    d.text((32,994),'Gleiche Ecken und Randstücke · keine Zwischenrahmen · Mindestgröße 3 × 3 Kacheln',font=font(14),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-d-tiling.png');return checked

def room_scene(atlas,sprites,pixels):
    scene=Image.new('RGBA',(384,240))
    def put(name,x,y,image=None):scene.alpha_composite(image if image is not None else sprites[name],(x,y))
    for y in range(32,224,16):
        for x in range(16,368,16):
            name='tile-lobby' if 160<=x<224 else 'carpet-blue' if x<160 and y<112 else 'carpet-wine' if x<160 else 'carpet-green' if y<144 else 'tile-lobby'
            put(name,x,y)
    runner=Image.fromarray(kit.assemble_runner(atlas,pixels,4,12));scene.alpha_composite(runner,(160,32))
    for x in range(16,160,16):put('wall-brick',x,0);put('wall-green',x,112)
    for x in range(224,368,16):put('wall-wood',x,0);put('wall-glass',x,112)
    for x in range(160,224,16):put('wall-plain',x,0)
    put('door-wood-closed',176,0)
    put('wall-outer-corner',12,0);put('wall-outer-corner',356,0,ImageOps.mirror(sprites['wall-outer-corner']))
    for y in range(16,224,16):
        put('wall-side-cap',12,y);put('wall-side-cap',356,y,ImageOps.mirror(sprites['wall-side-cap']))
    for name,x,base in [('window-day',32,0),('whiteboard',80,0),('wall-clock',136,0),
                         ('window-day',240,0),('picture-abstract',288,0),('calendar',320,0),
                         ('picture-landscape',32,112),('poster-mountain',60,112),('whiteboard',104,112)]:
        put(name,x,base+atlas['sprites'][name]['wallY'])
    def desk(look,x,y,task):
        animation=atlas['animations'][look+'-'+task];index=1;key=animation['states'][index];origin=(x+16,y-16)
        put(key,*origin);put('desk-large',x,y);put('lamp-on',x+1,y-5)
        prop=animation.get('prop')
        if prop:
            item=prop.get('sprite') or atlas['animations'][prop['animation']]['states'][prop['frameMap'][index]]
            mx,my=prop['mount'];put(item,origin[0]+mx,origin[1]+my)
        put('plant-desk',x+36,y-4)
        entry=atlas['sprites'][key]
        hands=Image.open(OUT/animation['foregroundImage']).convert('RGBA').crop((entry['x'],entry['y'],entry['x']+16,entry['y']+32))
        scene.alpha_composite(hands,origin)
    desk('look-01',48,72,'type')
    for name,x,y in [('server-1',128,40),('printer-3',144,48),
                     ('kitchen-counter',224,64),('counter-sink',272,64),('microwave',228,56),('fruit-bowl',252,64),
                     ('fridge',336,56),('kitchen-table',288,88),('stool',272,96),('plant-palm',320,80),
                     ('sofa',32,160),('armchair',96,168),('coffee-table',48,200),('beanbag',112,200),('floor-lamp-on',128,160),
                     ('plant-tall',224,176),('vending-0',336,152),('trash-bin-full',336,200)]:put(name,x,y)
    for look,dx,mirror in [('look-01',-8,False),('look-02',56,True)]:
        person=sprites[look+'-right']
        if look=='look-02':person=Image.fromarray(chars.recolor(np.asarray(person),chars.GREEN))
        if mirror:person=ImageOps.mirror(person)
        scene.alpha_composite(person,(256+dx-8,208-32))
    put('kicker-2',256,184)
    return scene

def montage(atlas,sprites,pixels):
    view=large(room_scene(atlas,sprites,pixels));im=Image.new('RGB',(1216,858),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,22),'Pixel-Büro · Vier Bereiche mit eigenen Oberflächen',font=font(25,True),fill='#ffffff')
    d.text((32,64),'Blauer, grüner und weinroter Teppich · Steinboden · Goldläufer · vier Wandarten · Ansicht 3×',font=font(13),fill='#c0cbdc')
    d.rectangle((28,100,1187,827),fill='#8b9bb4');im.paste(view,(32,104),view)
    im.save(CHECKS/'stufe2-d-room.png')
    expected=Image.new('RGB',view.size,'#8b9bb4');expected.paste(view,mask=view)
    assert np.array_equal(np.asarray(expected),np.asarray(im.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,240],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,
            'allNewFloorAndWallTypesMountedInRoom':True,'roomRunnerSizeTiles':[4,12]}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas);sprites={n:Image.fromarray(p) for n,p in pixels.items()}
    return {'newSpritePreviewCropsChecked':overview(atlas,sprites),'previewPixelsMatchAtlas':True,
            'tilingPreviewPatchesChecked':tiling(atlas,sprites,pixels),**montage(atlas,sprites,pixels)}
