"""Verify every new frame at exactly 3x and demonstrate separate work props."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import prepare_stufe2_e as kit
import animation_previews as old

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
CHECKS=ROOT/'art/checks'
LABELS=['Gehen · vorn','Gehen · hinten','Gehen · rechts','Atmen','Tippen','Lesen','Schreiben','Denken']
BG='#8b9bb4'

def large(image):return image.resize((image.width*3,image.height*3),Image.Resampling.NEAREST)

def put_proof(canvas,image,position,background=BG):
    canvas.paste(image,position,image);x,y=position
    flat=Image.new('RGB',image.size,background);flat.paste(image,mask=image)
    assert np.array_equal(np.asarray(flat),np.asarray(canvas.crop((x,y,x+image.width,y+image.height))))

def overview(atlas,sprites):
    im=Image.new('RGB',(1152,1408),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;count=0
    d.text((32,24),'Pixel-Büro · Vier neue Figuren',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Alle 116 neuen Sprites exakt 3× · 16 × 32 px · unveränderte Kleidungsschlüssel',font=font(14),fill='#c0cbdc')
    for c,look in enumerate(kit.LOOKS):
        x=208+c*232;role='Hauptsitzung' if c<2 else 'Subagent'
        d.text((x,110),f'{look} · {role}',font=font(14,True),fill='#ffffff')
    for row in range(9):
        y=150+136*row
        label='Grundansichten' if row==0 else LABELS[row-1]
        d.text((32,y+28),label,font=font(16,True),fill='#ffffff')
        d.text((32,y+54),'3 Ansichten' if row==0 else f'{kit.DURATIONS[row-1]} ms je Bild',font=font(12),fill='#c0cbdc')
        for c,look in enumerate(kit.LOOKS):
            x=208+c*232
            states=[f'{look}-{v}' for v in kit.VIEWS] if row==0 else atlas['animations'][look+'-'+kit.ACTIONS[row-1]]['states']
            d.rectangle((x-8,y-4,x+211,y+99),fill=BG)
            for i,name in enumerate(states):
                pos=(x+i*52,y);view=large(sprites[name]);put_proof(im,view,pos);count+=1
                d.text((pos[0],y+106),kit.VIEWS[i] if row==0 else str(i+1),font=font(10),fill='#c0cbdc')
    d.text((32,1380),'Arbeitsbilder enthalten den Stuhl. Laptop, Buch und Notizblock sind separate Atlas-Props.',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-e-sprites.png');assert count==116;return count

def recolors(atlas):
    im=Image.new('RGB',(1120,880),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;checked=0
    d.text((32,24),'Pixel-Büro · Identität und Farbwechsel',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Alle Grundansichten exakt 3× · Haare, Haut, Brille, Kopfhörer und Spange bleiben erhalten',font=font(13),fill='#c0cbdc')
    for x,label in [(224,'Original'),(448,'Grün'),(672,'Rot'),(896,'Kleidungsmaske')]:d.text((x,110),label,font=font(15,True),fill='#ffffff')
    descriptions=['Pferdeschwanz · Blazer','Rote Haare · Brille · Weste','Lila Haare · Kopfhörer','Blonder Bob · Haarspange']
    for r,look in enumerate(kit.LOOKS):
        y=158+r*170;d.text((32,y+20),look,font=font(18,True),fill='#ffffff');d.text((32,y+51),descriptions[r],font=font(12),fill='#c0cbdc')
        a=np.asarray(Image.open(OUT/f'characters/{look}/sheet.png').convert('RGBA'))
        mask=Image.open(OUT/f'characters/{look}/recolor-mask.png').convert('RGBA')
        for x,p in [(224,Image.fromarray(a)),(448,Image.fromarray(kit.chars.recolor(a,kit.chars.GREEN))),
                    (672,Image.fromarray(kit.chars.recolor(a,kit.chars.RED))),(896,mask)]:
            view=large(p);d.rectangle((x-8,y-4,x+151,y+99),fill=BG);put_proof(im,view,(x,y));checked+=1
    d.text((32,846),'Hauptsitzung: look-03 / look-04 · Subagent: look-05 / look-06',font=font(14),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-e-looks.png');return checked

def animated(atlas,sprites):
    end=4200;times=sorted(set().union(*(range(0,end,d) for d in kit.DURATIONS)))
    durations=[b-a for a,b in zip(times,times[1:]+[end])];frames=[];checks=[];seen=set();font=kit.furniture.font
    for t in times:
        im=Image.new('RGB',(1080,820),'#181425');d=ImageDraw.Draw(im);regions=[]
        d.text((32,22),'Pixel-Büro · 32 neue Animationen',font=font(26,True),fill='#ffffff')
        d.text((32,64),'Alle vier Looks · exakt 3× · echte Bilddauern · Props unter den Händen',font=font(14),fill='#c0cbdc')
        for c,label in enumerate(LABELS):d.text((48+c*128,106),label,font=font(13),fill='#c0cbdc')
        for r,look in enumerate(kit.LOOKS):
            y=170+r*158;d.text((32,y-28),look,font=font(15,True),fill='#ffffff')
            for c,action in enumerate(kit.ACTIONS):
                a=atlas['animations'][look+'-'+action];index=(t//a['frameDurationMs'])%a['frames'];seen.add((look,action,index))
                view=large(old.composite(atlas,sprites,a,index));x=48+c*128
                d.rectangle((x-8,y-4,x+55,y+99),fill=BG);im.paste(view,(x,y),view);regions.append((view,(x,y),BG))
        d.text((32,798),'Gleiche Köpfe beim Gehen · echte Beinsilhouetten · feste Sitzfüße und Stuhlbasis',font=font(13),fill='#c0cbdc')
        frames.append(im.quantize(palette=old.palette_image(),dither=Image.Dither.NONE));checks.append(regions)
    path=CHECKS/'stufe2-e-animation.gif'
    frames[0].save(path,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=False)
    old.check_gif(path,checks);proof=Image.open(path)
    for i,duration in enumerate(durations):proof.seek(i);assert proof.info['duration']==duration
    assert len(seen)==104
    return {'animationPreviewFrames':len(times),'animationPreviewCycleMs':end,'animationPreviewExactTimings':'passed',
            'animationPreviewPixelsMatchAtlas':True,'animationStatesShown':len(seen),'animationPreviewScale':3}

def room_scene(atlas,sprites,poses=None):
    scene=Image.new('RGBA',(384,224));seen=[]
    def put(name,x,y,image=None):scene.alpha_composite(sprites[name] if image is None else image,(x,y))
    for y in range(32,208,16):
        for x in range(16,368,16):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    for x in range(16,368,16):put('wall-plain',x,0)
    for y in range(16,208,16):put('wall-side-cap',12,y);put('wall-side-cap',356,y,ImageOps.mirror(sprites['wall-side-cap']))
    put('wall-outer-corner',12,0);put('wall-outer-corner',356,0,ImageOps.mirror(sprites['wall-outer-corner']))
    for name,x in [('window-day',24),('whiteboard',72),('wall-clock',136),('corkboard',168),('window-day',224),('wall-shelf',288)]:put(name,x,atlas['sprites'][name]['wallY'])
    put('server-2',336,32);put('door-wood-closed',16,112)
    for r in range(4):
        for c in range(18):
            v='top' if r==0 else 'bottom' if r==3 else '';h='left' if c==0 else 'right' if c==17 else ''
            put('rug-'+(v+'-'+h if v and h else v or h or 'center'),40+c*16,132+r*16)
    poses=poses or [('type',0),('read',1),('write',2),('think',2)]
    for look,x,(action,index) in zip(kit.LOOKS,[16,104,192,280],poses):
        a=atlas['animations'][f'{look}-{action}'];origin=(x+16,56)
        person=sprites[a['states'][index]];scene.alpha_composite(person,origin)
        put('desk-large',x,72);put('lamp-on',x+1,67);put('plant-desk',x+36,68)
        prop=old.prop_sprite(atlas,sprites,a,index)
        if prop is not None:
            mx,my=a['prop']['mount'];scene.alpha_composite(prop,(origin[0]+mx,origin[1]+my))
        hands=old.foreground(atlas,a,index);scene.alpha_composite(hands,origin)
        p=np.asarray(scene)[origin[1]:origin[1]+32,origin[0]:origin[0]+16];fg=np.asarray(hands);mask=fg[:,:,3]==255
        assert np.array_equal(p[mask],fg[mask]),(look,action,index,'hands hidden by desk/prop')
        seen.append((look,action,index))
    for look,action,index,x,y in [('look-01','walk-right',2,56,112),('look-02','walk-front',1,328,160),
        ('look-03','walk-back',1,96,132),('look-04','walk-right',2,152,144),('look-05','walk-front',1,224,132),('look-06','idle',1,280,148)]:
        a=atlas['animations'][f'{look}-{action}'];put(a['states'][index],x,y)
    put('plant-palm',336,172);put('plant-tall',24,176);put('coffee-table',136,184)
    return scene,seen

def montage(atlas,sprites):
    tested=set()
    for action in kit.WORK:
        for index in range(3):
            _,seen=room_scene(atlas,sprites,[(action,index)]*4);tested.update(seen)
    assert len(tested)==48
    scene,_=room_scene(atlas,sprites);view=large(scene);im=Image.new('RGB',(1216,814),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,22),'Pixel-Büro · Das erweiterte Team',font=font(26,True),fill='#ffffff')
    d.text((32,64),'Vier neue Looks am Tisch und im Raum · die bisherigen beiden Looks bleiben enthalten · exakt 3×',font=font(13),fill='#c0cbdc')
    d.rectangle((28,100,1187,779),fill=BG);put_proof(im,view,(32,104))
    d.text((32,790),'Posenmontage · Figur/Stuhl → Tisch → Prop → Hände · Raum und Figuren aus dem gelieferten Atlas',font=font(12),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-e-room.png')
    return {'roomNativeSize':[384,224],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,
            'workForegroundCompositesChecked':len(tested),'allSixLooksMountedInRoom':True}

def build(atlas):
    _,pixels=kit.room.read_sprites(atlas);sprites={k:Image.fromarray(p) for k,p in pixels.items()};CHECKS.mkdir(parents=True,exist_ok=True)
    result={'spritePreviewFrames':overview(atlas,sprites),'recolorPreviewPanels':recolors(atlas),'staticPreviewScale':3}
    result.update(animated(atlas,sprites));result.update(montage(atlas,sprites));return result
