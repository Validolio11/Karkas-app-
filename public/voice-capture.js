class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.port.postMessage({ samples: this.buffer.slice(0, this.offset), flushed: true });
        this.offset = 0;
      }
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const sample of input) {
        this.buffer[this.offset++] = sample;
        if (this.offset === this.buffer.length) {
          this.port.postMessage({ samples: this.buffer, flushed: false });
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
