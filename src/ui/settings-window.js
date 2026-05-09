document.addEventListener('DOMContentLoaded', () => {    
    // Get DOM elements
    const closeButton = document.getElementById('closeButton');
    const quitButton = document.getElementById('quitButton');
    const nvidiaKeyInput = document.getElementById('nvidiaKey');
    const autotypeDelayInput = document.getElementById('autotypeDelay');
    const autotypeWpmInput = document.getElementById('autotypeWpm');
    const testNvidiaBtn = document.getElementById('testNvidiaBtn');
    const windowGapInput = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
    const activeSkillSelect = document.getElementById('activeSkill');
    const iconGrid = document.getElementById('iconGrid');

    if (!window.api) {
        console.error('window.api not available');
        return;
    }

    const requestCurrentSettings = () => {
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings().then(settings => {
                loadSettingsIntoUI(settings);
            }).catch(error => {
                console.error('Failed to get settings:', error);
            });
        }
    };

    // Close button handler
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            window.api.send('close-settings');
        });
    }

    // Quit button handler
    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                if (window.api && window.api.send) {
                    window.api.send('quit-app');
                }
                
                if (window.electronAPI && window.electronAPI.quit) {
                    window.electronAPI.quit();
                }
                
                setTimeout(() => {
                    window.close();
                }, 500);
                
            } catch (error) {
                console.error('Error quitting app:', error);
                window.close();
            }
        });
    }

    // Test NVIDIA connection
    if (testNvidiaBtn) {
        testNvidiaBtn.addEventListener('click', async () => {
            testNvidiaBtn.textContent = 'Testing...';
            testNvidiaBtn.disabled = true;
            
            try {
                // Save key first if entered
                if (nvidiaKeyInput && nvidiaKeyInput.value.trim()) {
                    await window.electronAPI.setNvidiaApiKey(nvidiaKeyInput.value.trim());
                }
                
                const result = await window.electronAPI.testNvidiaConnection();
                
                if (result.success) {
                    testNvidiaBtn.textContent = 'Connected!';
                    testNvidiaBtn.style.background = 'rgba(76, 175, 80, 0.8)';
                    setTimeout(() => {
                        testNvidiaBtn.innerHTML = '<i class="fas fa-plug"></i> Test';
                        testNvidiaBtn.style.background = '';
                        testNvidiaBtn.disabled = false;
                    }, 3000);
                } else {
                    testNvidiaBtn.textContent = 'Failed';
                    testNvidiaBtn.style.background = 'rgba(244, 67, 54, 0.8)';
                    setTimeout(() => {
                        testNvidiaBtn.innerHTML = '<i class="fas fa-plug"></i> Test';
                        testNvidiaBtn.style.background = '';
                        testNvidiaBtn.disabled = false;
                    }, 3000);
                }
            } catch (error) {
                testNvidiaBtn.textContent = 'Error';
                testNvidiaBtn.style.background = 'rgba(244, 67, 54, 0.8)';
                setTimeout(() => {
                    testNvidiaBtn.innerHTML = '<i class="fas fa-plug"></i> Test';
                    testNvidiaBtn.style.background = '';
                    testNvidiaBtn.disabled = false;
                }, 3000);
            }
        });
    }

    // Load settings into UI
    const loadSettingsIntoUI = (settings) => {
        if (settings.nvidiaKey && nvidiaKeyInput) nvidiaKeyInput.value = settings.nvidiaKey;
        if (settings.autotypeDelay && autotypeDelayInput) autotypeDelayInput.value = settings.autotypeDelay;
        if (settings.autotypeWpm && autotypeWpmInput) autotypeWpmInput.value = settings.autotypeWpm;
        if (settings.windowGap && windowGapInput) windowGapInput.value = settings.windowGap;
        if (settings.codingLanguage && codingLanguageSelect) codingLanguageSelect.value = settings.codingLanguage;
        if (settings.activeSkill && activeSkillSelect) activeSkillSelect.value = settings.activeSkill;
        
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            const iconOptions = iconGrid.querySelectorAll('.icon-option');
            iconOptions.forEach(option => {
                if (option.dataset.icon === selectedIcon) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });
        }
    };

    // Load settings when window opens
    window.api.receive('load-settings', (settings) => {
        loadSettingsIntoUI(settings);
    });

    if (window.electronAPI && window.electronAPI.receive) {
        window.electronAPI.receive('settings-window-shown', () => {
            requestCurrentSettings();
        });
    }

    // Save settings helper function
    const saveSettings = () => {
        const settings = {};
        if (nvidiaKeyInput) settings.nvidiaKey = nvidiaKeyInput.value;
        if (autotypeDelayInput) settings.autotypeDelay = autotypeDelayInput.value;
        if (autotypeWpmInput) settings.autotypeWpm = autotypeWpmInput.value;
        if (windowGapInput) settings.windowGap = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (activeSkillSelect) settings.activeSkill = activeSkillSelect.value;
        
        window.api.send('save-settings', settings);
    };

    // Add event listeners for all inputs
    const inputs = [
        nvidiaKeyInput,
        autotypeDelayInput,
        autotypeWpmInput,
        windowGapInput
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveSettings);
            input.addEventListener('blur', saveSettings);
        }
    });

    // Language selection handler
    if (codingLanguageSelect) {
        codingLanguageSelect.addEventListener('change', () => {
            saveSettings();
        });
    }

    // Skill selection handler
    if (activeSkillSelect) {
        activeSkillSelect.addEventListener('change', (e) => {
            saveSettings();
            window.api.send('update-skill', e.target.value);
        });
    }

    // Initialize icon grid
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity', src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings', src: './assests/icons/settings.png' }
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const iconElement = document.createElement('div');
            iconElement.className = 'icon-option';
            iconElement.dataset.icon = icon.key;
            
            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = icon.name;
            img.onerror = () => {
                img.style.display = 'none';
            };
            
            const label = document.createElement('div');
            label.textContent = icon.name;
            
            iconElement.appendChild(img);
            iconElement.appendChild(label);
            
            iconElement.addEventListener('click', () => {                
                iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                iconElement.classList.add('selected');
                window.api.send('save-settings', { selectedIcon: icon.key });
                
                iconElement.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    iconElement.style.transform = 'scale(1)';
                }, 100);
            });
            
            iconGrid.appendChild(iconElement);
        });
    };

    initializeIconGrid();

    // Request settings on load
    setTimeout(() => {
        requestCurrentSettings();
    }, 200);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.api.send('close-settings');
        }
    });
}); 
