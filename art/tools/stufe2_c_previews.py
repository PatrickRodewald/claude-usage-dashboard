"""Exact 3x sprite sheet, furnished room and animation proof for package C."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import prepare_stufe2_c as kit
import prepare_characters as chars

ROOT=Path(__file__).resolve().parents[2]
CHECKS=ROOT/'art/checks'

def large(image):return image.resize((image.width*3,image.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    image=Image.new('RGB',(1120,876),'#181425');draw=ImageDraw.Draw(image);font=kit.furniture.font
    draw.text((32,24),'Pixel-Büro · Stufe 2 · Paket C',font=font(26,True),fill='#ffffff')
    draw.text((32,66),'Lounge und Küche · alle 14 neuen Sprites exakt 3× · neutraler Grund',font=font(14),fill='#c0cbdc')
    checked=0
    for i,name in enumerate(kit.SPECS):
        x=32+(i%4)*264;y=104+(i//4)*176;width=244
        draw.rounded_rectangle((x,y,x+width,y+158),radius=5,fill='#3a4466')
        draw.rectangle((x+8,y+6,x+width-8,y+109),fill='#8b9bb4')
        sprite=large(sprites[name]);px=x+(width-sprite.width)//2;py=y+106-sprite.height
        image.paste(sprite,(px,py),sprite)
        entry=atlas['sprites'][name]
        draw.text((x+10,y+119),name,font=font(13,True),fill='#ffffff')
        kind='Theke' if entry['placement']=='counter' else f"Boden {entry['footprintTiles'][0]}×{entry['footprintTiles'][1]}"
        draw.text((x+10,y+139),f"{entry['width']} × {entry['height']} px · {kind}",font=font(11),fill='#c0cbdc')
        flat=Image.new('RGB',sprite.size,'#8b9bb4');flat.paste(sprite,mask=sprite)
        assert np.array_equal(np.asarray(flat),np.asarray(image.crop((px,py,px+sprite.width,py+sprite.height)))),name
        checked+=1
    draw.text((570,655),'10 neue Einrichtungsobjekte',font=font(21,True),fill='#ffffff')
    draw.text((570,696),'vending-glow · 2 Bilder · 600 ms · Schleife',font=font(14),fill='#c0cbdc')
    draw.text((570,724),'kicker-play · 4 Bilder · 150 ms · Schleife',font=font(14),fill='#c0cbdc')
    draw.text((32,838),'ENDESGA 32 · Alpha 0/255 · Sitz- und Stehplätze im Atlas · Atlasformat 2',font=font(13),fill='#c0cbdc')
    image.save(CHECKS/'stufe2-c-sprites.png')
    return checked

def room_scene(atlas,sprites):
    scene=Image.new('RGBA',(384,224))
    def put(name,x,y,image=None):scene.alpha_composite(image if image is not None else sprites[name],(x,y))
    for y in range(32,208,16):
        for x in range(16,368,16):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    for row in range(6):
        for col in range(8):
            v='top' if row==0 else 'bottom' if row==5 else ''
            h='left' if col==0 else 'right' if col==7 else ''
            put('rug-'+(v+'-'+h if v and h else v or h or 'center'),32+col*16,64+row*16)
    for x in range(16,368,16):put('wall-plain',x,0)
    put('door-wood-closed',16,0)
    put('wall-outer-corner',12,0);put('wall-outer-corner',356,0,ImageOps.mirror(sprites['wall-outer-corner']))
    for y in range(16,208,16):
        put('wall-side-cap',12,y);put('wall-side-cap',356,y,ImageOps.mirror(sprites['wall-side-cap']))
    for name,x in [('window-day',48),('picture-landscape',88),('picture-abstract',112),
                   ('wall-shelf',144),('whiteboard',184),('window-day',248),('calendar',288),('wall-clock',320)]:
        put(name,x,atlas['sprites'][name]['wallY'])
    objects=[('bookshelf',16,32),('bookshelf-low',128,40),
             ('sofa',48,72),('armchair',112,80),('coffee-table',64,112),
             ('filing-cabinet',16,96),('plant-tall',32,168),('plant-bush',128,160),('plant-palm',336,160),
             ('stool',232,112),('kitchen-table',248,96),('vending-0',312,96),('coat-rack',336,80)]
    layers=[]
    for name,x,y in objects:layers.append((y+sprites[name].height,lambda n=name,x=x,y=y:put(n,x,y)))
    def kitchen():
        put('counter-sink',224,48);put('kitchen-counter',272,48)
        put('microwave',276,40);put('fruit-bowl',300,48);put('fridge',336,40)
    layers.append((72,kitchen))
    # Only existing standing poses are used. Sofa/kicker character poses arrive in F.
    for look,dx,mirror in [('look-01',-8,False),('look-02',56,True)]:
        person=sprites[look+'-right']
        if look=='look-02':person=Image.fromarray(chars.recolor(np.asarray(person),chars.GREEN))
        if mirror:person=ImageOps.mirror(person)
        origin=(208+dx-8,184-32)
        layers.append((184,lambda p=person,o=origin:scene.alpha_composite(p,o)))
    layers.append((185,lambda:put('kicker-1',208,160)))
    for _,paint in sorted(layers,key=lambda item:item[0]):paint()
    return scene

def montage(atlas,sprites):
    view=large(room_scene(atlas,sprites))
    image=Image.new('RGB',(1216,810),'#181425');draw=ImageDraw.Draw(image);font=kit.furniture.font
    draw.text((32,22),'Pixel-Büro · Lounge und Küche im Raum',font=font(26,True),fill='#ffffff')
    draw.text((32,64),'Alle zehn neuen Objekttypen · ergänzt um A, B1 und vorhandene Möbel · Ansicht 3×',font=font(14),fill='#c0cbdc')
    draw.rectangle((28,100,1187,779),fill='#8b9bb4');image.paste(view,(32,104),view)
    image.save(CHECKS/'stufe2-c-room.png')
    expected=Image.new('RGB',view.size,'#8b9bb4');expected.paste(view,mask=view)
    assert np.array_equal(np.asarray(expected),np.asarray(image.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,224],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,'newObjectTypesMountedInRoom':10}

def animated(sprites):
    font=kit.furniture.font;frames=[]
    for i in range(8):
        image=Image.new('RGB',(640,260),'#8b9bb4');draw=ImageDraw.Draw(image)
        draw.rectangle((0,0,639,53),fill='#181425')
        draw.text((24,17),'Paket C · Animationen exakt 3×',font=font(18,True),fill='#ffffff')
        for name,x,y in [(f'vending-{i//4}',110,80),(f'kicker-{i%4}',304,104)]:
            sprite=large(sprites[name]);image.paste(sprite,(x,y),sprite)
        draw.text((48,212),'vending-glow · 600 ms',font=font(14,True),fill='#181425')
        draw.text((284,212),'kicker-play · 150 ms',font=font(14,True),fill='#181425')
        frames.append(image)
    frames[0].save(CHECKS/'stufe2-c-animation.gif',save_all=True,append_images=frames[1:],duration=150,loop=0,disposal=2,optimize=False)
    proof=Image.open(CHECKS/'stufe2-c-animation.gif');assert proof.n_frames==8
    for i in range(8):
        proof.seek(i);assert proof.info['duration']==150
        actual=proof.convert('RGB')
        for name,x,y in [(f'vending-{i//4}',110,80),(f'kicker-{i%4}',304,104)]:
            sprite=large(sprites[name]);expected=Image.new('RGB',sprite.size,'#8b9bb4');expected.paste(sprite,mask=sprite)
            assert np.array_equal(np.asarray(expected),np.asarray(actual.crop((x,y,x+sprite.width,y+sprite.height)))),(i,name,'GIF changed native colors')
    return {'animationPreviewFrames':8,'animationPreviewScale':3,'animationPreviewCycleMs':1200,'animationPreviewPixelsMatchAtlas':True}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas);sprites={name:Image.fromarray(p) for name,p in pixels.items()}
    return {'newSpritePreviewCropsChecked':overview(atlas,sprites),'previewPixelsMatchAtlas':True,
            **montage(atlas,sprites),**animated(sprites)}
