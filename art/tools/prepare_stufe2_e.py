#!/usr/bin/env python3
"""Build four additional looks without changing any previously shipped entry."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
import prepare_stufe2_g as previous
import prepare_characters as chars
import prepare_animations as old
from prepare_stufe2_a import preserved

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/office'
room,furniture=previous.room,previous.furniture
rgba=room.rgba;NAVY=rgba('181425')
LOOKS=['look-03','look-04','look-05','look-06']
VIEWS=['front','back','right']
WORK=['type','read','write','think']
ACTIONS=['walk-front','walk-back','walk-right','idle',*WORK]
DURATIONS=[120,120,120,700,160,220,160,500]

def register(config):
    for look,item in config['looks'].items():
        chars.PALETTES[look]=list(dict.fromkeys(['181425','262b44','3a4466','5a6988','8b9bb4','c0cbdc','ffffff',*item['skin'],*item['hair'],*chars.KEY_HEX,*(['e43b44'] if look=='look-06' else [])]))
        old.SKIN[look]=tuple(item['skin'])

def read_source(item):
    path=ROOT/item['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256']
    image=Image.open(path).convert('RGBA');assert list(image.size)==item['size'];return image

def build_base(config):
    register(config);result={}
    for look in LOOKS:
        item=config['sources'][look];source=read_source(item)
        # Uniform 14px cell content avoids the model's different raw view sizes.
        minimum_width=min(v['box'][2]-v['box'][0] for v in item['views']);views=[]
        for spec in item['views']:
            p=chars.normalize(source,look,spec,minimum_width)
            if look=='look-04' and spec['view'] in ('front','right'):
                for left in ([3,9] if spec['view']=='front' else [9]):
                    region=p[7:10,left:left+3];opaque=region[:,:,3]==255
                    region[opaque]=NAVY
                    if p[8,left+1,3]:p[8,left+1]=rgba('c0cbdc')
                if spec['view']=='front':p[8,6:9]=NAVY
            p=old.clean_keys(furniture.outlined(p));views.append(p)
        result[look]=views
    return result

def save_base(looks):
    for look,views in looks.items():
        folder=OUT/'characters'/look;folder.mkdir(parents=True,exist_ok=True)
        sheet=np.concatenate(views,axis=1);Image.fromarray(sheet).save(folder/'sheet.png')
        mask=np.zeros_like(sheet);mask[chars.key_mask(sheet)]=rgba('ffffff');Image.fromarray(mask).save(folder/'recolor-mask.png')
        Image.fromarray(sheet).resize((384,256),Image.Resampling.NEAREST).save(ROOT/f'art/references/{look}-8x.png')

def accessories(person,look):
    """Carry the approved ponytail/neckphones/bob beyond the head strip."""
    yy,xx=np.indices((32,16));roi=(yy>=12)&(yy<18)
    colors={'look-03':['262b44','3a4466'], 'look-04':[],
            'look-05':['5a6988','8b9bb4','c0cbdc'],
            'look-06':['fee761','feae34','d77643','e43b44']}[look]
    out=np.zeros_like(person)
    if not colors:return out
    if look=='look-05':roi &= yy<15
    if look=='look-06':roi &= yy<15
    seeds=old.colors_mask(person,colors)&roi
    mask=seeds|(old.dilate(seeds)&old.colors_mask(person,['181425'])&roi)
    out[mask]=person[mask];return out

def walk_frames(config,bases):
    walks={};detail={}
    for look in LOOKS:
        raw=old.normalized_rows(config['sources'][look+'-walk'],look,(4,4,4,2),14)
        rows=[];detail[look]={}
        for d,view in enumerate(VIEWS):
            person=bases[look][d];legs=[old.leg_plane(p) for p in raw[d]]
            # A passing phase is physically narrower than an extended stride.
            # Preserve the source poses; never invent motion by tint changes.
            if len({p[23:,:,3].tobytes() for p in legs})<3:
                passing=legs[1].copy();passing[23:]=0
                passing[23:30,5:8]=rgba('262b44');passing[23:29,8:11]=rgba('3a4466')
                passing[29:32,4:8]=rgba('181425');passing[29:31,8:12]=rgba('181425')
                legs[1]=furniture.outlined(passing)
                detail[look][view]='native passing-leg silhouette repair'
            row=[]
            for i,pose in enumerate(raw[d]):
                p=pose.copy();p[:12]=person[:12];p[12:21,5:11]=person[12:21,5:11]
                p[21:]=legs[i][21:]
                roi=np.zeros((32,16),dtype=bool);roi[12:25]=True
                p=old.overlay(p,old.hand_layer(pose,look,roi))
                p=old.overlay(p,accessories(person,look))
                p=old.clean_keys(furniture.outlined(p));p[:12]=person[:12]
                row.append(p)
            rows.append(row)
        idle=bases[look][0].copy();breath=idle.copy()
        breath[12:17,1:5]=idle[13:18,1:5];breath[12:17,11:15]=idle[13:18,11:15]
        breath=old.overlay(breath,accessories(idle,look))
        breath=old.clean_keys(furniture.outlined(breath));breath[:12]=idle[:12]
        rows.append([idle,breath]);walks[look]=rows
    return walks,detail

def work_frames(config,bases,sprites):
    chair=np.zeros((32,16,4),dtype=np.uint8);chair[8:]=sprites['chair-front']
    result={};foregrounds={};yy,xx=np.indices((32,16))
    for look in LOOKS:
        raw=old.normalized_rows(config['sources'][look+'-desk-work'],look,(3,3,3,3),16)
        person=bases[look][0];fixed=old.overlay(chair,old.leg_plane(raw[0][0]))
        core=np.zeros_like(fixed);core[12:21,5:11]=person[12:21,5:11];fixed=old.overlay(fixed,core)
        rows=[];hand_rows=[]
        for r,task in enumerate(WORK):
            row=[];hand_row=[]
            for i,pose in enumerate(raw[r]):
                p=fixed.copy();roi=(yy>=12)&(yy<=24)&((xx<5)|(xx>=11))
                colored=(chars.key_mask(pose)|old.colors_mask(pose,old.SKIN[look]))&roi
                if look=='look-04':colored|=old.colors_mask(pose,['ffffff','c0cbdc'])&roi
                moving=colored|(old.colors_mask(pose,['181425'])&old.dilate(colored))
                p[moving]=pose[moving]
                dy=1 if task=='read' else -1 if task=='think' and i==1 else 0
                head=np.zeros_like(p)
                for y in range(12):
                    if 0<=y+dy<32:head[y+dy]=person[y]
                p=old.overlay(p,head);p=old.overlay(p,accessories(person,look))
                if dy==-1:p[11,6:10]=person[11,6:10]
                hand_roi=np.zeros((32,16),dtype=bool);hand_roi[12:25]=True
                hand_roi[12:15,5:11]=False  # neck/collar is never a hand layer
                if task=='think' and i==0:hand_roi[10:16,4:11]=True
                if task=='think' and i==2:hand_roi[3:13,12:16]=True
                hand=old.hand_layer(pose,look,hand_roi)
                raised=np.zeros_like(p)
                if task=='think' and i==2 and look in ('look-03','look-04'):
                    roi=(yy>=5)&(yy<18)&(xx>=12)
                    colors=chars.KEY_HEX if look=='look-03' else ['ffffff','c0cbdc']
                    seeds=(old.colors_mask(pose,colors)|old.colors_mask(pose,old.SKIN[look]))&roi
                    mask=seeds|(old.dilate(seeds)&old.colors_mask(pose,['181425'])&roi)
                    raised[mask]=pose[mask];p=old.overlay(p,raised)
                p=furniture.outlined(old.overlay(p,hand));fabric=chars.key_mask(raised)
                cleaned=old.clean_keys(p);cleaned[fabric]=p[fabric];p=cleaned
                # Foreground pixels are an exact subset of the final pose.
                visible=(hand[:,:,3]==255)&(p[:,:,3]==255)
                fg=np.zeros_like(p);fg[visible]=p[visible]
                # Only exposed hands and their navy contour cross desk props.
                allowed=old.colors_mask(fg,[*old.SKIN[look],'181425']);fg[~allowed]=0
                row.append(p);hand_row.append(fg)
            rows.append(row);hand_rows.append(hand_row)
        result[look]=rows;foregrounds[look]=hand_rows
    return result,foregrounds

def extend(atlas,config,bases,walks,work,hands):
    for look in LOOKS:
        image=f'characters/{look}/sheet.png';mask=f'characters/{look}/recolor-mask.png'
        atlas['meta']['images'][image]={'width':48,'height':32}
        atlas.setdefault('auxiliaryImages',{})[mask]={'width':48,'height':32,'kind':'recolor-mask'}
        profile=config['looks'][look]
        atlas['characters'][look]={'role':profile['role'],'appearance':profile['appearance'],
            'views':{v:f'{look}-{v}' for v in VIEWS},'mirrorLeftFrom':'right',
            'anchor':[8,32],'feetBaseline':32,'frameSize':[16,32],'recolorMask':mask,
            'animationMasks':{},'animations':{},'mirrorWalkLeftFrom':f'{look}-walk-right'}
        for i,view in enumerate(VIEWS):
            atlas['sprites'][f'{look}-{view}']={'image':image,'x':16*i,'y':0,'width':16,'height':32,
                'frames':1,'anchor':[8,32],'feetBaseline':32,'footprintTiles':[1,1]}
        for category,rows,actions,durations in [('walk',walks[look],ACTIONS[:4],DURATIONS[:4]),
                                                ('desk-work',work[look],WORK,DURATIONS[4:])]:
            image=f'characters/{look}/{category}.png';mask=f'characters/{look}/{category}-recolor-mask.png'
            old.save_sheet(OUT/image,rows,(16,32));sheet=np.asarray(Image.open(OUT/image).convert('RGBA'))
            atlas['meta']['images'][image]={'width':sheet.shape[1],'height':sheet.shape[0]}
            m=np.zeros_like(sheet);m[chars.key_mask(sheet)]=rgba('ffffff');Image.fromarray(m).save(OUT/mask)
            atlas['auxiliaryImages'][mask]={'width':sheet.shape[1],'height':sheet.shape[0],'kind':'recolor-mask'}
            atlas['characters'][look]['animationMasks'][category]=mask
            for r,(row,action,duration) in enumerate(zip(rows,actions,durations)):
                name=f'{look}-{action}';states=[]
                for i,p in enumerate(row):
                    key=f'{name}-{i}';states.append(key)
                    entry={'image':image,'x':16*i,'y':32*r,'width':16,'height':32,'frames':1,
                        'anchor':[8,32],'feetBaseline':32,'footprintTiles':[1,1]}
                    if category=='desk-work':entry.update(includesChair=True,foregroundImage=f'characters/{look}/desk-work-hands.png')
                    atlas['sprites'][key]=entry
                a={'image':image,'x':0,'y':32*r,'width':16,'height':32,'frames':len(row),
                    'frameDurationMs':duration,'loop':True,'states':states,'anchor':[8,32],'recolorMask':mask}
                if category=='desk-work':
                    a.update(includesChair=True,foregroundImage=f'characters/{look}/desk-work-hands.png')
                    if action!='think':a['prop']={'mount':[0,12],'sprite':'laptop-back-open'} if action=='type' else {
                        'mount':[0,12],'animation':'book-page-turn' if action=='read' else 'notepad-write',
                        'frameMap':[0,1,3] if action=='read' else [0,1,2]}
                atlas['animations'][name]=a;atlas['characters'][look]['animations'][action]=name
        image=f'characters/{look}/desk-work-hands.png';old.save_sheet(OUT/image,hands[look],(16,32))
        atlas['auxiliaryImages'][image]={'width':48,'height':128,'kind':'hand-foreground'}
    room.floors.save_json(OUT/'atlas.json',atlas)
    return atlas

def validate(atlas,config,repairs):
    baseline=json.loads((ROOT/'art/references/stufe2-g-atlas.json').read_text(encoding="utf-8"));preserved(baseline,atlas)
    assert atlas['meta']['schemaVersion']==2
    assert len(atlas['sprites'])==390 and len(atlas['animations'])==82 and len(atlas['characters'])==6
    hashes=json.loads((ROOT/'art/stufe2-g-assets.json').read_text(encoding="utf-8"))
    for path,digest in hashes.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest,path
    assert len(config['sources'])==12 and len({s['sha256'] for s in config['sources'].values()})==12
    for source in config['sources'].values():
        read_source(source);assert (ROOT/source['prompt']).is_file()
        assert len(source.get('views',source.get('frames',[]))) in (3,12,14)
    images,sprites=room.read_sprites(atlas);palette=set(room.floors.PALETTE)
    files=[];detail={};new_names=[n for n in atlas['sprites'] if any(n.startswith(l+'-') for l in LOOKS)]
    assert len(new_names)==116
    for path in sorted((OUT/'characters').glob('look-0[3-6]/*.png')):
        p=np.asarray(Image.open(path).convert('RGBA'));relative=str(path.relative_to(OUT));files.append(str(path.relative_to(ROOT)))
        dims=atlas['meta']['images'].get(relative,atlas['auxiliaryImages'].get(relative));assert dims
        assert p.shape[:2]==(dims['height'],dims['width'])
        assert set(np.unique(p[:,:,3]))<={0,255}
        assert {tuple(c) for c in p[p[:,:,3]==255,:3].tolist()}<=palette
    assert len(files)==28 and len(list(OUT.rglob('*.png')))==65
    for name in new_names:
        p=sprites[name];entry=atlas['sprites'][name]
        assert p.shape==(32,16,4) and p[31,:,3].any(),(name,'feet')
        assert entry['anchor']==[8,32] and entry['feetBaseline']==32 and entry['footprintTiles']==[1,1]
        assert entry['frames']==1 and all(np.all(p==shade,axis=2).any() for shade in chars.KEYS),(name,'shades')
        mask=chars.key_mask(p);allowed=np.zeros((32,16),dtype=bool);allowed[12:21]=True
        if name=='look-03-think-2':allowed[5:18,12:16]=True
        assert not (mask&~allowed).any(),(name,'non-garment key')
        for colors in (chars.GREEN,chars.RED):
            swapped=chars.recolor(p,colors);assert np.array_equal(p[~mask],swapped[~mask]),(name,'recolor leaks')
        opaque=p[:,:,3]==255;pad=np.pad(opaque,1)
        edge=opaque&~(pad[:-2,1:-1]&pad[2:,1:-1]&pad[1:-1,:-2]&pad[1:-1,2:])
        assert np.all(p[edge]==NAVY),(name,'open contour')
    for look in LOOKS:
        character=atlas['characters'][look];assert character['role']==config['looks'][look]['role']
        assert character['appearance']==config['looks'][look]['appearance']
        assert character['frameSize']==[16,32] and character['anchor']==[8,32] and character['feetBaseline']==32
        assert character['mirrorLeftFrom']=='right' and character['mirrorWalkLeftFrom']==look+'-walk-right'
        assert set(character['animations'])==set(ACTIONS)
        assert set(character['animationMasks'])=={'walk','desk-work'}
        detail[look]={'role':character['role'],'actions':{}}
        for image_name,mask_name in [('sheet','recolor-mask'),('walk','walk-recolor-mask'),('desk-work','desk-work-recolor-mask')]:
            image=images[f'characters/{look}/{image_name}.png']
            mask=np.asarray(Image.open(OUT/f'characters/{look}/{mask_name}.png').convert('RGBA'))
            assert np.array_equal(mask[:,:,3]==255,chars.key_mask(image))
            assert np.all(mask[mask[:,:,3]==255]==rgba('ffffff'))
            coverage=np.zeros(image.shape[:2],dtype=np.uint8)
            for n in new_names:
                e=atlas['sprites'][n]
                if e['image']!=f'characters/{look}/{image_name}.png':continue
                x,y,w,h=(e[k] for k in ('x','y','width','height'))
                assert 0<=x<=image.shape[1]-w and 0<=y<=image.shape[0]-h
                coverage[y:y+h,x:x+w]+=1
            assert coverage.max()==1 and not image[coverage==0,3].any()
        for action,duration in zip(ACTIONS,DURATIONS):
            a=atlas['animations'][f'{look}-{action}'];frames=[sprites[n] for n in a['states']]
            expected=4 if action.startswith('walk-') else 2 if action=='idle' else 3
            assert a['frames']==len(frames)==expected and a['frameDurationMs']==duration and a['loop'] is True
            assert a['anchor']==[8,32] and a['recolorMask']==character['animationMasks']['walk' if action in ACTIONS[:4] else 'desk-work']
            assert len({f.tobytes() for f in frames})==expected,(look,action,'lost gesture')
            for i,name in enumerate(a['states']):
                e=atlas['sprites'][name];assert e['image']==a['image'] and e['x']==a['x']+16*i and e['y']==a['y']
            if action.startswith('walk-'):
                base=sprites[f'{look}-{action.split("-")[1]}']
                assert all(np.array_equal(f[:12],base[:12]) for f in frames)
                silhouettes=len({f[23:,:,3].tobytes() for f in frames});assert silhouettes>=3
                detail[look]['actions'][action]={'frames':4,'distinctLegSilhouettes':silhouettes,'headStable':True}
            elif action=='idle':
                assert np.array_equal(frames[0][:12],frames[1][:12]) and np.array_equal(frames[0][21:],frames[1][21:])
                assert np.any(frames[0][:,:,3]!=frames[1][:,:,3]),'Breathing must move the silhouette'
                detail[look]['actions'][action]={'frames':2,'shoulderSilhouetteMoves':True}
            else:
                fixed=sprites[f'{look}-type-0'][26:]
                assert all(np.array_equal(f[26:],fixed) for f in frames)
                assert a['includesChair'] is True and a['foregroundImage']==f'characters/{look}/desk-work-hands.png'
                if action=='think':assert 'prop' not in a
                else:
                    prop=a['prop'];assert prop['mount']==[0,12]
                    if action=='type':assert prop['sprite']=='laptop-back-open'
                    else:assert prop['frameMap']==([0,1,3] if action=='read' else [0,1,2])
                foreground=np.asarray(Image.open(OUT/a['foregroundImage']).convert('RGBA'))
                for i,f in enumerate(frames):
                    fg=foreground[a['y']:a['y']+32,16*i:16*(i+1)];m=fg[:,:,3]==255
                    assert m.any() and np.array_equal(fg[m],f[m]),(look,action,i,'foreground mismatch')
                    assert np.all(old.colors_mask(fg,[*old.SKIN[look],'181425'])[m])
                    assert not chars.key_mask(fg).any()
                detail[look]['actions'][action]={'frames':3,'chairAndFeetStable':True,'foregroundMatchesPose':True}
        base=sprites[f'{look}-front']
        if look=='look-04':
            assert np.array_equal(base[8,4],rgba('c0cbdc')) and np.array_equal(base[8,10],rgba('c0cbdc'))
        if look=='look-05':assert old.colors_mask(base[11:15],['5a6988','8b9bb4','c0cbdc']).sum()>=2
        if look=='look-06':
            for view in VIEWS:assert old.colors_mask(sprites[f'{look}-{view}'][:12],['e43b44']).any(),'Clip missing'
    targets={path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in files}
    config['targets']={'files':targets,'newSprites':116,'newAnimations':32,'frameSize':[16,32],'footAnchor':[8,32],
                       'sheets':{'sheet.png':[48,32],'walk.png':[64,128],'desk-work.png':[48,128]}}
    config['normalization']={'sampling':'area-mode rasterization, alpha threshold 192, ENDESGA 32, native contours #181425',
        'identity':'approved base heads are frozen across walking; ponytail, neckphones and bob carried into torso strip',
        'walk':'each look uses its own generated gait; all three directions retain four distinct leg silhouettes',
        'walkRepairs':repairs,'work':'one fixed chair/lower-body per look, canonical torso, three source gestures per task',
        'foreground':'exposed hand skin plus immediate navy contour, exact subset of the final pose; neck/collar excluded',
        'glasses':'look-04 square 3x3 rims and one light-grey center pixel per lens',
        'raisedSleeve':'look-03 think-2 retains clothing keys on the raised blazer sleeve above torso height',
        'nativeRetouch':'shoulder silhouette breathes by one pixel; preserve all three garment shades after sampling',
        'sourceCrops':'padded connected silhouettes at alpha >=192; torso split from garment bounds, shared median per row'}
    room.floors.save_json(ROOT/'art/stufe2-e-source.json',config)
    return {'status':'passed','package':'E','newLooks':LOOKS,'newSprites':116,'newAnimations':32,
        'totalSprites':390,'totalAnimations':82,'totalLooks':6,'newPngFiles':28,'totalPngFiles':65,
        'schemaVersion':2,'palette':'ENDESGA 32','alphaLevels':[0,255],'frameSize':[16,32],'footAnchor':[8,32],
        'rawImages':12,'sourceChecksumsAndCrops':'passed','atlasBoundsAndUnusedCells':'passed',
        'navyContours':116,'clothingMasksExact':'passed','recolorChangesOnlyClothing':'passed',
        'accessoriesUseNoClothingKeys':'passed','walkHeadsStable':'passed','workForegroundMatchesPose':'passed',
        'allPreviousAtlasEntries':'unchanged','previousAssetFilesByteIdentical':len(hashes),
        'restAndActionScope':'look-01 and look-02, as previously delivered in F','detail':detail,'previewScale':3}

def main():
    previous.main();config=json.loads((ROOT/'art/stufe2-e-source.json').read_text(encoding="utf-8"))
    looks=build_base(config);save_base(looks)
    atlas=json.loads((OUT/'atlas.json').read_text(encoding="utf-8"));_,sprites=room.read_sprites(atlas)
    walks,detail=walk_frames(config,looks);work,hands=work_frames(config,looks,sprites)
    atlas=extend(atlas,config,looks,walks,work,hands)
    report=validate(atlas,config,detail)
    from stufe2_e_previews import build as previews
    report.update(previews(atlas));room.floors.save_json(ROOT/'art/checks/stufe2-e-quality.json',report)
    room.floors.save_json(ROOT/'art/stufe2-progress.json',{'completed':['A','B1','C','B2','D','F','G','E'],
        'next':None,'remaining':[],'totalSprites':390,'totalAnimations':82,
        'currentBuildScript':'tools/prepare_stufe2_e.py','currentReport':'art/checks/stufe2-e-quality.json','basePackage':'pixel-office-emotes-kit'})
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
