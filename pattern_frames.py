"""Pure spatial animation frames, with bounded rates and WiZ-safe dimming."""
import colorsys
import math

ANIMATIONS = {
    'gradient': 'Travelling Gradient', 'chase': 'Light Chase',
    'bounce': 'Bounce Scanner', 'comet': 'Comet Trail',
    'aurora-flow': 'Aurora Flow', 'breathe': 'Room Breathing',
    'strobe': 'Room Strobe', 'alternating': 'Alternating Strobe',
}
PALETTES = {
    'neon': [(255,20,150),(20,210,255),(120,35,255),(255,70,200)],
    'sunset': [(255,55,25),(255,175,45),(210,35,95),(255,110,55)],
    'ocean': [(15,50,220),(10,190,230),(35,220,160),(70,65,240)],
}

def validate_options(options=None):
    if options is None: options={}
    if not isinstance(options,dict) or any(key not in ('speed','brightness','reverse','palette') for key in options):
        raise ValueError('Invalid animation options')
    result={'speed':50,'brightness':65,'reverse':False,'palette':'rainbow',**options}
    for key,lo,hi in (('speed',10,100),('brightness',10,100)):
        if type(result[key]) is not int or not lo<=result[key]<=hi:
            raise ValueError(f'Choose {key} between {lo} and {hi}')
    if type(result['reverse']) is not bool or result['palette'] not in ('rainbow',*PALETTES):
        raise ValueError('Choose a known palette and direction')
    return result

def color_at(phase,palette):
    phase%=1
    if palette=='rainbow':return tuple(round(v*255) for v in colorsys.hsv_to_rgb(phase,.92,1))
    colors=PALETTES[palette];position=phase*len(colors);i=int(position);mix=position-i
    return tuple(round(a+(b-a)*mix) for a,b in zip(colors[i],colors[(i+1)%len(colors)]))

def animation_frames(mode,elapsed,count,speed=50,brightness=65,reverse=False,palette='rainbow'):
    if mode not in ANIMATIONS or not 2<=count<=16:raise ValueError('Choose an animation and 2–16 lights')
    options=validate_options(dict(speed=speed,brightness=brightness,reverse=reverse,palette=palette))
    # Speed is movement rate; strobe separately caps at 3 flashes per second.
    rate=.2+options['speed']/100*1.8
    phase=max(0,elapsed)*rate
    frames=[]
    for i in range(count):
        level=1.;on=True;color_phase=(i/count-phase*.12)%1
        if mode in ('chase','comet'):
            head=phase%count;distance=(head-i)%count
            if mode=='chase':
                distance=min(distance,count-distance);level=.025+.975*max(0,1-distance)**2
            else:level=.025+.975*math.exp(-distance*1.8)
            color_phase=(phase*.07+i/count*.16)%1
        elif mode=='bounce':
            position=phase%(2*(count-1));head=position if position<count-1 else 2*(count-1)-position
            level=.025+.975*math.exp(-((i-head)/.6)**2);color_phase=.5+phase*.025
        elif mode=='aurora-flow':
            color_phase=.35+.25*math.sin(phase*.3-i*.5)
            level=.35+.65*(.5+.5*math.sin(phase*.8-i*.9))
        elif mode=='breathe':
            level=.08+.92*(.5-.5*math.cos(phase*math.tau*.18))
            color_phase=phase*.025+i/count*.12
        elif mode in ('strobe','alternating'):
            flash_phase=elapsed*(.5+speed/100*2.5)%1
            on=flash_phase<.38 if mode=='strobe' else (i%2==0)==(flash_phase<.5)
            color_phase=phase*.04 if mode=='strobe' else i/count
        color=color_at(color_phase,palette)
        requested=brightness*level
        # Preserve visibly dim trails on firmware with a 10% dimming floor.
        scale=min(1,requested/10)
        r,g,b=(round(channel*scale) for channel in color)
        frames.append({'state':on,'r':r,'g':g,'b':b,'w':0,'c':0,
                       'dimming':max(10,round(requested)),
                       'fadeIn':0 if mode in ('strobe','alternating') else 100,'fadeOut':0})
    return list(reversed(frames)) if reverse else frames
