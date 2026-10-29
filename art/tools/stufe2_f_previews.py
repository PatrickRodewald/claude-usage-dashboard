"""Exact 3x pose proof, real animation timings, masks and furniture mounting."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import prepare_stufe2_f as kit
import animation_previews as base_preview

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
CHECKS=ROOT/'art/checks'
LABELS={'sleep':'Schlafen','sip':'Tasse am Tisch','cheer':'Jubeln','talk':'Reden','drink':'Trinken','kicker':'Kicker','sofa':'Sofa'}

def large(im):return im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)

def overview(atlas,sprites):
    im=Image.new('RGB',(1120,1170),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;checked=0
    d.text((32,24),'Pixel-Büro · Stufe 2 · Paket F',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Alle 30 neuen Figurenbilder exakt 3× · 16 × 32 px je Bild · neutraler Grund',font=font(14),fill='#c0cbdc')
    for look,x in [('look-01',224),('look-02',728)]:d.text((x,104),look,font=font(17,True),fill='#ffffff')
    for row,(name,count,duration) in enumerate(kit.REST+kit.ACTION):
        y=140+row*140
        d.text((32,y+20),LABELS[name],font=font(17,True),fill='#ffffff')
        d.text((32,y+50),f'{count} Bilder · {duration} ms',font=font(12),fill='#c0cbdc')
        for look,start in [('look-01',216),('look-02',720)]:
            d.rectangle((start-12,y-4,start+264,y+101),fill='#8b9bb4')
            for i,key in enumerate(atlas['animations'][look+'-'+name]['states']):
                view=large(sprites[key]);x=start+i*88;im.paste(view,(x,y),view)
                d.text((x,y+108),f'Bild {i+1}',font=font(11),fill='#c0cbdc')
                flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
                assert np.array_equal(np.asarray(flat),np.asarray(im.crop((x,y,x+48,y+96)))),key
                checked+=1
    d.text((32,1136),'ENDESGA 32 · Alpha 0/255 · unveränderte Identitäten · Kleidung bleibt umfärbbar',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-f-sprites.png');return checked

def layer_proof(atlas):
    im=Image.new('RGB',(1120,650),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font;checked=0
    d.text((32,24),'Paket F · Ruheposen und Ebenen',font=font(26,True),fill='#ffffff')
    d.text((32,66),'Rest-Blatt, Kleidungsmaske und Hände/Tasse · alle Ebenen exakt 3×',font=font(14),fill='#c0cbdc')
    for row,look in enumerate(kit.LOOKS):
        y=114+row*250;d.text((32,y+4),look,font=font(19,True),fill='#ffffff')
        for stem,x,label in [('rest',208,'Figur und Stuhl'),('rest-recolor-mask',496,'Kleidung'),('rest-hands',784,'Vordergrund')]:
            view=large(Image.open(OUT/f'characters/{look}/{stem}.png').convert('RGBA'))
            d.rectangle((x-8,y-6,x+view.width+7,y+view.height+5),fill='#8b9bb4');im.paste(view,(x,y),view)
            d.text((x,y+204),label,font=font(14),fill='#ffffff')
            flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
            assert np.array_equal(np.asarray(flat),np.asarray(im.crop((x,y,x+view.width,y+view.height))))
            checked+=1
    d.text((32,614),'Zeichenfolge am Tisch: Figur/Stuhl → Tisch → Vordergrund · Maske enthält nur Kleidung',font=font(13),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-f-layers.png');return checked

def animated(atlas,sprites):
    actions=kit.REST+kit.ACTION;times=sorted(set().union(*(set(range(0,3600,d)) for _,_,d in actions)))
    durations=[b-a for a,b in zip(times,times[1:]+[3600])];frames=[];checks=[];font=kit.furniture.font
    for t in times:
        im=Image.new('RGB',(1080,492),'#181425');d=ImageDraw.Draw(im);regions=[]
        d.text((32,20),'Pixel-Büro · 14 neue Animationen',font=font(26,True),fill='#ffffff')
        d.text((32,62),'Ansicht 3× · echte Bilddauern · look-02 zeigt den Kleidungsfarbtausch',font=font(14),fill='#c0cbdc')
        for col,(action,_,duration) in enumerate(actions):
            x=48+col*144;d.text((x,102),LABELS[action],font=font(13),fill='#c0cbdc')
            for look,y in [('look-01',164),('look-02',338)]:
                a=atlas['animations'][f'{look}-{action}'];index=(t//duration)%a['frames'];view=sprites[a['states'][index]]
                if look=='look-02':view=Image.fromarray(kit.chars.recolor(np.asarray(view),kit.chars.GREEN))
                view=large(view);d.rectangle((x-8,y-4,x+55,y+99),fill='#8b9bb4');im.paste(view,(x,y),view)
                regions.append((view,(x,y),'#8b9bb4'))
        d.text((32,132),'look-01',font=font(14,True),fill='#ffffff');d.text((32,306),'look-02 · Grün',font=font(14,True),fill='#ffffff')
        d.text((32,470),'Schlafen · Tasse am Tisch · Jubeln · Reden · stehend trinken · Kicker · Sofa',font=font(13),fill='#c0cbdc')
        frames.append(im.quantize(palette=base_preview.palette_image(),dither=Image.Dither.NONE));checks.append(regions)
    path=CHECKS/'stufe2-f-animation.gif'
    frames[0].save(path,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=False)
    base_preview.check_gif(path,checks);proof=Image.open(path)
    for i,duration in enumerate(durations):proof.seek(i);assert proof.info['duration']==duration
    return {'animationPreviewFrames':len(times),'animationPreviewScale':3,'animationPreviewCycleMs':3600,
            'animationPreviewExactTimings':'passed','animationPreviewPixelsMatchAtlas':True}

def room_scene(atlas,sprites,time_ms,seen):
    scene=Image.new('RGBA',(384,224))
    def put(name,x,y,image=None):scene.alpha_composite(image if image is not None else sprites[name],(x,y))
    def frame(look,action):
        a=atlas['animations'][f'{look}-{action}'];i=(time_ms//a['frameDurationMs'])%a['frames'];im=sprites[a['states'][i]]
        if look=='look-02':im=Image.fromarray(kit.chars.recolor(np.asarray(im),kit.chars.GREEN))
        return a,i,im
    for y in range(32,208,16):
        for x in range(16,368,16):put('wood-a' if (x+y)%32 else 'wood-b',x,y)
    for row in range(5):
        for col in range(8):
            v='top' if row==0 else 'bottom' if row==4 else '';h='left' if col==0 else 'right' if col==7 else ''
            put('rug-'+(v+'-'+h if v and h else v or h or 'center'),24+col*16,128+row*16)
    for x in range(16,368,16):put('wall-plain',x,0)
    put('door-wood-closed',16,0)
    put('wall-outer-corner',12,0);put('wall-outer-corner',356,0,ImageOps.mirror(sprites['wall-outer-corner']))
    for y in range(16,208,16):put('wall-side-cap',12,y);put('wall-side-cap',356,y,ImageOps.mirror(sprites['wall-side-cap']))
    for name,x in [('window-day',48),('whiteboard',96),('wall-clock',160),('corkboard',184),('window-day',240),('wall-shelf',304)]:put(name,x,atlas['sprites'][name]['wallY'])
    for look,action,x in [('look-01','sleep',16),('look-02','sleep',104),('look-01','sip',192),('look-02','sip',280)]:
        a,i,person=frame(look,action);origin=(x+16,56)
        scene.alpha_composite(person,origin);put('desk-large',x,72);put('lamp-on',x+1,67);put('plant-desk',x+36,68)
        fg=base_preview.foreground(atlas,a,i);scene.alpha_composite(fg,origin)
        pixels=np.asarray(scene)[origin[1]:origin[1]+32,origin[0]:origin[0]+16];contact=np.asarray(fg);mask=contact[:,:,3]==255
        assert np.array_equal(pixels[mask],contact[mask]),(look,action,i,'foreground hidden by desk')
        seen.add((look,action,i))
    for action,pairs in [('cheer',[('look-01',96),('look-02',128)]),('talk',[('look-01',176),('look-02',208)]),('drink',[('look-01',288),('look-02',320)])]:
        for look,x in pairs:
            _,_,person=frame(look,action);scene.alpha_composite(person,(x-8,96))
    put('sofa',32,144)
    for look,spot in [('look-01',atlas['sprites']['sofa']['spots'][0]),('look-02',atlas['sprites']['sofa']['spots'][2])]:
        _,_,person=frame(look,'sofa');foot=(32+spot['dx'],176+spot['dy']);scene.alpha_composite(person,(foot[0]-8,foot[1]-32))
    put('coffee-table',40,184);put('floor-lamp-on',128,144)
    for look,spot in [('look-01',atlas['sprites']['kicker-0']['spots'][0]),('look-02',atlas['sprites']['kicker-0']['spots'][1])]:
        _,_,person=frame(look,'kicker')
        if spot['facing']=='left':person=ImageOps.mirror(person)
        foot=(208+spot['dx'],176+spot['dy']);scene.alpha_composite(person,(foot[0]-8,foot[1]-32))
    ka=atlas['animations']['kicker-play'];put(ka['states'][(time_ms//ka['frameDurationMs'])%len(ka['states'])],208,152)
    put('plant-palm',336,160);put('server-2',352,32);put('plant-tall',288,168)
    return scene

def montage(atlas,sprites):
    seen=set()
    for t in [0,300,600,700]:room_scene(atlas,sprites,t,seen)
    assert len(seen)==10
    view=large(room_scene(atlas,sprites,900,seen));im=Image.new('RGB',(1216,810),'#181425');d=ImageDraw.Draw(im);font=kit.furniture.font
    d.text((32,22),'Pixel-Büro · Neue Bewegungen im Raum',font=font(26,True),fill='#ffffff')
    d.text((32,64),'Ruheposen am Tisch · Jubeln, Reden, Trinken · Sofa und Kicker · beide Looks · Ansicht 3×',font=font(13),fill='#c0cbdc')
    d.rectangle((28,100,1187,779),fill='#8b9bb4');im.paste(view,(32,104),view)
    d.text((32,788),'Posenmontage: Jede Figur wird mehrfach gezeigt. Tisch-, Sofa- und Kickerplätze stammen aus dem Atlas.',font=font(12),fill='#c0cbdc')
    im.save(CHECKS/'stufe2-f-room.png')
    flat=Image.new('RGB',view.size,'#8b9bb4');flat.paste(view,mask=view)
    assert np.array_equal(np.asarray(flat),np.asarray(im.crop((32,104,32+view.width,104+view.height))))
    return {'roomNativeSize':[384,224],'roomMontageScale':3,'roomPreviewPixelsMatchAtlas':True,
            'restForegroundCompositesChecked':len(seen),'all14AnimationsMountedInRoom':True,
            'sofaAndKickerUseExistingAtlasSpots':True}

def build(atlas):
    CHECKS.mkdir(parents=True,exist_ok=True)
    _,pixels=kit.room.read_sprites(atlas);sprites={n:Image.fromarray(p) for n,p in pixels.items()}
    return {'newSpritePreviewCropsChecked':overview(atlas,sprites),'previewPixelsMatchAtlas':True,
            'layerPreviewCropsChecked':layer_proof(atlas),**animated(atlas,sprites),**montage(atlas,sprites)}
