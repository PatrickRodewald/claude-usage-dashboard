#!/usr/bin/env python3
"""Retarget generated rest/action poses to approved characters and extend D."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import prepare_stufe2_d as previous
import prepare_characters as chars
import prepare_animations as old
from prepare_stufe2_a import preserved

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba;NAVY=rgba('181425')
LOOKS=['look-01','look-02']
REST=[('sleep',2,700),('sip',3,300)]
ACTION=[('cheer',2,300),('talk',2,350),('drink',2,600),('kicker',2,150),('sofa',2,900)]
CUPS={'sip':[(5,16),(5,13),(5,10)],'drink':[(5,14),(5,10)]}

def head_layer(person,action):
    layer=np.zeros((32,16,4),dtype=np.uint8);head=person[:12].copy()
    if action=='sleep':
        for x in (5,9):head[8,x:x+2]=NAVY
        layer[4:16]=head
    else:layer[:12]=head
    return layer

def clean_clothing(frame,action,head):
    p=frame.copy();yy,xx=np.indices((32,16))
    allowed=(yy>=12)&(yy<=20)
    if action=='cheer':allowed|=(yy<12)&((xx<=3)|(xx>=12))
    allowed&=head[:,:,3]==0
    for key,color in zip(chars.KEYS,('c0cbdc','5a6988','3a4466')):
        p[np.all(p==key,axis=2)&~allowed]=rgba(color)
    mask=chars.key_mask(p);ys,xs=np.where(mask)
    assert len(ys)>=3,('Clothing lost',action)
    for i,key in enumerate(chars.KEYS):
        if np.all(p==key,axis=2).any():continue
        ordered=sorted(zip(ys,xs),key=lambda q:(q[0]+q[1] if i==0 else -q[0]-q[1] if i==2 else abs(q[0]-17)+abs(q[1]-8)))
        for y,x in ordered:
            if np.all(p==p[y,x],axis=2).sum()>1:p[y,x]=key;break
    return p

def mug_layer(look,position):
    # Native correction of the generated cup and gripping forearms. This
    # layer is replayed over a desk, so the cup cannot disappear behind it.
    im=Image.new('RGBA',(16,32));d=ImageDraw.Draw(im)
    skin=old.SKIN[look];x,y=position;grips=[((3,18),(x-1,y+2)),((12,18),(x+6,y+2))]
    for start,end in grips:
        upper=(start[0],15)
        d.line([upper,start],fill=NAVY,width=4);d.line([upper,start],fill=rgba(skin[1]),width=2)
        d.line([start,end],fill=NAVY,width=4);d.line([start,end],fill=rgba(skin[1]),width=2)
        d.point(end,fill=rgba(skin[2]))
    d.rectangle((x,y,x+3,y+4),fill=NAVY);d.rectangle((x+1,y+1,x+2,y+3),fill=rgba('ffffff'))
    d.rectangle((x+4,y+1,x+5,y+3),fill=NAVY)
    d.point((x+4,y+2),fill=rgba('ffffff'))
    return furniture.outlined(np.asarray(im).copy())

def lower_body(person):
    # Crop only trousers and shoes; the relaxed hands in the turnaround must
    # not survive as a second pair when the new arms are raised.
    p=np.zeros_like(person);p[21:30,4:12]=person[21:30,4:12];p[30:]=person[30:]
    grey=old.colors_mask(p,old.GREY);p[~grey]=0
    return p

def moving_body(pose,look,action):
    yy,xx=np.indices((32,16));roi=(yy>=12)&(yy<=23)
    if action=='cheer':roi|=(yy<12)&((xx<=4)|(xx>=11))
    material=chars.key_mask(pose)
    if action not in CUPS:material|=old.colors_mask(pose,old.SKIN[look])
    if look=='look-01':material|=old.colors_mask(pose,['ffffff','c0cbdc'])
    selected=material&roi
    selected|=old.dilate(selected)&np.all(pose==NAVY,axis=2)
    layer=np.zeros_like(pose);layer[selected]=pose[selected]
    return layer

def breathing(frame,head,foreground,chair=None):
    p=frame.copy()
    for left,right in ((1,5),(11,15)):
        p[12:17,left:right]=frame[13:18,left:right]
    p=old.overlay(p,head);p=old.overlay(p,foreground)
    if chair is not None:p[21:]=frame[21:]
    return p

def build(config,old_sprites):
    poses={};details={};heads={};contacts={}
    for look in LOOKS:
        person=old_sprites[look+'-front'];profile=old_sprites[look+'-right']
        rest=old.normalized_rows(config['sources'][look+'-rest'],look,(2,3),16)
        action=old.normalized_rows(config['sources'][look+'-action'],look,(2,2,2,2,2),16)
        chair=np.zeros((32,16,4),dtype=np.uint8);chair[8:]=old_sprites['chair-front']
        chair=old.overlay(chair,lower_body(old_sprites[look+'-type-0']))
        poses[look]={};contacts[look]={};heads[look]={};details[look]={}
        for (name,count,_),row in zip(REST+ACTION,rest+action):
            head=head_layer(profile if name=='kicker' else person,name);heads[look][name]=head
            base=chair.copy() if name in ('sleep','sip') else np.zeros_like(person)
            if name not in ('sleep','sip'):
                if name in ('kicker','sofa'):
                    legs=old.leg_plane(row[0]);legs[:21]=0
                    if name=='sofa':legs[21:,:3]=0;legs[21:,13:]=0
                    base=old.overlay(base,legs)
                else:base=old.overlay(base,lower_body(person))
            torso=(profile if name=='kicker' else person)
            base[12:21,5:11]=torso[12:21,5:11]
            output=[];layers=[]
            for i,pose in enumerate(row):
                frame=old.overlay(base,moving_body(pose,look,name))
                frame[21:]=base[21:]
                frame=old.overlay(frame,head)
                if name in CUPS:
                    # Clean the source cup out of the central clothing region.
                    frame[12:21,5:11]=torso[12:21,5:11]
                    frame=old.overlay(frame,head)
                    contact=mug_layer(look,CUPS[name][i]);frame=old.overlay(frame,contact)
                elif name=='sleep':
                    roi=np.zeros((32,16),dtype=bool);roi[16:20]=True
                    contact=old.hand_layer(frame,look,roi)
                else:contact=np.zeros_like(frame)
                frame=clean_clothing(frame,name,head)
                output.append(frame);layers.append(contact)
            if name in ('sleep','sofa'):
                output[1]=clean_clothing(breathing(output[0],head,layers[0],chair if name=='sleep' else None),name,head)
                layers[1]=layers[0].copy()
            if name=='kicker':
                for p in output:
                    _,xs=np.where(p[15:23,:,3]>0)
                    if xs.max()==14:
                        for y in range(15,23):
                            if p[y,14,3]:p[y,15]=p[y,14];p[y,14]=p[y,13]
            output=[clean_clothing(furniture.outlined(p),name,head) for p in output]
            for i,p in enumerate(output):
                contact=layers[i];mask=contact[:,:,3]==255
                contact[mask]=p[mask]
            poses[look][name]=output;contacts[look][name]=layers
            details[look][name]={'frames':count,'distinctFrames':len({p.tobytes() for p in output}),
                                'sourceRow':('rest' if name in ('sleep','sip') else 'action')}
    return poses,contacts,heads,details

def extend(atlas,poses,contacts):
    for look in LOOKS:
        for sheet,rows,size in [('rest',REST,(48,64)),('action',ACTION,(64,160))]:
            width,height=size;pixels=np.zeros((height,width,4),dtype=np.uint8);foreground=np.zeros_like(pixels)
            image=f'characters/{look}/{sheet}.png';mask_name=f'characters/{look}/{sheet}-recolor-mask.png'
            hand_name=f'characters/{look}/rest-hands.png'
            for r,(name,count,duration) in enumerate(rows):
                states=[]
                for i,p in enumerate(poses[look][name]):
                    pixels[r*32:(r+1)*32,i*16:(i+1)*16]=p
                    if sheet=='rest':foreground[r*32:(r+1)*32,i*16:(i+1)*16]=contacts[look][name][i]
                    key=f'{look}-{name}-{i}'
                    entry={'image':image,'x':i*16,'y':r*32,'width':16,'height':32,'frames':1,
                           'anchor':[8,32],'feetBaseline':32,'footprintTiles':[1,1],'includesChair':sheet=='rest'}
                    if sheet=='rest':entry['foregroundImage']=hand_name
                    atlas['sprites'][key]=entry;states.append(key)
                animation={'image':image,'x':0,'y':r*32,'width':16,'height':32,'frames':count,
                           'frameDurationMs':duration,'loop':True,'states':states,'anchor':[8,32],
                           'recolorMask':mask_name,'includesChair':sheet=='rest'}
                if sheet=='rest':animation['foregroundImage']=hand_name
                if name in CUPS:animation['includesMug']=True
                atlas['animations'][f'{look}-{name}']=animation
                atlas['characters'][look]['animations'][name]=f'{look}-{name}'
            Image.fromarray(pixels).save(OUT/image)
            atlas['meta']['images'][image]={'width':width,'height':height}
            mask=np.zeros_like(pixels);mask[chars.key_mask(pixels)]=rgba('ffffff');Image.fromarray(mask).save(OUT/mask_name)
            atlas['auxiliaryImages'][mask_name]={'width':width,'height':height,'kind':'recolor-mask'}
            atlas['characters'][look]['animationMasks'][sheet]=mask_name
            if sheet=='rest':
                Image.fromarray(foreground).save(OUT/hand_name)
                atlas['auxiliaryImages'][hand_name]={'width':width,'height':height,'kind':'hand-foreground'}
        atlas['characters'][look]['mirrorKickerLeftFrom']=f'{look}-kicker'
    room.floors.save_json(OUT/'atlas.json',atlas)

def validate(atlas,heads,details):
    baseline=json.loads((ROOT/'art/references/stufe2-d-atlas.json').read_text(encoding="utf-8"));preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2 and len(atlas['sprites'])==253 and len(atlas['animations'])==43
    hashes=json.loads((ROOT/'art/stufe2-d-assets.json').read_text(encoding="utf-8"))
    for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    images,sprites=room.read_sprites(atlas);palette=set(room.floors.PALETTE);summary={};new_names=[]
    for look in LOOKS:
        summary[look]={}
        for sheet,rows,size in [('rest',REST,(48,64)),('action',ACTION,(64,160))]:
            image=f'characters/{look}/{sheet}.png';w,h=size;p=images[image]
            assert p.shape==(h,w,4) and set(np.unique(p[:,:,3]))=={0,255}
            assert {tuple(c) for c in p[p[:,:,3]==255,:3].tolist()}<=palette
            mask_name=atlas['characters'][look]['animationMasks'][sheet]
            mask=np.asarray(Image.open(OUT/mask_name).convert('RGBA'))
            assert mask.shape==p.shape and np.array_equal(mask[:,:,3]==255,chars.key_mask(p))
            assert np.all(mask[mask[:,:,3]==255]==rgba('ffffff'))
            cover=np.zeros((h,w),dtype=np.uint8)
            if sheet=='rest':
                fg=np.asarray(Image.open(OUT/f'characters/{look}/rest-hands.png').convert('RGBA'))
                assert fg.shape==p.shape and set(np.unique(fg[:,:,3]))=={0,255}
                fm=fg[:,:,3]==255;assert np.all(p[fm]==fg[fm]) and not chars.key_mask(fg).any()
                assert {tuple(c) for c in fg[fm,:3].tolist()}<=palette
            for row,(action,count,duration) in enumerate(rows):
                animation=atlas['animations'][f'{look}-{action}'];frames=[];shade_counts=[]
                assert animation['frames']==count and len(animation['states'])==count
                assert animation['frameDurationMs']==duration and animation['loop'] is True
                assert animation['includesChair']==(sheet=='rest')
                assert animation['recolorMask']==mask_name and animation['anchor']==[8,32]
                for i,key in enumerate(animation['states']):
                    new_names.append(key);entry=atlas['sprites'][key];frame=sprites[key];frames.append(frame)
                    assert entry['image']==image and (entry['x'],entry['y'])==(i*16,row*32)
                    assert frame.shape==(32,16,4) and entry['anchor']==[8,32] and entry['feetBaseline']==32
                    assert entry['frames']==1 and entry['footprintTiles']==[1,1]
                    assert frame[31,:,3].any();cover[row*32:(row+1)*32,i*16:(i+1)*16]+=1
                    opaque=frame[:,:,3]==255;pad=np.pad(opaque,1)
                    edge=opaque&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
                    assert np.all(frame[edge]==NAVY),(key,'open contour')
                    cloth=chars.key_mask(frame);counts=[int(np.all(frame==k,axis=2).sum()) for k in chars.KEYS]
                    assert all(c>0 for c in counts),(key,'missing cloth shade')
                    shade_counts.append(counts)
                    yy,xx=np.indices((32,16));allowed=(yy>=12)&(yy<=20)
                    if action=='cheer':allowed|=(yy<12)&((xx<=3)|(xx>=12))
                    assert not cloth[~allowed].any(),(key,'key color outside clothing')
                    head=heads[look][action];hm=head[:,:,3]==255
                    if action in CUPS:
                        contact=mug_layer(look,CUPS[action][i]);hm &= contact[:,:,3]==0
                    assert np.array_equal(frame[hm],head[hm]),(key,'approved head changed')
                    for shades in (chars.GREEN,chars.RED):
                        recolored=chars.recolor(frame,shades)
                        assert np.array_equal(recolored[~cloth],frame[~cloth])
                        assert np.array_equal(recolored[:,:,3],frame[:,:,3])
                    if sheet=='action':
                        assert not frame[24:,:2,3].any() and not frame[24:,14:,3].any(),(key,'chair or furniture residue')
                        if action=='kicker':assert frame[15:23,15,3].any(),(key,'hand cannot reach the existing kicker spot')
                    else:
                        sub=fg[row*32:(row+1)*32,i*16:(i+1)*16]
                        assert sub[:,:,3].any() and entry['foregroundImage']==f'characters/{look}/rest-hands.png'
                        if action=='sip':
                            x,y=CUPS[action][i];white=np.argwhere(np.all(sub==rgba('ffffff'),axis=2))
                            expected={(y+dy,x+dx) for dy in (1,2,3) for dx in (1,2)}|{(y+2,x+4)}
                            assert {tuple(v) for v in white}==expected,(key,'cup shape or position')
                assert len({p.tobytes() for p in frames})==count,(look,action,'lost motion')
                assert all(np.array_equal(f[30:],frames[0][30:]) for f in frames),'Soles must stay fixed'
                if action in ('sleep','sofa'):assert np.array_equal(frames[0][21:],frames[1][21:])
                summary[look][action]={'frames':count,'frameDurationMs':duration,'distinctFrames':count,'clothingShadePixelCounts':shade_counts}
            assert cover.max()==1 and not p[cover==0,3].any()
            if sheet=='rest':assert not fg[cover==0,3].any()
    assert len(new_names)==30 and len(set(new_names))==30
    return {'status':'passed','package':'F','newSprites':30,'newAnimations':14,'totalSprites':253,'totalAnimations':43,
            'looks':LOOKS,'schemaVersion':2,'frameSize':[16,32],'restSheetSize':[48,64],'actionSheetSize':[64,160],
            'palette':'ENDESGA 32','alphaLevels':[0,255],'anchor':[8,32],'feetBaseline':32,
            'atlasBoundsAndUnusedCells':'passed','closedNavyContours':'passed','approvedHeadIdentity':'passed',
            'sleepHeadOffset':[0,4],'sleepClosedEyes':'passed','fixedSolesAndBreathingLegs':'passed',
            'allFramesDistinctPerAnimation':'passed','clothingMasksMatchKeys':'passed','allThreeClothingShades':'passed',
            'recolorPreservesNonClothingPixels':'passed','restForegroundMatchesBasePixels':'passed',
            'restForegroundHasNoClothingKeys':'passed','threeCupHeights':'passed','actionWithoutChairResidue':'passed',
            'kickerHandReachMatchesExistingSpots':'passed',
            'allPreviousAtlasEntries':'unchanged','previousAssetFilesByteIdentical':len(hashes),
            'newImageFiles':4,'newAuxiliaryImages':6,'animations':summary,'normalization':details,'previewScale':3}

def main():
    previous.main()
    config=json.loads((ROOT/'art/stufe2-f-source.json').read_text(encoding="utf-8"));atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"))
    _,sprites=room.read_sprites(atlas);poses,contacts,heads,details=build(config,sprites)
    extend(atlas,poses,contacts)
    report=validate(atlas,heads,details)
    from stufe2_f_previews import build as previews
    report.update(previews(atlas));room.floors.save_json(ROOT/'art/checks/stufe2-f-quality.json',report)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
