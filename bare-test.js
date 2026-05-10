const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();

console.log('Creating bare minimum window...');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    title: 'Vysper Test',
    backgroundColor: '#ff0000'  // Bright red background
  });
  
  win.loadURL('data:text/html,<h1 style="color:white;background:red;padding:50px;">VYSPER VISIBLE TEST</h1>');
  
  console.log('Window created, should be visible');
  console.log('Position:', win.getPosition());
  console.log('Size:', win.getSize());
  console.log('Visible:', win.isVisible());
  console.log('ID:', win.id);
});

setTimeout(() => process.exit(0), 10000);
