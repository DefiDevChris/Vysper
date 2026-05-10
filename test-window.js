const { app, BrowserWindow } = require('electron');

console.log('Electron app starting...');

app.whenReady().then(() => {
  console.log('App ready, creating window...');
  
  const win = new BrowserWindow({
    width: 600,
    height: 450,
    show: true,
    backgroundColor: '#1a1a2e',
    title: 'Vysper Test Window',
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });
  
  win.loadFile('index.html').then(() => {
    console.log('Window loaded successfully!');
    console.log('Window position:', win.getPosition());
    console.log('Window size:', win.getSize());
    console.log('Is visible:', win.isVisible());
  }).catch(err => {
    console.error('Failed to load:', err);
  });
  
  win.on('closed', () => {
    console.log('Window closed');
    process.exit(0);
  });
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  app.quit();
});
