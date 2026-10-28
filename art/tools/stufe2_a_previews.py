"""Render all thirteen wall pieces at exactly 3x and mount them in an office."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import prepare_stufe2_a as kit
import prepare_characters as chars

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
CHECKS=ROOT/'art/checks'
LABELS={
 'window-day':'Fenster · Tag','window-dawn':'Fenster · Morgen','window-dusk':'Fenster · Abend','window-night':'Fenster · Nacht',
 'whiteboard':'Whiteboard','corkboard':'Pinnwand','wall-tv':'Wandfernseher','wall-clock':'Wanduhr',
 'calendar':'Kalender','picture-landscape':'Landschaftsbild','picture-abstract':'Abstraktes Bild',
 'poster-mountain':'Bergposter','wall-shelf':'Wandregal',
}

def large(image):return image.resize((image.width*3,image.height*3),Image.Resampling.NEAREST)

def contact_sheet(atlas,sprites):
    image=Image.new('RGB',(1000,772),'#181425');draw=ImageDraw.Draw(image)
    font=kit.furniture.font
    draw.text((32,24),'Pixel-Büro · Stufe 2 · Paket A',font=font(26,True),fill='#ffffff')
    draw.text((32,66),'Wanddekoration · alle neuen Sprites exakt 3× · neutraler Grund',font=font(14),fill='#c0cbdc')
    rows=[list(kit.SPECS)[:4],list(kit.SPECS)[4:7],list(kit.SPECS)[7:12],['wall-shelf']]
    checks=0
    for r,row in enumerate(rows):
        for i,name in enumerate(row):
            step=234 if r==0 else 312 if r==1 else 188
            x,y=32+i*step,104+r*142
            draw.rounded_rectangle((x,y,x+174,y+126),radius=5,fill='#3a4466')
            sprite=large(sprites[name]);px=x+(174-sprite.width)//2;py=y+9
            # Neutral, uniform matte under each actual sprite crop.
            draw.rectangle((x+8,y+6,x+166,y+85),fill='#8b9bb4')
            image.paste(sprite,(px,py),sprite)
            draw.text((x+9,y+93),LABELS[name],font=font(12,True),fill='#ffffff')
            entry=atlas['sprites'][name]
            draw.text((x+9,y+110),f"{entry['width']} × {entry['height']} px · wallY {entry['wallY']}",font=font(10),fill='#c0cbdc')
            flat=Image.new('RGB',sprite.size,'#8b9bb4');flat.paste(sprite,mask=sprite)
            assert np.array_equal(np.asarray(flat),np.asarray(image.crop((px,py,px+sprite.width,py+sprite.height)))),name
            checks+=1
    draw.text((252,550),'13 neue Wandobjekte',font=font(19,True),fill='#ffffff')
    draw.text((252,586),'Fensterrahmen und Skyline stimmen in allen vier Ansichten überein.',font=font(13),fill='#c0cbdc')
    draw.text((252,611),'Whiteboard und Kalender leer · Uhr ohne Zeiger · Texte kommen aus Code.',font=font(13),fill='#c0cbdc')
    draw.text((32,718),'ENDESGA 32 · Alpha nur 0 oder 255 · Atlasformat 2 · Stufe 1 vollständig erhalten',font=font(13),fill='#c0cbdc')
    path=CHECKS/'stufe2-a-sprites.png';image.save(path)
    return checks

def room_scene(atlas,sprites,window='window-day'):
    scene=Image.new('RGBA',(384,160))
    def put(name,x,y,image=None):scene.alpha_composite(image or sprites[name],(x,y))
    for y in range(32,144,16):
        for x in range(16,368,16):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    for y in range(3):
        for x in range(12):
            row='top' if y==0 else 'bottom' if y==2 else ''
            col='left' if x==0 else 'right' if x==11 else ''
            part=row+'-'+col if row and col else row or col or 'center'
            put('rug-'+part,144+x*16,80+y*16)
    for x in range(16,368,16):put('wall-plain',x,0)
    put('door-wood-closed',16,0)
    put('wall-outer-corner',12,0)
    put('wall-outer-corner',356,0,Image.fromarray(np.asarray(sprites['wall-outer-corner'])[:,::-1].copy()))
    for y in range(16,144,16):
        put('wall-side-cap',12,y)
        put('wall-side-cap',356,y,Image.fromarray(np.asarray(sprites['wall-side-cap'])[:,::-1].copy()))
    mounts=[('calendar',40),(window,64),('whiteboard',104),('corkboard',160),('wall-tv',200),('wall-clock',240),
            ('picture-landscape',264),('picture-abstract',288),('poster-mountain',312),('wall-shelf',336)]
    for name,x in mounts:put(name,x,atlas['sprites'][name]['wallY'])
    put('kitchen-counter',32,56);put('espresso-ready',32,40);put('tray-mugs',60,48)
    put('fridge',88,48);put('cooler-bubble-2',112,48)
    for look,x,task in (('look-01',160,'type'),('look-02',256,'read')):
        animation=atlas['animations'][look+'-'+task];index=1
        key=animation['states'][index];person=sprites[key]
        if look=='look-02':person=Image.fromarray(chars.recolor(np.asarray(person),chars.GREEN))
        origin=(x+16,64);put(key,*origin,person)
        put('desk-large',x,80);put('lamp-on',x+1,75);put('mug-steam-2',x+36,78)
        prop=animation.get('prop')
        if prop:
            item=prop.get('sprite') or atlas['animations'][prop['animation']]['states'][prop['frameMap'][index]]
            mx,my=prop['mount'];put(item,origin[0]+mx,origin[1]+my)
        entry=atlas['sprites'][key]
        hands=Image.open(OUT/animation['foregroundImage']).convert('RGBA').crop((entry['x'],entry['y'],entry['x']+16,entry['y']+32))
        scene.alpha_composite(hands,origin)
    return scene

def montage(atlas,sprites):
    scene=room_scene(atlas,sprites)
    view=large(scene)
    image=Image.new('RGB',(1216,610),'#181425');draw=ImageDraw.Draw(image);font=kit.furniture.font
    draw.text((32,22),'Pixel-Büro · Paket A im Raum',font=font(26,True),fill='#ffffff')
    draw.text((32,64),'Alle Wandobjekte am angegebenen wallY montiert · bestehende Möbel und Figuren · Ansicht 3×',font=font(14),fill='#c0cbdc')
    draw.rectangle((28,100,1187,587),fill='#8b9bb4')
    image.paste(view,(32,104),view)
    path=CHECKS/'stufe2-a-room.png';image.save(path)
    flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
    assert np.array_equal(np.asarray(flat),np.asarray(image.crop((32,104,32+view.width,104+view.height))))
    return {'roomMontageScale':3,'roomNativeSize':[384,160],'roomPreviewPixelsMatchAtlas':True}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,arrays=kit.room.read_sprites(atlas)
    sprites={name:Image.fromarray(pixels) for name,pixels in arrays.items()}
    count=contact_sheet(atlas,sprites)
    result=montage(atlas,sprites)
    return {'newSpritePreviewCropsChecked':count,'previewPixelsMatchAtlas':True,**result}
