"""Exact 3x effect sheet, timed playback proof and anchored room overlays."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import prepare_stufe2_g as kit
import animation_previews as base_preview
from stufe2_f_previews import room_scene as previous_room

ROOT=Path(__file__).resolve().parents[2]
CHECKS=ROOT/'art/checks'

def large(im):return im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    im=Image.new('RGB',(1120,900),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;checked=0
    d.text((32,24),'Pixel-Büro · Stufe 2 · Paket G',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Alle 21 neuen Effektsprites exakt 3× · 8 × 8 bzw. 16 × 16 px · neutraler Grund',font=font(14),fill='#c0cbdc')
    names=list(kit.SPECS);rows=[names[:6],names[6:12],names[12:15],names[15:18],names[18:21]]
    for row,items in enumerate(rows):
        y=104+row*148
        for col,name in enumerate(items):
            x=32+col*176;d.rounded_rectangle((x,y,x+164,y+128),radius=5,fill='#3a4466')
            d.rectangle((x+8,y+6,x+156,y+84),fill='#8b9bb4')
            view=large(sprites[name]);px=x+(164-view.width)//2;py=y+80-view.height;im.paste(view,(px,py),view)
            e=atlas['sprites'][name];d.text((x+10,y+92),name,font=font(12,True),fill='#ffffff')
            d.text((x+10,y+112),f"{e['width']} × {e['height']} px",font=font(11),fill='#c0cbdc')
            flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
            assert np.array_equal(np.asarray(flat),np.asarray(im.crop((px,py,px+view.width,py+view.height)))),name
            checked+=1
    for y,title,line in [(418,'Funkeln · 120 ms · Schleife','Wächst und schrumpft um denselben Mittelpunkt.'),
                         (566,'Staub · 100 ms · einmal','Kleine Wolke, große Wolke, zwei verbleibende Pixel.'),
                         (714,'Papier · 150 ms · Schleife','Vorderseite, gedreht und auf der Kante.')]:
        d.text((568,y),title,font=font(21,True),fill='#ffffff');d.text((568,y+38),line,font=font(13),fill='#c0cbdc')
    d.text((32,862),'ENDESGA 32 · Alpha 0/255 · freie Einblendungen ohne Kollision · Ansicht 3×',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-g-sprites.png');return checked

def animated(atlas,sprites):
    labels=[('plane-right','Rechts'),('plane-right','Links gespiegelt'),('plane-up','Nach oben'),('plane-down','Nach unten'),
            ('confetti','Konfetti'),('sparkle','Funkeln'),('dust','Staub'),('paper','Papier')]
    times=set(range(0,3600,120))|set(range(0,3600,150))
    for start in (0,1200,2400):
        for action in ('confetti','dust'):
            a=atlas['animations'][action]
            times|={start+i*a['frameDurationMs'] for i in range(a['frames']+1) if start+i*a['frameDurationMs']<3600}
    times=sorted(times);durations=[b-a for a,b in zip(times,times[1:]+[3600])]
    frames=[];checks=[];seen=set();font=kit.furniture.font
    for t in times:
        im=Image.new('RGB',(768,440),'#181425');d=ImageDraw.Draw(im);regions=[]
        d.text((32,22),'Paket G · Effekte in Bewegung',font=font(25,True),fill='#ffffff')
        d.text((32,62),'Ansicht 3× · kurze Effekte werden für die Vorschau neu ausgelöst',font=font(13),fill='#c0cbdc')
        for i,(action,label) in enumerate(labels):
            x=32+(i%4)*176;y=104+(i//4)*148;a=atlas['animations'][action]
            d.rounded_rectangle((x,y,x+160,y+128),radius=5,fill='#3a4466')
            d.text((x+10,y+8),label,font=font(13,True),fill='#ffffff')
            d.rectangle((x+8,y+32,x+152,y+108),fill='#8b9bb4')
            elapsed=t if a['loop'] else t%1200
            active=a['loop'] or elapsed<a['frames']*a['frameDurationMs']
            if active:
                key=a['states'][(elapsed//a['frameDurationMs'])%a['frames']];view=sprites[key]
                if i==1:view=ImageOps.mirror(view)
                seen.add(key)
            else:view=Image.new('RGBA',(a['width'],a['height']))
            view=large(view);anchor=a['anchor'];px=x+80-anchor[0]*3;py=y+80-anchor[1]*3
            im.paste(view,(px,py),view);regions.append((view,(px,py),'#8b9bb4'))
            d.text((x+10,y+114),f"{a['frameDurationMs']} ms · "+('Schleife' if a['loop'] else 'einmal'),font=font(11),fill='#c0cbdc')
        d.text((32,412),'Konfetti und Staub verschwinden nach dem letzten Bild. Flugwege setzt der aufrufende Code.',font=font(11),fill='#c0cbdc')
        frames.append(im.quantize(palette=base_preview.palette_image(),dither=Image.Dither.NONE));checks.append(regions)
    assert seen==set(kit.SPECS)
    path=CHECKS/'stufe2-g-animation.gif';frames[0].save(path,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=False)
    base_preview.check_gif(path,checks);proof=Image.open(path)
    for i,duration in enumerate(durations):proof.seek(i);assert proof.info['duration']==duration
    return {'animationPreviewFrames':len(times),'animationPreviewScale':3,'animationPreviewCycleMs':3600,
            'animationPreviewExactTimings':'passed','animationPreviewPixelsMatchAtlas':True,
            'all21StatesSeenInAnimationPreview':True,'oneShotEffectsHiddenAfterPlayback':True,'previewRetriggerIntervalMs':1200}

def montage(atlas,sprites):
    scene=previous_room(atlas,sprites,900,set())
    walking=atlas['animations']['look-01-walk-right'];person=sprites[walking['states'][1]];scene.alpha_composite(person,(168,168))
    mounts=[('plane-right-0',(161,51),False),('plane-right-1',(250,52),True),('plane-up-1',(178,39),False),
            ('plane-down-0',(176,80),False),('confetti-1',(112,91),False),('sparkle-1',(305,104),False),
            ('dust-1',(164,201),False),('paper-1',(256,126),False)]
    for key,(cx,cy),flip in mounts:
        e=atlas['sprites'][key];view=sprites[key]
        if flip:view=ImageOps.mirror(view)
        x,y=cx-e['anchor'][0],cy-e['anchor'][1];scene.alpha_composite(view,(x,y))
        actual=np.asarray(scene)[y:y+view.height,x:x+view.width];p=np.asarray(view);mask=p[:,:,3]==255
        assert np.array_equal(actual[mask],p[mask]),key
    view=large(scene);im=Image.new('RGB',(1216,810),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,22),'Pixel-Büro · Effekte im Raum',font=font(26,True),fill='#ffffff')
    d.text((32,64),'Papierflieger in vier Richtungen · Konfetti · Funkeln · Staub beim Gehen · fliegendes Papier · Ansicht 3×',font=font(12),fill='#c0cbdc')
    d.rectangle((28,100,1187,779),fill='#8b9bb4');im.paste(view,(32,104),view)
    d.text((32,788),'Effektmontage auf den vorhandenen Figuren und Möbeln; der Flug nach links nutzt die gespiegelte Rechtsansicht.',font=font(11),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-g-room.png')
    flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
    assert np.array_equal(np.asarray(flat),np.asarray(im.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,224],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,
            'effectMountsChecked':len(mounts),'all7EffectAnimationsMountedInRoom':True,'leftFlightFromMirroredRightMounted':True}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas);sprites={n:Image.fromarray(p) for n,p in pixels.items()}
    return {'newSpritePreviewCropsChecked':overview(atlas,sprites),'previewPixelsMatchAtlas':True,
            **animated(atlas,sprites),**montage(atlas,sprites)}
