// Logger that pipes to main process for better visibility in terminal
const logger = {
    info: (...args) => {
        console.log('[MainWindowUI]', ...args);
    },
    debug: (...args) => {
        console.debug('[MainWindowUI]', ...args);
    },
    error: (msg, meta) => {
        console.error('[MainWindowUI ERROR]', msg, meta);
        if (window.electronAPI && window.electronAPI.logErrorToMain) {
            window.electronAPI.logErrorToMain({ level: 'error', message: msg, meta });
        }
    },
    warn: (msg, meta) => {
        console.warn('[MainWindowUI WARN]', msg, meta);
        if (window.electronAPI && window.electronAPI.logErrorToMain) {
            window.electronAPI.logErrorToMain({ level: 'warn', message: msg, meta });
        }
    }
};

class MainWindowUI {
    constructor() {
        this.isInteractive = false;
        this.isHidden = false;
        this.currentSkill = 'general';
        this.statusDot = null;
        this.skillIndicator = null;
        this.captureButton = null;
        this.typeButton = null;
        this.isTyping = false;
        this.lastLLMResponse = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.capturedImages = [];
        this.sendButton = null;
        this.captureCountBadge = null;
        
        this.availableSkills = [
            'general',
            'programming',
            'dsa', 
            'system-design',
            'behavioral',
            'data-science',
            'sales',
            'presentation',
            'negotiation',
            'devops'
        ];
        
        this.init();
    }

    async init() {
        try {
            this.setupElements();
            this.setupEventListeners();
            
            await this.loadCurrentSkill();
            await this.loadCurrentInteractionState();
            
            this.updateSkillIndicator();
            this.updateAllElementStates();
            this.resizeWindowToContent();
            this.setupDragging();
            
            logger.info('UI initialized. Screen stream will be established on first capture request.');
            
        } catch (error) {
            logger.error('Failed to initialize main window UI', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadCurrentSkill() {
        try {
            if (window.electronAPI && window.electronAPI.getSettings) {
                const settings = await window.electronAPI.getSettings();
                if (settings && settings.activeSkill) {
                    this.currentSkill = settings.activeSkill;
                }
            }
        } catch (error) {
            // Silently fail
        }
    }

    async loadCurrentInteractionState() {
        try {
            if (window.electronAPI && window.electronAPI.getWindowStats) {
                const stats = await window.electronAPI.getWindowStats();
                if (stats && typeof stats.isInteractive === 'boolean') {
                    this.isInteractive = stats.isInteractive;
                }
            }
        } catch (error) {
            this.isInteractive = false;
        }
    }

    updateAllElementStates() {
        this.updateStatusDot();
        this.updateSkillIndicatorState();
        this.updateCaptureButtonState();
        this.updateTypeButtonState();
        this.updateSettingsIndicatorState();
    }

    updateStatusDot() {
        if (this.statusDot) {
            this.statusDot.classList.remove('interactive', 'non-interactive');
            if (this.isInteractive) {
                this.statusDot.classList.add('interactive');
            } else {
                this.statusDot.classList.add('non-interactive');
            }
        }
    }

    updateSkillIndicatorState() {
        if (this.skillIndicator) {
            this.skillIndicator.classList.remove('interactive', 'non-interactive');
            if (this.isInteractive) {
                this.skillIndicator.classList.add('interactive');
            } else {
                this.skillIndicator.classList.add('non-interactive');
            }
        }
    }

    updateCaptureButtonState() {
        if (this.captureButton) {
            this.captureButton.classList.remove('interactive', 'non-interactive', 'capturing');
            if (this.isCapturing) {
                this.captureButton.classList.add('capturing');
            }
        }
    }

    updateTypeButtonState() {
        if (this.typeButton) {
            this.typeButton.classList.remove('typing');
            if (this.isTyping) {
                this.typeButton.classList.add('typing');
            }
        }
    }

    updateSettingsIndicatorState() {
        if (this.settingsIndicator) {
            this.settingsIndicator.classList.remove('interactive', 'non-interactive');
            if (this.isInteractive) {
                this.settingsIndicator.classList.add('interactive');
            } else {
                this.settingsIndicator.classList.add('non-interactive');
            }
        }
    }

    resizeWindowToContent() {
        setTimeout(() => {
            const commandTab = document.querySelector('.command-tab');
            if (commandTab && window.electronAPI && window.electronAPI.resizeWindow) {
                const rect = commandTab.getBoundingClientRect();
                const width = Math.ceil(rect.width);
                const height = Math.ceil(rect.height);
                
                window.electronAPI.resizeWindow(width, height);
            }
        }, 100);
    }

    setupElements() {
        this.statusDot = document.getElementById('statusDot');
        this.skillIndicator = document.getElementById('skillIndicator');
        this.settingsIndicator = document.getElementById('settingsIndicator');
        this.captureButton = document.getElementById('captureButton');
        this.captureCountBadge = document.getElementById('captureCount');
        this.sendButton = document.getElementById('sendButton');
        this.typeButton = document.getElementById('typeButton');

        if (!this.statusDot || !this.skillIndicator || !this.captureButton || !this.typeButton) {
            throw new Error('Required UI elements not found');
        }

        // Add click handler for capture button (Queue)
        this.captureButton.addEventListener('click', () => {
            this.handleCaptureClick();
        });

        // Add click handler for send button (Process Queue)
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                this.handleSendClick();
            });
        }

        // Add click handler for type button
        this.typeButton.addEventListener('click', () => {
            this.handleTypeClick();
        });

        // Add click handler for settings (if element exists)
        if (this.settingsIndicator) {
            this.settingsIndicator.addEventListener('click', () => {
                if (this.isInteractive) {
                    this.showSettingsMenu();
                }
            });
        }
    }

    async setupScreenStream() {
        if (this.screenStream) {
            logger.info('Screen stream already active');
            return true;
        }

        if (this.isInitializingStream) {
            logger.info('Stream initialization already in progress');
            return false;
        }

        try {
            this.isInitializingStream = true;
            logger.info('Initializing persistent screen stream...');
            
            // On Wayland, we use standard getDisplayMedia. 
            // The main process setDisplayMediaRequestHandler will handle the source selection.
            logger.info('Requesting high-resolution screen capture stream...');
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 3840 },
                    height: { ideal: 2160 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            });
            
            logger.info('Screen stream successfully established', {
                id: stream.id,
                tracks: stream.getVideoTracks().length
            });

            this.screenStream = stream;
            
            // Monitor stream health
            stream.getVideoTracks()[0].onended = () => {
                logger.warn('Screen stream track ended', { 
                    label: stream.getVideoTracks()[0].label,
                    active: stream.getVideoTracks()[0].active,
                    readyState: stream.getVideoTracks()[0].readyState
                });
                this.screenStream = null;
            };

            // Setup hidden elements for capture
            if (!this.videoElement) {
                this.videoElement = document.createElement('video');
                this.videoElement.style.display = 'none';
                document.body.appendChild(this.videoElement);
            }
            this.videoElement.srcObject = stream;
            this.videoElement.play();

            if (!this.canvasElement) {
                this.canvasElement = document.createElement('canvas');
            }

            logger.info('Persistent screen stream established successfully');
            this.isInitializingStream = false;
            return true;
        } catch (error) {
            this.isInitializingStream = false;
            logger.error('Failed to setup screen stream', { error: error.message });
            return false;
        }
    }

    async captureFrame() {
        if (!this.screenStream || !this.screenStream.active) {
            logger.warn('Stream inactive, re-initializing...');
            const success = await this.setupScreenStream();
            if (!success) return null;
        }

        try {
            const video = this.videoElement;
            const canvas = this.canvasElement;
            
            // Wait for video to be ready
            if (video.readyState !== 4) {
                await new Promise(r => setTimeout(r, 100));
            }

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            return canvas.toDataURL('image/png');
        } catch (error) {
            logger.error('Frame capture failed', { error: error.message });
            return null;
        }
    }

    async handleCaptureClick() {
        if (this.isCapturing) return;
        
        this.isCapturing = true;
        this.updateCaptureButtonState();
        
        try {
            const dataUrl = await this.captureFrame();
            if (dataUrl) {
                // Add to queue instead of processing immediately
                this.capturedImages.push(dataUrl);
                this.updateCaptureQueueUI();
                logger.info(`Added screenshot to queue. Total: ${this.capturedImages.length}`);
            } else {
                throw new Error('Could not capture frame');
            }
        } catch (error) {
            logger.error('Capture failed', { error: error.message });
        } finally {
            this.isCapturing = false;
            this.updateCaptureButtonState();
        }
    }

    updateCaptureQueueUI() {
        if (this.captureCountBadge) {
            const count = this.capturedImages.length;
            if (count > 0) {
                this.captureCountBadge.textContent = count;
                this.captureCountBadge.style.display = 'flex';
                this.sendButton.classList.remove('disabled');
            } else {
                this.captureCountBadge.style.display = 'none';
                this.sendButton.classList.add('disabled');
            }
        }
    }

    async handleSendClick() {
        if (this.capturedImages.length === 0 || this.isProcessingQueue) return;

        this.isProcessingQueue = true;
        this.sendButton.classList.add('capturing'); // Use capturing class for animation
        
        try {
            logger.info(`Processing ${this.capturedImages.length} images...`);
            // Send the entire array to the main process
            await window.electronAPI.processScreenshotData({ 
                dataUrl: this.capturedImages[0], // Keep legacy for single image
                imageQueue: this.capturedImages   // Add the full queue
            });
            
            // Clear queue on success
            this.capturedImages = [];
            this.updateCaptureQueueUI();
        } catch (error) {
            logger.error('Failed to send image queue', { error: error.message });
        } finally {
            this.isProcessingQueue = false;
            this.sendButton.classList.remove('capturing');
        }
    }

    async handleTypeClick() {
        if (this.isTyping) {
            // Cancel auto-type
            try {
                if (window.electronAPI && window.electronAPI.cancelAutotype) {
                    await window.electronAPI.cancelAutotype();
                }
                this.isTyping = false;
                this.updateTypeButtonState();
            } catch (error) {
                logger.error('Cancel auto-type failed', { error: error.message });
            }
            return;
        }

        try {
            if (window.electronAPI && window.electronAPI.startAutotype) {
                this.isTyping = true;
                this.updateTypeButtonState();
                const result = await window.electronAPI.startAutotype(null, null);
                this.isTyping = false;
                this.updateTypeButtonState();
                
                if (result && result.success) {
                    // Auto-type completed successfully
                } else if (result && result.cancelled) {
                    // Auto-type was cancelled by user
                }
            }
        } catch (error) {
            this.isTyping = false;
            this.updateTypeButtonState();
            logger.error('Auto-type error', { error: error.message });
        }
    }

    setupEventListeners() {
        if (window.electronAPI) {
            window.electronAPI.onInteractionModeChanged((event, interactive) => {
                this.handleInteractionModeChanged(interactive);
            });

            window.electronAPI.onTriggerStreamCapture(async () => {
                logger.info('Received trigger-stream-capture event from main process');
                await this.handleStreamCaptureRequest();
            });

            window.electronAPI.onSkillChanged((event, data) => {
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                }
            });

            window.electronAPI.onLlmResponse((event, data) => {
                if (data && data.response) {
                    this.lastLLMResponse = data.response;
                }
            });
        }
        
        if (window.api) {
            window.api.receive('interaction-mode-changed', (interactive) => {
                this.handleInteractionModeChanged(interactive);
            });
            
            window.api.receive('skill-updated', (data) => {
                if (data && data.skill) {
                    this.handleSkillChanged(data);
                } else if (typeof data === 'string') {
                    this.handleSkillChanged({ skill: data });
                }
            });
            
            window.api.receive('update-skill', (skill) => {
                this.handleSkillChanged({ skill: skill });
            });
        }
        
        this.setupKeyboardShortcuts();
        this.setupSettingsShortcut();

        // Typing cancellation is now handled exclusively by clicking the Type button again
        // or through the cancel method, allowing users to click into editors to focus them.
    }

    async handleStreamCaptureRequest() {
        if (this.isProcessingQueue) return;
        
        logger.info('Handling stream capture request from hotkey...');
        this.captureButton.classList.add('capturing');
        
        try {
            const dataUrl = await this.captureFrame();
            if (dataUrl) {
                logger.info('Sending hotkey capture for analysis...');
                // For hotkey, we send immediately and clear any existing queue to ensure fresh context
                await window.electronAPI.processScreenshotData({ 
                    dataUrl: dataUrl,
                    imageQueue: [dataUrl] 
                });
                
                this.capturedImages = [];
                this.updateCaptureQueueUI();
            }
        } catch (error) {
            logger.error('Stream capture request failed', { error: error.message });
        } finally {
            this.captureButton.classList.remove('capturing');
        }
    }

    handleInteractionModeChanged(interactive) {
        this.isInteractive = interactive;
        this.updateAllElementStates();
        this.updateSkillIndicator();
    }

    handleSkillChanged(data) {
        this.currentSkill = data.skill;
        this.updateSkillIndicator();
    }

    updateSkillIndicator() {
        const skillNames = {
            'general': 'General',
            'dsa': 'DSA',
            'behavioral': 'Behavioral', 
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };
        
        if (!this.skillIndicator) return;
        
        const skillName = skillNames[this.currentSkill] || this.currentSkill.toUpperCase();
        const skillSpan = this.skillIndicator.querySelector('span');
        
        if (skillSpan) {
            skillSpan.textContent = skillName;
                        
            const tooltip = this.isInteractive ? 
                `${skillName} - Use Ctrl+Up/Down to navigate skills` : 
                `${skillName} - Enable interactive mode (F8) to navigate`;
            this.skillIndicator.title = tooltip;
            
            this.animateSkillChange();
        }
    }

    animateSkillChange() {
        if (this.skillIndicator) {
            this.skillIndicator.style.transform = 'scale(1.1)';
            this.skillIndicator.style.transition = 'transform 0.2s ease';
            
            setTimeout(() => {
                this.skillIndicator.style.transform = 'scale(1)';
            }, 200);
        }
    }

    navigateSkill(direction) {
        if (!this.isInteractive) return;
        
        const currentIndex = this.availableSkills.indexOf(this.currentSkill);
        if (currentIndex === -1) return;
        
        let newIndex = currentIndex + direction;
        if (newIndex >= this.availableSkills.length) {
            newIndex = 0;
        } else if (newIndex < 0) {
            newIndex = this.availableSkills.length - 1;
        }
        
        const newSkill = this.availableSkills[newIndex];
        this.currentSkill = newSkill;
        this.updateSkillIndicator();
        
        if (window.electronAPI && window.electronAPI.updateActiveSkill) {
            window.electronAPI.updateActiveSkill(newSkill);
        }
        
        this.showSkillChangeNotification(newSkill, direction);
    }

    showSkillChangeNotification(skill, direction) {
        const skillNames = {
            'general': 'General',
            'dsa': 'DSA',
            'behavioral': 'Behavioral', 
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };
        
        const displayName = skillNames[skill] || skill.toUpperCase();
        const arrow = direction > 0 ? '\u2193' : '\u2191';
        
        const notification = document.createElement('div');
        notification.className = 'skill-change-notification';
        notification.textContent = `${arrow} ${displayName}`;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 200);
        }, 1000);
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.metaKey && e.key === '\\') {
                this.isHidden = !this.isHidden;
            }
            
            if ((e.metaKey || e.ctrlKey) && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();

                if (this.isInteractive) {
                    if (e.key === 'ArrowUp') {
                        this.navigateSkill(-1);
                    } else if (e.key === 'ArrowDown') {
                        this.navigateSkill(1);
                    }
                } else {
                    this.moveWindow(e.key);
                }
            }
        });
    }

    setupSettingsShortcut() {
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                e.preventDefault();
                this.openSettings();
            }
        });
    }

    moveWindow(direction) {
        const moveDistance = 10; // Reduced distance for smoother keyboard movement
        
        if (window.electronAPI && window.electronAPI.moveWindow) {
            let deltaX = 0, deltaY = 0;
            
            switch(direction) {
                case 'ArrowUp':
                    deltaY = -moveDistance;
                    break;
                case 'ArrowDown':
                    deltaY = moveDistance;
                    break;
                case 'ArrowLeft':
                    deltaX = -moveDistance;
                    break;
                case 'ArrowRight':
                    deltaX = moveDistance;
                    break;
            }
            
            window.electronAPI.moveWindow(deltaX, deltaY);
        }
    }

    setupDragging() {
        const dragArea = document.querySelector('.command-tab');
        if (!dragArea) return;

        let isDragging = false;
        let startX, startY;

        dragArea.addEventListener('mousedown', (e) => {
            // Only drag if not clicking a command item (button) or status dot
            if (e.target.closest('.command-item') || e.target.closest('.status-dot')) return;
            
            isDragging = true;
            startX = e.screenX;
            startY = e.screenY;
            
            // Prevent text selection during drag
            e.preventDefault();
            
            // Add global listeners for smooth tracking
            const onMouseMove = (moveEvent) => {
                if (!isDragging) return;

                const deltaX = moveEvent.screenX - startX;
                const deltaY = moveEvent.screenY - startY;

                if (deltaX !== 0 || deltaY !== 0) {
                    if (window.electronAPI && window.electronAPI.moveWindow) {
                        window.electronAPI.moveWindow(deltaX, deltaY);
                    }
                    startX = moveEvent.screenX;
                    startY = moveEvent.screenY;
                }
            };

            const onMouseUp = () => {
                isDragging = false;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                document.body.style.cursor = 'default';
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'grabbing';
        });

        // Visually indicate draggable area on hover if in interactive mode
        dragArea.addEventListener('mouseenter', () => {
            if (!this.isInteractive) {
                dragArea.style.cursor = 'grab';
            }
        });
    }

    openSettings() {
        try {
            if (window.electronAPI && window.electronAPI.showSettings) {
                window.electronAPI.showSettings();
            }
            
            if (this.settingsIndicator) {
                this.settingsIndicator.style.transform = 'scale(1.1)';
                this.settingsIndicator.style.transition = 'transform 0.2s ease';
                
                setTimeout(() => {
                    this.settingsIndicator.style.transform = 'scale(1)';
                }, 200);
            }
        } catch (error) {
            logger.error('Failed to open settings', { error: error.message });
        }
    }

    showSettingsMenu() {
        const menu = document.createElement('div');
        menu.className = 'settings-menu';
        menu.style.cssText = `
            position: absolute;
            right: 10px;
            top: 35px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 0;
            min-width: 150px;
            z-index: 1000;
        `;

        const settingsOption = this.createMenuItem('Settings', 'fa-cog', () => {
            this.openSettings();
            document.body.removeChild(menu);
        });

        const quitOption = this.createMenuItem('Quit Vysper', 'fa-power-off', () => {
            if (window.electronAPI) {
                window.electronAPI.quit();
            }
        });

        menu.appendChild(settingsOption);
        menu.appendChild(this.createMenuSeparator());
        menu.appendChild(quitOption);

        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !this.settingsIndicator.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);

        document.body.appendChild(menu);
    }

    createMenuItem(text, iconClass, onClick) {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 8px 16px;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        `;
        item.innerHTML = `<i class="fas ${iconClass}"></i>${text}`;
        item.addEventListener('mouseover', () => {
            item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseout', () => {
            item.style.background = 'transparent';
        });
        item.addEventListener('click', onClick);
        return item;
    }

    createMenuSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 8px 0;
        `;
        return separator;
    }
}

// Initialize when DOM is ready
let mainWindowUI;
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        mainWindowUI = new MainWindowUI();
        window.mainWindowUI = mainWindowUI;
    });
}
