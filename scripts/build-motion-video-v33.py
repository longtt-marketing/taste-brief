"""Render the v33 product film (v32 with scene 10 showing the recorded agent trace) with native motion graphics and real UI captures.

No browser automation. Reuses 5.0 seconds of the earlier Claude-designed opening;
all remaining scenes are reproducible Pillow/FFmpeg compositions. Scenario figures
are explanatory graphics, labelled as invented terms, never fabricated UI footage.
Usage: python scripts/build-motion-video.py prepare|stills|render|audio|assemble
"""
import asyncio
from functools import lru_cache
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

import edge_tts
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

APP = Path(__file__).resolve().parents[1]
OUT = APP / 'video/v33'
OUT.mkdir(parents=True, exist_ok=True)
W, H, FPS = 1920, 1080, 30
INTRO = 5.0
INK, WHITE, MUTED = '#070e1b', '#f4f7fc', '#a5b6ce'
TEAL, CORAL, LINE = '#66e3ce', '#ff8a69', '#29405b'
ASSETS = APP / 'design/video-v32'
FONT = ASSETS / 'fonts/InstrumentSans.ttf'
SCRIPT = APP / 'docs/demo-motion-v33.json'


def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)


def probe(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))


@lru_cache(maxsize=128)
def font(size, weight=500):
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_axes([100, weight])
    return f


@lru_cache(maxsize=1024)
def text_image(txt, size=40, color=WHITE, weight=500, spacing=8):
    f = font(size,weight)
    d = ImageDraw.Draw(Image.new('RGBA',(1,1)))
    box = d.multiline_textbbox((0,0),txt,font=f,spacing=spacing)
    im = Image.new('RGBA',(max(1,box[2]-box[0]+4),max(1,box[3]-box[1]+4)))
    ImageDraw.Draw(im).multiline_text((2-box[0],2-box[1]),txt,font=f,fill=color,spacing=spacing)
    return im


def ease(v):
    v = min(1,max(0,v))
    return 1-(1-v)**3


def paste(im, obj, x, y, opacity=1):
    if opacity <= 0: return
    if opacity < .999:
        obj = obj.copy()
        obj.putalpha(obj.getchannel('A').point(lambda v:int(v*opacity)))
    im.paste(obj,(round(x),round(y)),obj)


def text(im,txt,x,y,size=40,color=WHITE,weight=500,t=10,delay=0):
    a=ease((t-delay)/.6)
    paste(im,text_image(txt,size,color,weight),x,y+(1-a)*26,a)


def line(im,xy,fill=LINE,width=2):
    ImageDraw.Draw(im).line(xy,fill=fill,width=width)


def panel(im,box,fill='#101e31',outline=LINE,r=22,width=2):
    ImageDraw.Draw(im).rounded_rectangle(tuple(round(v) for v in box),radius=r,fill=fill,outline=outline,width=width)


def pill(im,txt,x,y,color=TEAL,fill='#12322f',size=24):
    ti=text_image(txt,size,color,600)
    panel(im,(x,y,x+ti.width+32,y+ti.height+22),fill,fill,12)
    paste(im,ti,x+16,y+11)


def make_bg():
    y,x=np.mgrid[0:H,0:W]
    glow=np.exp(-(((x-1540)/900)**2+((y-450)/700)**2))
    a=np.zeros((H,W,3),dtype=np.uint8)
    for c,(base,add) in enumerate([(6,10),(13,19),(25,29)]):a[:,:,c]=base+glow*add
    return Image.fromarray(a).convert('RGBA')


BG=make_bg()
STUDIO=Image.open(ASSETS/'studio.png').convert('RGBA').resize((W,H),Image.Resampling.LANCZOS)
SHOTS={key:Image.open(APP/'public/shots'/name).convert('RGBA') for key,name in {
    '02-shortlist':'decision-02-shortlist.png',
    '04-price-change':'decision-04-price-change.png',
    '05-unknown-terms':'decision-05-unknown-terms.png'
}.items()}


@lru_cache(maxsize=32)
def shot_crop(name, crop, size):
    return SHOTS[name].crop(crop).resize(size,Image.Resampling.LANCZOS)


def shot(im,name,crop,box,t=5,delay=0):
    x,y,w,h=box
    a=ease((t-delay)/.7)
    panel(im,(x-3,y-3,x+w+3,y+h+3),'#18283e','#38556a',10)
    paste(im,shot_crop(name,tuple(crop),(int(w),int(h))),x+(1-a)*36,y,a)


def pan_card(im,source_x,x,t,delay):
    a=ease((t-delay)/.7)
    shift=150*ease((t-4)/4)
    source=(source_x,310+shift,source_x+506,620+shift)
    crop=SHOTS['02-shortlist'].transform((790,484),Image.Transform.EXTENT,source,Image.Resampling.BICUBIC)
    panel(im,(x-3,342,x+793,832),'#18283e','#38556a',10)
    paste(im,crop,x+(1-a)*36,345,a)


def base(kicker,index,t):
    im=BG.copy()
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((94,62,122,90),radius=9,fill=TEAL)
    text(im,'Taste Brief',138,58,32,WHITE,700)
    text(im,kicker,94,150,25,TEAL,600,t,0)
    text(im,f'{index:02d} / 11',1700,65,24,MUTED)
    line(im,(94,1005,1826,1005))
    return im


def screen_frame(im,label,t):
    pill(im,label,94,875,size=22)


def graph(im,lab,val,x,y,width,col,t,delay):
    text(im,lab,x,y,34,WHITE,600,t,delay)
    panel(im,(x,y+65,x+width,y+101),'#14233a','#14233a',8)
    length=width*val/100*ease((t-delay-.3)/1.1)
    if length>1:panel(im,(x,y+65,x+length,y+101),col,col,8)
    text(im,f'{val}%',x+width+35,y+51,60,col,700,t,delay+.5)


def scene(key,t,dur,index):
    if key in ('question','close'):
        z=1+.025*min(1,t/dur)
        crop=(W*(1-1/z)/2,H*(1-1/z)/2,W*(1+1/z)/2,H*(1+1/z)/2)
        im=STUDIO.transform((W,H),Image.Transform.EXTENT,crop,Image.Resampling.BICUBIC)
        shade=Image.new('RGBA',(W,H),(4,10,20,40 if key=='question' else 95))
        im=Image.alpha_composite(im,shade)
        text(im,'Taste Brief',94,65,38,WHITE,700,t,.1)
        if key=='question':
            text(im,'THE SPONSORSHIP DECISION DESK',94,188,25,TEAL,600,t,.2)
            text(im,'Great fit.',94,308,112,WHITE,700,t,.5)
            text(im,'At what price?',94,442,112,TEAL,700,t,1.3)
            text(im,'Taste finds the audience.\nTerms decide the pilot.',100,656,39,WHITE,500,t,3.0)
        else:
            text(im,'Find the fit.',94,257,104,WHITE,700,t,.2)
            text(im,'Know your limits.',94,386,104,TEAL,700,t,1.2)
            text(im,'See what changes\nthe decision.',98,554,52,WHITE,500,t,2.5)
            pill(im,'TRY THE RECORDED RUN',96,783,size=27)
            text(im,'taste-brief.thelongmarketing.workers.dev',98,854,30,WHITE,500,t,4.0)
        text(im,'Illustrative studio image · AI-generated visuals and narration',96,1019,20,MUTED)
        return im
    im=base({'brief':'01 / START WITH THE BUYER','shortlist':'02 / FIND THE FIT','limits':'03 / SET THE LIMITS','baseline':'04 / COMPARE THE WHOLE PACKAGE','change':'05 / CHANGE ONE TERM','ceiling':'06 / KNOW WHAT TO NEGOTIATE','unknown':'07 / BRING BACK REAL TERMS','proof':'08 / WHY QLOO?','limitsproof':'09 / THE AGENT AT WORK'}[key],index,t)
    if key=='brief':
        text(im,'A brief. Not a blank chat.',94,213,83,WHITE,700,t,.2)
        rows=[('WHAT YOU SELL','Coffee subscription · $25 / month'),('WHERE','Austin, Texas'),('REFERENCE BRAND','Blue Bottle Coffee')]
        for i,(lab,val) in enumerate(rows):
            y=365+i*156
            a=ease((t-.7-i*.6)/.55)
            panel(im,(94,y,1826,y+132))
            text(im,lab,124,y+19,22,TEAL,600,t,.6+i*.6)
            text(im,val,124,y+62,48,WHITE,600,t,.8+i*.6)
            text(im,f'0{i+1}',1723,y+44,42,'#3e5a72',500,t,.8+i*.6)
        screen_frame(im,'Inputs used in the recorded Qloo run · 27 Oct 2026',t)
    elif key=='shortlist':
        text(im,'Two shows to ask first.',94,210,80,WHITE,700,t,.1)
        pan_card(im,192,94,t,.4)
        pan_card(im,713,945,t,.8)
        pill(im,'RECORDED QLOO RESULT · 27 OCT',94,876,size=23)
        text(im,'Local reach, rates and dates: still unverified.',795,882,29,CORAL,500,t,3.0)
        # Focus on the two source rows, never invent a quote or a sponsor.
        if 2<t<4:
            a=ease((t-2)/.8)
            for x in (94,945):
                ImageDraw.Draw(im).rounded_rectangle((x+19,674,x+754,746),radius=10,outline=CORAL,width=round(1+2*a))
    elif key=='limits':
        text(im,'Make the assumptions explicit.',94,215,76,WHITE,700,t,.1)
        labels=[('$1,000','Pilot budget'),('$60','Target-market CPM cap'),('3','Minimum placements')]
        for i,(val,lab) in enumerate(labels):
            x=94+i*586
            a=ease((t-.5-i*.22)/.6)
            yy=400+(1-a)*35
            panel(im,(x,yy,x+558,yy+338))
            text(im,val,x+32,yy+51,107,TEAL,700,t,.5+i*.22)
            text(im,lab,x+34,yy+219,30,WHITE,500,t,.8+i*.22)
        pill(im,'SCENARIO · INVENTED PRICES AND DELIVERY',94,827,CORAL,'#35251f',24)
    elif key=='baseline':
        text(im,'Check the whole commitment.',94,214,80,WHITE,700,t,.1)
        panel(im,(94,365,1120,806))
        text(im,'HOME COOKING',128,401,26,TEAL,600,t,.5)
        text(im,'$200  ×  3',124,482,102,WHITE,700,t,1)
        text(im,'= $600',124,613,88,TEAL,700,t,2.2)
        pill(im,'FITS ENTERED LIMITS',689,661,size=24)
        panel(im,(1160,365,1826,806),'#0d1a2b')
        text(im,'THE SPORKFUL',1194,402,26,MUTED,600,t,.8)
        text(im,'$450',1190,490,101,WHITE,700,t,1.8)
        text(im,'Lower package cost',1194,629,31,MUTED,500,t,3)
        text(im,'Taste + popularity agree here.',1194,698,26,TEAL,500,t,4)
        pill(im,'SCENARIO · INVENTED TERMS',94,862,CORAL,'#35251f',23)
    elif key=='change':
        text(im,'A small change. A new decision.',94,212,78,WHITE,700,t,.1)
        panel(im,(94,352,636,826))
        text(im,'PRICE / PLACEMENT',126,393,24,MUTED,600,t,.2)
        text(im,'$200',122,457,96,'#597084',600,t,.3)
        line(im,(126,511,354,511),CORAL,4)
        text(im,'$220',122,579,105,CORAL,700,t,.9)
        pill(im,'Review clears',126,732,CORAL,'#35251f',25)
        shot(im,'04-price-change',(190,10,1212,380),(685,352,1141,414),t,.4)
        pill(im,'REVIEW AGAIN → THE SPORKFUL',686,804,size=24)
        screen_frame(im,'Real app capture · scenario terms',t)
    elif key=='ceiling':
        text(im,'Turn the result into a question.',94,214,78,WHITE,700,t,.1)
        text(im,'Can the package deliver',96,365,47,MUTED,500,t,.3)
        text(im,'11,000',88,447,180,TEAL,700,t,.9)
        text(im,'target-market ad impressions?',96,653,51,WHITE,600,t,1.4)
        panel(im,(1160,380,1826,762))
        text(im,'$660 package',1194,426,47,WHITE,600,t,.8)
        text(im,'÷ 11,000 impressions',1194,503,39,MUTED,500,t,1.4)
        line(im,(1194,572,1792,572))
        text(im,'$60 CPM',1194,615,67,TEAL,700,t,2)
        pill(im,'SCENARIO · NEGOTIATION THRESHOLD, NOT A SALES FORECAST',94,850,CORAL,'#35251f',23)
    elif key=='unknown':
        text(im,'Unknown stays unknown.',94,212,84,WHITE,700,t,.1)
        shot(im,'05-unknown-terms',(191,5,1211,600),(94,349,1100,642),t,.5)
        panel(im,(1231,350,1826,854))
        for j,(num,lab) in enumerate([('01','Ask the publisher'),('02','Review the source'),('03','Save the decision')]):
            text(im,num,1267,391+j*135,25,TEAL,600,t,.7+j*.7)
            text(im,lab,1267,436+j*135,34,WHITE,600,t,1+j*.7)
        panel(im,(76,860,1210,1005),INK,INK,0)
        pill(im,'ACTUAL QUOTE MODE · NOTHING SENT OR BOOKED',94,884,size=23)
    elif key=='proof':
        text(im,'Does taste carry a signal?',94,213,85,WHITE,700,t,.1)
        text(im,'Historical sponsor labels · 216 shows · 62 brands',96,330,31,MUTED,500,t,.5)
        graph(im,'Qloo taste',65,96,440,1435,TEAL,t,1.2)
        graph(im,'Chart rank',52,96,640,1435,'#72849c',t,3.1)
        # Same 0–100% scale; no truncated axis or invented uplift.
        text(im,'0',96,789,22,MUTED)
        text(im,'100%',1464,789,22,MUTED)
        pill(im,'Detected sponsorship ranked above an undetected relationship',94,846,size=24)
        text(im,'Missing labels ≠ no advertising. Association ≠ conversion lift.',96,908,29,CORAL,500,t,4.5)
    elif key=='limitsproof':
        text(im,'The agent works. Code checks it.',94,213,80,WHITE,700,t,.1)
        text(im,'Recorded Qloo run · 27 Oct · coffee subscription, Austin',96,330,30,MUTED,500,t,.4)
        steps=[('search','"Blue Bottle Coffee"','5 Qloo entities'),('search','"Blue Bottle Coffee" · brand','5 Qloo entities'),('podcasts','its fans · restaurants and coffee','20 shows ranked'),('draft_outreach','Home Cooking · The Sporkful','2 rate requests')]
        for i,(tool,arg,res) in enumerate(steps):
            y=402+i*92;d=.7+i*.55
            panel(im,(94,y,1826,y+76),fill='#0d1a2c',r=16)
            text(im,f'{i+1:02}',124,y+20,30,MUTED,600,t,d)
            text(im,tool,200,y+18,34,TEAL,600,t,d)
            text(im,arg,560,y+20,31,WHITE,500,t,d+.1)
            text(im,res,1500,y+20,31,WHITE,600,t,d+.2)
        pill(im,'CODE CHECKS · rival exclusions · ended shows · draft claims',94,792,size=24)
        text(im,'Locked test: agent 21, popularity 25 sponsorships. Ranking stays with Qloo and rules.',96,862,30,CORAL,500,t,4.2)
    return im


async def prepare():
    scenes=json.loads(SCRIPT.read_text('utf8'))
    cursor=0
    for i,s in enumerate(scenes):
        path=OUT/f'voice-{i:02}.mp3'
        timing=OUT/f'voice-{i:02}.json'
        if path.exists() and timing.exists() and json.loads(timing.read_text()).get('text')==s['text']:
            words=json.loads(timing.read_text())['words']
        else:
            words=[]
            stream=edge_tts.Communicate(s['text'],'en-US-AndrewMultilingualNeural',rate='+2%',pitch='+0Hz',boundary='WordBoundary')
            with path.open('wb') as f:
                async for chunk in stream.stream():
                    if chunk['type']=='audio':f.write(chunk['data'])
                    elif chunk['type']=='WordBoundary':words.append({'t':chunk['offset']/1e7,'d':chunk['duration']/1e7,'word':chunk['text']})
            timing.write_text(json.dumps({'text':s['text'],'words':words},indent=2),'utf8')
        duration=math.ceil((probe(path)+1.0)*FPS)/FPS
        s.update(start=cursor,seconds=duration,words=words,voice=path.name)
        cursor+=duration
        print(s['key'],round(duration,2),flush=True)
    (OUT/'timeline.json').write_text(json.dumps({'introSeconds':INTRO,'bodySeconds':cursor,'durationSeconds':cursor+INTRO,'scenes':scenes},indent=2)+'\n','utf8')


def caption_chunks(s):
    toks=s['text'].split()
    words=s['words']
    # WordBoundary tokenisation is independent of punctuation. Retain source text when aligned.
    if len(toks)!=len(words):toks=[w['word'] for w in words]
    chunks=[];group=[]
    for i,(tok,w) in enumerate(zip(toks,words)):
        group.append((tok,w))
        if tok.endswith(('.', '?', '!')) or len(group)>=8 or i==len(words)-1:
            chunks.append((.35+group[0][1]['t'],.35+w['t']+w['d']+.16,' '.join(p[0] for p in group)))
            group=[]
    return chunks


def captions(im,s,t):
    c=next((txt for start,end,txt in caption_chunks(s) if start<=t<end),None)
    if c:
        ti=text_image(c,34,WHITE,500)
        if ti.width>1700:ti=text_image(c,30,WHITE,500)
        x=(W-ti.width)/2
        panel(im,(x-23,944,x+ti.width+23,944+ti.height+28),'#050a13','#050a13',12)
        paste(im,ti,x,957)


def frame(s,t,index,caption=True):
    im=scene(s['key'],t,s['seconds'],index+1)
    if caption:captions(im,s,t)
    if s['key'] not in ('question','close'):
        ImageDraw.Draw(im).rectangle((94,1004,94+1732*(index+t/s['seconds'])/11,1007),fill=TEAL)
        text(im,'QLOO AGENTIC HACKATHON  /  27 OCT 2026',94,1025,19,MUTED)
        text(im,'Edited UI captures · synthetic narration',1410,1025,18,MUTED)
    return im.convert('RGB')


def stills():
    tl=json.loads((OUT/'timeline.json').read_text())
    for i,s in enumerate(tl['scenes']):
        frame(s,min(5,s['seconds']*.6),i).save(OUT/f'review-{i:02}-{s["key"]}.png')
    # Second direction considered, an editorial light board using the same information.
    im=Image.new('RGBA',(W,H),'#f4f1e8')
    text(im,'TASTE BRIEF / DIRECTION B',100,80,26,'#175b50',600)
    text(im,'Great fit.\nAt what price?',94,250,132,'#172a31',700)
    line(im,(1020,250,1020,838),'#a1b0a7',2)
    text(im,'$200 × 3',1110,320,80,'#172a31',600)
    text(im,'$600',1107,450,145,'#175b50',700)
    text(im,'The whole commitment.\nAgainst your limits.',1110,680,38,'#52665c')
    im.convert('RGB').save(OUT/'direction-b-editorial.png')
    print('11 scene proofs and direction B ready',flush=True)


def render():
    tl=json.loads((OUT/'timeline.json').read_text())
    proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-threads','4',str(OUT/'body-silent.mp4')],stdin=subprocess.PIPE)
    for i,s in enumerate(tl['scenes']):
        n=round(s['seconds']*FPS)
        for j in range(n):
            im=frame(s,j/FPS,i)
            # A brief dissolve from the previous scene avoids slideshow-like hard cuts.
            if i and j<10:
                prev=frame(tl['scenes'][i-1],tl['scenes'][i-1]['seconds']-.02,i-1,False)
                im=Image.blend(prev,im,ease(j/10))
            proc.stdin.write(im.tobytes())
        print('rendered',s['key'],n,'frames',flush=True)
    proc.stdin.close()
    if proc.wait()!=0:raise RuntimeError('FFmpeg failed')


def audio():
    tl=json.loads((OUT/'timeline.json').read_text())
    sr=48000;dur=tl['bodySeconds'];n=math.ceil(dur*sr)
    bed=np.zeros(n,dtype=np.float64)
    # Original restrained ambient score, no third-party music or licensed recordings.
    chords=[(146.83,220,293.66),(130.81,196,261.63),(164.81,220,329.63),(130.81,196,293.66)]
    for start in np.arange(0,dur,8):
        length=min(12,dur-start);count=int(length*sr);t=np.arange(count)/sr
        env=np.minimum(1,t/1.5)*np.minimum(1,np.maximum(0,(length-t)/3))
        tone=sum(np.sin(2*np.pi*f*t+.13*np.sin(2*np.pi*.09*t))+.18*np.sin(2*np.pi*f*2*t) for f in chords[int(start/8)%4])/4
        k=round(start*sr);bed[k:k+count]+=tone[:min(count,n-k)]*env[:min(count,n-k)]*.035
    # Very soft transition air, synthesized from deterministic noise.
    rng=np.random.default_rng(32)
    for s in tl['scenes'][1:]:
        start=max(0,s['start']-.2);count=int(.55*sr);k=int(start*sr)
        noise=rng.normal(0,1,count);smooth=np.convolve(noise,np.ones(24)/24,'same')
        vals=smooth*np.sin(np.linspace(0,np.pi,count))**2*.018
        bed[k:min(n,k+count)]+=vals[:max(0,min(count,n-k))]
    bed*=np.minimum(1,np.arange(n)/sr/1.5)*np.minimum(1,np.maximum(0,(dur-np.arange(n)/sr)/2))
    pcm=(np.clip(bed,-1,1)*32767).astype('<i2')
    with wave.open(str(OUT/'score.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes(pcm.tobytes())
    inputs=[];filters=[]
    for i,s in enumerate(tl['scenes']):
        inputs+=['-i',str(OUT/s['voice'])]
        delay=round((s['start']+.35)*1000)
        filters.append(f'[{i}:a]aresample=48000,adelay={delay}:all=1[v{i}]')
    m=len(tl['scenes']);inputs+=['-i',str(OUT/'score.wav')]
    filters.append(''.join(f'[v{i}]' for i in range(m))+f'amix=inputs={m}:normalize=0,apad,atrim=0:{dur},asplit=2[voice][key]')
    filters.append(f'[{m}:a][key]sidechaincompress=threshold=0.025:ratio=5:attack=40:release=500[music]')
    filters.append(f'[voice][music]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=8,apad,atrim=0:{dur}[a]')
    run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(filters),'-map','[a]','-ar','48000','-c:a','aac','-b:a','192k',OUT/'body-audio.m4a'])


def srt_stamp(x):
    n=round(x*1000)
    return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'


def assemble():
    tl=json.loads((OUT/'timeline.json').read_text())
    run(['ffmpeg','-y','-v','error','-i',ASSETS/'intro-source.mp4','-t',INTRO,'-vf',"drawtext=text='Illustrative AI opening':fontfile='C\\:/Windows/Fonts/segoeui.ttf':fontsize=22:fontcolor=0xa5b6ce:x=96:y=1018,scale=in_range=pc:out_range=tv,fade=t=out:st=4.8:d=0.2",'-af','afade=t=out:st=4.8:d=0.2,loudnorm=I=-16:TP=-1.5:LRA=8','-r',FPS,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg','-c:a','aac','-ar','48000','-ac','2',OUT/'intro.mp4'])
    run(['ffmpeg','-y','-v','error','-i',OUT/'body-silent.mp4','-i',OUT/'body-audio.m4a','-c:v','copy','-c:a','aac','-ar','48000','-ac','2','-shortest',OUT/'body.mp4'])
    (OUT/'concat.txt').write_text("file 'intro.mp4'\nfile 'body.mp4'\n")
    run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',OUT/'concat.txt','-c','copy','-movflags','+faststart',OUT/'taste-brief-v33.mp4'])
    caps=[(2.6,4.9,'Which podcast should we sponsor?')]
    for s in tl['scenes']:
        caps.extend((INTRO+s['start']+a,INTRO+s['start']+b,txt) for a,b,txt in caption_chunks(s))
    (OUT/'taste-brief-v33.en.srt').write_text('\n\n'.join(f'{i+1}\n{srt_stamp(a)} --> {srt_stamp(b)}\n{txt}' for i,(a,b,txt) in enumerate(caps))+'\n','utf8')
    print('Final seconds',probe(OUT/'taste-brief-v33.mp4'),flush=True)


if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='prepare':asyncio.run(prepare())
    elif mode=='stills':stills()
    elif mode=='render':render()
    elif mode=='audio':audio()
    elif mode=='assemble':assemble()
    else:raise SystemExit('prepare|stills|render|audio|assemble')
