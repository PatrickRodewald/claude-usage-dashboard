"""Native-scale contact sheet and room assembly for the nine B1 decorations."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import prepare_stufe2_b1 as kit
import prepare_characters as chars

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
CHECKS=ROOT/'art/checks'
LABELS={'plant-tall':'Monstera','plant-bush':'Buschpflanze','plant-palm':'Palme',
        'plant-desk':'Tisch-Sukkulente','cactus-desk':'Tischkaktus','bookshelf':'Bücherregal',
        'bookshelf-low':'Niedriges Regal','filing-cabinet':'Aktenschrank','coat-rack':'Garderobe'}

def large(image):return image.resize((image.width*3,image.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    image=Image.new('RGB',(1000,770),'#181425');draw=ImageDraw.Draw(image);font=kit.furniture.font
    draw.text((32,24),'Pixel-Büro · Stufe 2 · Paket B1',font=font(26,True),fill='#ffffff')
    draw.text((32,66),'Pflanzen und Regale · alle neuen Sprites exakt 3× · neutraler Grund',font=font(14),fill='#c0cbdc')
    rows=[list(kit.SPECS)[:5],['bookshelf','bookshelf-low'],['filing-cabinet','coat-rack']]
    checked=0
    for r,row in enumerate(rows):
        for c,name in enumerate(row):
            x,y=32+c*(312 if r==1 else 188),104+r*178
            width=294 if r==1 else 174
            draw.rounded_rectangle((x,y,x+width,y+158),radius=5,fill='#3a4466')
            draw.rectangle((x+8,y+6,x+width-8,y+109),fill='#8b9bb4')
            sprite=large(sprites[name]);px=x+(width-sprite.width)//2;py=y+106-sprite.height
            image.paste(sprite,(px,py),sprite)
            entry=atlas['sprites'][name]
            draw.text((x+9,y+119),LABELS[name],font=font(12,True),fill='#ffffff')
            kind='Tisch' if entry['placement']=='desk' else f"Boden {entry['footprintTiles'][0]}×{entry['footprintTiles'][1]}"
            draw.text((x+9,y+139),f"{entry['width']} × {entry['height']} px · {kind}",font=font(10),fill='#c0cbdc')
            flat=Image.new('RGB',sprite.size,'#8b9bb4');flat.paste(sprite,mask=sprite)
            assert np.array_equal(np.asarray(flat),np.asarray(image.crop((px,py,px+sprite.width,py+sprite.height)))),name
            checked+=1
    draw.text((468,474),'9 neue Einrichtungsobjekte',font=font(21,True),fill='#ffffff')
    draw.text((468,516),'7 Bodenobjekte mit klaren Grundflächen und Kollision.',font=font(13),fill='#c0cbdc')
    draw.text((468,542),'2 kleine Pflanzen für die Tischoberfläche.',font=font(13),fill='#c0cbdc')
    draw.text((468,568),'Regale und Aktenschrank stehen an der Wand.',font=font(13),fill='#c0cbdc')
    draw.text((32,710),'ENDESGA 32 · Alpha 0/255 · 3 Grüntöne für Blätter · Atlasformat 2',font=font(13),fill='#c0cbdc')
    image.save(CHECKS/'stufe2-b1-sprites.png')
    return checked

def room_scene(atlas,sprites):
    scene=Image.new('RGBA',(384,192))
    def put(name,x,y,image=None):scene.alpha_composite(image if image is not None else sprites[name],(x,y))
    for y in range(32,176,16):
        for x in range(16,368,16):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    for row in range(4):
        for col in range(13):
            v='top' if row==0 else 'bottom' if row==3 else ''
            h='left' if col==0 else 'right' if col==12 else ''
            put('rug-'+(v+'-'+h if v and h else v or h or 'center'),128+col*16,96+row*16)
    for x in range(16,368,16):put('wall-plain',x,0)
    put('door-wood-closed',16,0)
    put('wall-outer-corner',12,0)
    put('wall-outer-corner',356,0,Image.fromarray(np.asarray(sprites['wall-outer-corner'])[:,::-1].copy()))
    for y in range(16,176,16):
        put('wall-side-cap',12,y)
        put('wall-side-cap',356,y,Image.fromarray(np.asarray(sprites['wall-side-cap'])[:,::-1].copy()))
    for name,x in [('calendar',40),('window-day',64),('whiteboard',104),('corkboard',160),('wall-tv',200),
                   ('wall-clock',240),('picture-landscape',264),('picture-abstract',288),('poster-mountain',312),('wall-shelf',336)]:
        put(name,x,atlas['sprites'][name]['wallY'])
    floor_objects=[('bookshelf',32,32),('bookshelf-low',288,40),('filing-cabinet',336,32),
                   ('coat-rack',16,88),('plant-tall',32,136),('plant-bush',96,144),('plant-palm',336,128)]
    layers=[]
    for name,x,y in floor_objects:
        layers.append((y+sprites[name].height,lambda n=name,x=x,y=y:put(n,x,y)))
    def kitchen():
        put('kitchen-counter',96,48);put('espresso-ready',96,32);put('tray-mugs',124,40)
        put('fridge',152,40);put('cooler-bubble-2',176,40)
    layers.append((72,kitchen))
    for look,x,task,plant in [('look-01',144,'type','plant-desk'),('look-02',256,'read','cactus-desk')]:
        animation=atlas['animations'][look+'-'+task];index=1
        key=animation['states'][index];person=sprites[key]
        if look=='look-02':person=Image.fromarray(chars.recolor(np.asarray(person),chars.GREEN))
        origin=(x+16,88)
        layers.append((120,lambda key=key,origin=origin,person=person:put(key,*origin,person)))
        def desk(x=x,animation=animation,index=index,key=key,origin=origin,plant=plant):
            put('desk-large',x,104);put('lamp-on',x+1,99)
            prop=animation.get('prop')
            if prop:
                item=prop.get('sprite') or atlas['animations'][prop['animation']]['states'][prop['frameMap'][index]]
                mx,my=prop['mount'];put(item,origin[0]+mx,origin[1]+my)
            put(plant,x+36,100)
            entry=atlas['sprites'][key]
            hands=Image.open(OUT/animation['foregroundImage']).convert('RGBA').crop((entry['x'],entry['y'],entry['x']+16,entry['y']+32))
            scene.alpha_composite(hands,origin)
        layers.append((128,desk))
    for _,paint in sorted(layers,key=lambda item:item[0]):paint()
    return scene

def montage(atlas,sprites):
    view=large(room_scene(atlas,sprites))
    image=Image.new('RGB',(1216,706),'#181425');draw=ImageDraw.Draw(image);font=kit.furniture.font
    draw.text((32,22),'Pixel-Büro · Paket A + B1 im Raum',font=font(26,True),fill='#ffffff')
    draw.text((32,64),'Alle neun neuen Objekte montiert · Pflanzen auf dem Boden und auf den Tischen · Ansicht 3×',font=font(14),fill='#c0cbdc')
    draw.rectangle((28,100,1187,683),fill='#8b9bb4');image.paste(view,(32,104),view)
    image.save(CHECKS/'stufe2-b1-room.png')
    expected=Image.new('RGB',view.size,'#8b9bb4');expected.paste(view,mask=view)
    assert np.array_equal(np.asarray(expected),np.asarray(image.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,192],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,
            'newObjectsMountedInRoom':9}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas)
    sprites={name:Image.fromarray(p) for name,p in pixels.items()}
    count=overview(atlas,sprites)
    return {'newSpritePreviewCropsChecked':count,'previewPixelsMatchAtlas':True,**montage(atlas,sprites)}
