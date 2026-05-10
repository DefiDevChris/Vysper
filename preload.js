const { contextBridge, ipcRenderer, desktopCapturer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Desktop capture
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  
  // Screenshot
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  processScreenshotData: (data) => ipcRenderer.invoke('process-screenshot-data', data),
  
  // Auto-type
  startAutotype: (text, delay) => ipcRenderer.invoke('start-autotype', text, delay),
  cancelAutotype: () => ipcRenderer.invoke('cancel-autotype'),
  getAutotypeStatus: () => ipcRenderer.invoke('get-autotype-status'),
  setAutotypeDelay: (delay) => ipcRenderer.invoke('set-autotype-delay', delay),
  
  // Window management
  showAllWindows: () => ipcRenderer.invoke('show-all-windows'),
  hideAllWindows: () => ipcRenderer.invoke('hide-all-windows'),
  enableWindowInteraction: () => ipcRenderer.invoke('enable-window-interaction'),
  disableWindowInteraction: () => ipcRenderer.invoke('disable-window-interaction'),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  moveWindow: (dx, dy, key) => ipcRenderer.invoke('move-window', { deltaX: dx, deltaY: dy, windowKey: key }),
  getWindowStats: () => ipcRenderer.invoke('get-window-stats'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // Session
  clearSessionMemory: () => ipcRenderer.invoke('clear-session-memory'),
  
  // Chat
  sendChatMessage: (text) => ipcRenderer.invoke('send-chat-message', text),
  
  // NVIDIA
  setNvidiaApiKey: (key) => ipcRenderer.invoke('set-nvidia-api-key', key),
  getNvidiaStatus: () => ipcRenderer.invoke('get-nvidia-status'),
  testNvidiaConnection: () => ipcRenderer.invoke('test-nvidia-connection'),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  updateActiveSkill: (skill) => ipcRenderer.invoke('update-active-skill', skill),
  
  // Quit
  quit: () => ipcRenderer.send('quit-app'),
  
  // Events from main
  onOcrCompleted: (cb) => ipcRenderer.on('ocr-completed', cb),
  onOcrError: (cb) => ipcRenderer.on('ocr-error', cb),
  onLlmResponse: (cb) => ipcRenderer.on('llm-response', cb),
  onDisplayLlmResponse: (cb) => ipcRenderer.on('display-llm-response', cb),
  onShowLoading: (cb) => ipcRenderer.on('show-loading', cb),
  onSkillChanged: (cb) => ipcRenderer.on('skill-changed', cb),
  onSessionCleared: (cb) => ipcRenderer.on('session-cleared', cb),
  onAutotypeStatusChanged: (cb) => ipcRenderer.on('autotype-status-changed', cb),
  onTriggerStreamCapture: (cb) => ipcRenderer.on('trigger-stream-capture', cb),
  onTriggerAnalyze: (cb) => ipcRenderer.on('trigger-analyze', cb),
  
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
})
