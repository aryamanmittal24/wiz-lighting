import './music-dsp.js';
class MusicProcessor extends AudioWorkletProcessor {
  constructor(){super();this.detector=new MusicDSP.Detector(sampleRate);this.micSum=0;this.refSum=0;this.samples=0;}
  process(inputs,outputs){
    // Zero output keeps analysis running without replaying captured audio.
    const input=inputs[0],mic=inputs[1];if(!input?.length)return true;
    for(let i=0;i<input[0].length;i++){
      let value=0;for(const channel of input)value+=channel[i]/input.length;
      const m=mic?.[0]?.[i]||0;this.refSum+=value*value;this.micSum+=m*m;this.samples++;
      const result=this.detector.push(value,(currentFrame+i)/sampleRate);
      if(result){this.port.postMessage({...result,refEnvelope:Math.sqrt(this.refSum/this.samples),micEnvelope:Math.sqrt(this.micSum/this.samples)});this.refSum=0;this.micSum=0;this.samples=0;}
    }
    return true;
  }
}
registerProcessor('music-detector',MusicProcessor);
