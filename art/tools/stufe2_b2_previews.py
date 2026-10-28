"""Exact 3x contact sheet, furnished room and accurate animation timing proof."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import prepare_stufe2_b2 as kit
from stufe2_c_previews import room_scene as previous_room

ROOT=Path(__file__).resolve().parents[2]
CHECKS=ROOT/'art/checks'

def large(im):return im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    im=Image.new('RGB',(1120,876),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,24),'Pixel-Büro · Stufe 2 · Paket B2',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Technik und Kleinkram · alle 14 neuen Sprites exakt 3× · neutraler Grund',font=font(14),fill='#c0cbdc')
    checked=0
    for i,name in enumerate(kit.SPECS):
        x=32+(i%4)*264;y=104+(i//4)*176;width=244
        d.rounded_rectangle((x,y,x+width,y+158),radius=5,fill='#3a4466')
        d.rectangle((x+8,y+6,x+width-8,y+109),fill='#8b9bb4')
        sprite=large(sprites[name]);px=x+(width-sprite.width)//2;py=y+106-sprite.height
        im.paste(sprite,(px,py),sprite);entry=atlas['sprites'][name]
        d.text((x+10,y+119),name,font=font(13,True),fill='#ffffff')
        kind='begehbar' if not entry['blocksMovement'] else 'Boden 1×1'
        d.text((x+10,y+139),f"{entry['width']} × {entry['height']} px · {kind}",font=font(11),fill='#c0cbdc')
        flat=Image.new('RGB',sprite.size,'#8b9bb4');flat.paste(sprite,mask=sprite)
        assert np.array_equal(np.asarray(flat),np.asarray(im.crop((px,py,px+sprite.width,py+sprite.height)))),name
        checked+=1
    d.text((570,655),'Drucker, Server und kleine Details',font=font(20,True),fill='#ffffff')
    d.text((570,696),'printer-print · 4 Bilder · 200 ms · einmal',font=font(14),fill='#c0cbdc')
    d.text((570,724),'server-blink · 4 Bilder · 180 ms · Schleife',font=font(14),fill='#c0cbdc')
    d.text((570,752),'Gleiche Lampenform · begehbare Fußmatte',font=font(14),fill='#c0cbdc')
    d.text((32,838),'ENDESGA 32 · Alpha 0/255 · unveränderte Gehäuse · Atlasformat 2',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-b2-sprites.png');return checked

def montage(atlas,sprites):
    scene=previous_room(atlas,sprites)
    def put(name,x,y):scene.alpha_composite(sprites[name],(x,y))
    # Free the entrance beneath the door and move the old bookcase beside it.
    for y in (32,48):
        for x in (16,32):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    put('bookshelf',48,32)
    objects=[('doormat',16,32),('printer-3',176,40),('server-2',200,32),
             ('floor-lamp-off',32,72),('floor-lamp-on',144,80),
             ('trash-bin',184,80),('trash-bin-full',336,128),('beanbag',112,128)]
    for name,x,y in sorted(objects,key=lambda v:v[2]+sprites[v[0]].height):put(name,x,y)
    view=large(scene);im=Image.new('RGB',(1216,810),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,22),'Pixel-Büro · Technik und Kleinkram im Raum',font=font(26,True),fill='#ffffff')
    d.text((32,64),'Drucker und Server an der Wand · Lampen an/aus · zwei Mülleimer · Sitzsack · Fußmatte · Ansicht 3×',font=font(13),fill='#c0cbdc')
    d.rectangle((28,100,1187,779),fill='#8b9bb4');im.paste(view,(32,104),view)
    im.save(CHECKS/'stufe2-b2-room.png')
    flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
    assert np.array_equal(np.asarray(flat),np.asarray(im.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,224],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,'newObjectExamplesMountedInRoom':len(objects)}

def animated(sprites):
    # 3600ms covers five exact server cycles. The printer plays once and holds.
    times=sorted(set(range(0,3600,180))|{200,400,600})
    durations=[b-a for a,b in zip(times,times[1:]+[3600])]
    frames=[];font=kit.furniture.font
    for t in times:
        im=Image.new('RGB',(640,260),'#8b9bb4');d=ImageDraw.Draw(im)
        d.rectangle((0,0,639,53),fill='#181425')
        d.text((24,17),'Paket B2 · Animationen exakt 3×',font=font(18,True),fill='#ffffff')
        items=[(kit.PRINTER_NAMES[min(t//200,3)],118,104),(f'server-{(t//180)%4}',390,80)]
        for name,x,y in items:
            sprite=large(sprites[name]);im.paste(sprite,(x,y),sprite)
        d.text((52,212),'printer-print · 200 ms · einmal',font=font(13,True),fill='#181425')
        d.text((342,212),'server-blink · 180 ms',font=font(13,True),fill='#181425')
        frames.append(im)
    frames[0].save(CHECKS/'stufe2-b2-animation.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=False)
    proof=Image.open(CHECKS/'stufe2-b2-animation.gif');assert proof.n_frames==len(times)
    for i,t in enumerate(times):
        proof.seek(i);assert proof.info['duration']==durations[i]
        actual=proof.convert('RGB')
        for name,x,y in [(kit.PRINTER_NAMES[min(t//200,3)],118,104),(f'server-{(t//180)%4}',390,80)]:
            sprite=large(sprites[name]);expected=Image.new('RGB',sprite.size,'#8b9bb4');expected.paste(sprite,mask=sprite)
            assert np.array_equal(np.asarray(expected),np.asarray(actual.crop((x,y,x+sprite.width,y+sprite.height)))),(i,name,'GIF pixel mismatch')
    return {'animationPreviewFrames':len(times),'animationPreviewScale':3,'animationPreviewCycleMs':3600,
            'animationPreviewPixelsMatchAtlas':True,'animationPreviewTimingMs':durations,
            'printerPreviewBehaviour':'one shot then hold; demonstration GIF retriggers on its next cycle'}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas);sprites={n:Image.fromarray(p) for n,p in pixels.items()}
    return {'newSpritePreviewCropsChecked':overview(atlas,sprites),'previewPixelsMatchAtlas':True,
            **montage(atlas,sprites),**animated(sprites)}
