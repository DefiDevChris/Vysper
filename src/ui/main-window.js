class VysperUI {
  constructor() {
    this.capturedImages = [];
    this.isCapturing = false;
    this.currentSkill = 'general';
    this.availableScreens = [];
    this.selectedScreenId = null;
    this.init();
  }

  init() {
    this.cacheElements();
    this.setupListeners();
    this.setupHotkeys();
    this.refreshScreens();
    this.addMessage('Vysper ready. Select a screen and press F6 to capture.', 'system');
  }

  cacheElements() {
    this.thumbnails = document.getElementById('thumbnails');
    this.queueInfo = document.getElementById('queueInfo');
    this.chat = document.getElementById('chat');
    this.textInput = document.getElementById('textInput');
    this.skillSelect = document.getElementById('skillSelect');
    this.screenSelect = document.getElementById('screenSelect');
    this.captureStatus = document.getElementById('captureStatus');
    this.analyzeStatus = document.getElementById('analyzeStatus');
    this.typeStatus = document.getElementById('typeStatus');

    document.getElementById('captureBtn').onclick = () => this.capture();
    document.getElementById('analyzeBtn').onclick = () => this.analyze();
    document.getElementById('typeBtn').onclick = () => this.type();
    document.getElementById('cancelBtn').onclick = () => this.cancel();
    document.getElementById('clearBtn').onclick = () => this.clear();
    document.getElementById('sendBtn').onclick = () => this.sendText();
    document.getElementById('refreshScreensBtn').onclick = () => this.refreshScreens();
    this.textInput.onkeypress = (e) => { if (e.key === 'Enter') this.sendText(); };
    this.skillSelect.onchange = (e) => this.setSkill(e.target.value);
    this.screenSelect.onchange = (e) => { this.selectedScreenId = e.target.value; };
  }

  async refreshScreens() {
    try {
      if (!window.electronAPI?.getScreenSources) {
        this.addMessage('Screen detection not available', 'system');
        return;
      }
      
      const sources = await window.electronAPI.getScreenSources();
      
      this.availableScreens = sources;
      this.screenSelect.innerHTML = sources.map((s, i) => 
        `<option value="${s.id}">${s.name.substring(0, 40)}</option>`
      ).join('');
      
      // Select second screen by default (index 1), fallback to first screen
      if (sources.length > 0) {
        const defaultScreen = sources[1] || sources[0];
        this.selectedScreenId = defaultScreen.id;
        this.screenSelect.value = defaultScreen.id;
      }
      
      this.addMessage(`Found ${sources.length} screen(s)`, 'system');
    } catch (err) {
      console.error('Failed to refresh screens:', err);
      this.addMessage('Failed to detect screens', 'system');
    }
  }

  setupListeners() {
    if (!window.electronAPI) return;

    window.electronAPI.onTriggerStreamCapture(() => this.capture());
    window.electronAPI.onTriggerAnalyze(() => this.analyze());
    window.electronAPI.onDisplayLlmResponse((_, data) => {
      this.analyzeStatus.classList.remove('active');
      if (data?.content) {
        if (data.metadata?.usedFallback) {
          this.addMessage('⚠️ ' + data.content, 'system');
        } else {
          this.addMessage(data.content, 'assistant');
        }
        this.capturedImages = [];
        this.updateThumbnails();
      }
      if (data?.error) {
        this.addMessage('Error: ' + data.error, 'system');
      }
    });
    window.electronAPI.onShowLoading(() => {
      this.analyzeStatus.classList.add('active');
      this.addMessage('Analyzing...', 'system');
    });
    window.electronAPI.onSkillChanged((_, d) => {
      if (d?.skill) {
        this.currentSkill = d.skill;
        this.skillSelect.value = d.skill;
      }
    });
    window.electronAPI.onSessionCleared(() => {
      this.capturedImages = [];
      this.updateThumbnails();
      this.addMessage('Session memory cleared', 'system');
    });
  }

  setupHotkeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'F6':
          e.preventDefault();
          this.capture();
          break;
        case 'F7':
          e.preventDefault();
          this.analyze();
          break;
        case 'F8':
          e.preventDefault();
          this.type();
          break;
        case 'F9':
          e.preventDefault();
          this.cancel();
          break;
        case 'F10':
          e.preventDefault();
          this.clear();
          break;
      }
    });
  }

  async capture() {
    if (this.isCapturing) return;
    if (!this.selectedScreenId) {
      this.addMessage('No screen selected. Click Refresh Screens first.', 'system');
      return;
    }

    this.isCapturing = true;
    this.captureStatus.classList.add('active');

    try {
      // Use Electron's desktopCapturer to get the specific screen
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: this.selectedScreenId,
            minWidth: 1280,
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160
          }
        }
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise(r => {
        if (video.readyState >= 3) r();
        else video.onloadeddata = r;
      });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      stream.getTracks().forEach(t => t.stop());

      this.capturedImages.push(dataUrl);
      this.updateThumbnails();
      
      const screenName = this.availableScreens.find(s => s.id === this.selectedScreenId)?.name || 'Screen';
      this.addMessage(`Captured: ${screenName.substring(0, 30)}`, 'system');
    } catch (err) {
      console.error('Capture failed:', err);
      this.addMessage(`Capture failed: ${err.message}`, 'system');
    } finally {
      this.isCapturing = false;
      this.captureStatus.classList.remove('active');
    }
  }

  updateThumbnails() {
    this.thumbnails.innerHTML = '';
    this.capturedImages.forEach((img, i) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      div.innerHTML = `
        <img src="${img}">
        <div class="remove" onclick="ui.removeImage(${i})">×</div>
      `;
      this.thumbnails.appendChild(div);
    });
    this.queueInfo.textContent = `${this.capturedImages.length} image${this.capturedImages.length !== 1 ? 's' : ''}`;
  }

  removeImage(index) {
    this.capturedImages.splice(index, 1);
    this.updateThumbnails();
  }

  async analyze() {
    console.log('Analyze clicked, images:', this.capturedImages.length);
    if (!this.capturedImages.length) {
      this.addMessage('No images to analyze', 'system');
      return;
    }
    if (!window.electronAPI) {
      this.addMessage('electronAPI not available', 'system');
      return;
    }

    this.analyzeStatus.classList.add('active');
    this.addMessage('Sending to LLM...', 'system');
    try {
      const result = await window.electronAPI.processScreenshotData({
        imageQueue: [...this.capturedImages]
      });
      console.log('Analyze result:', result);
      if (!result.success) {
        this.addMessage('Analysis failed: ' + (result.error || 'Unknown error'), 'system');
        this.analyzeStatus.classList.remove('active');
      }
    } catch (err) {
      console.error('Analyze failed:', err);
      this.addMessage('Analysis error: ' + err.message, 'system');
      this.analyzeStatus.classList.remove('active');
    }
  }

  async type() {
    if (!window.electronAPI) return;
    this.typeStatus.classList.add('active');
    try {
      await window.electronAPI.startAutotype();
    } catch (err) {
      console.error('Type failed:', err);
    } finally {
      setTimeout(() => this.typeStatus.classList.remove('active'), 500);
    }
  }

  async cancel() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.cancelAutotype();
    } catch (err) {}
  }

  async clear() {
    console.log('Clear clicked');
    if (!window.electronAPI) {
      this.addMessage('electronAPI not available', 'system');
      return;
    }
    try {
      await window.electronAPI.clearSessionMemory();
      this.capturedImages = [];
      this.updateThumbnails();
      this.addMessage('Cleared', 'system');
    } catch (err) {
      console.error('Clear failed:', err);
      this.addMessage('Clear failed: ' + err.message, 'system');
    }
  }

  async sendText() {
    const text = this.textInput.value.trim();
    if (!text || !window.electronAPI) return;
    this.addMessage(text, 'user');
    this.textInput.value = '';
    try {
      await window.electronAPI.sendChatMessage(text);
    } catch (err) {}
  }

  async setSkill(skill) {
    this.currentSkill = skill;
    if (window.electronAPI) {
      await window.electronAPI.updateActiveSkill(skill);
    }
  }

  addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    if (type === 'assistant') {
      div.innerHTML = this.markdown(text);
    } else {
      div.textContent = text;
    }
    this.chat.appendChild(div);
    this.chat.scrollTop = this.chat.scrollHeight;
  }

  markdown(text) {
    return text
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }
}

window.ui = new VysperUI();
