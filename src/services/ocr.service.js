const { desktopCapturer, nativeImage } = require('electron');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const logger = require('../core/logger').createServiceLogger('OCR');
const config = require('../core/config');

class OCRService {
  constructor() {
    this.isProcessing = false;
    this.tempFiles = new Set();
  }

  async captureAndProcess() {
    if (this.isProcessing) {
      throw new Error('OCR operation already in progress');
    }

    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      logger.info('Starting screenshot capture and OCR processing');
      
      const screenshot = await this.captureScreenshot();
      
      // Get base64 image data for vision API
      const imageBuffer = screenshot.image.toPNG();
      const imageBase64 = imageBuffer.toString('base64');
      
      // Still perform OCR as a fallback/supplement
      const extractedText = await this.performOCR(screenshot);
      
      logger.logPerformance('OCR processing', startTime, {
        textLength: extractedText.length,
        hasContent: extractedText.trim().length > 0,
        imageBase64Length: imageBase64.length
      });

      return {
        text: extractedText.trim(),
        imageBase64,
        metadata: {
          timestamp: new Date().toISOString(),
          source: screenshot.metadata,
          processingTime: Date.now() - startTime
        }
      };
    } finally {
      this.isProcessing = false;
      this.cleanup();
    }
  }

  async captureScreenshot() {
    // Try desktopCapturer first (works on X11 and Wayland with proper Electron flags)
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 3840, height: 2160 }
      });

      if (sources.length > 0) {
        const primarySource = sources[0];
        const image = primarySource.thumbnail;

        if (image && !image.isEmpty()) {
          logger.debug('Screenshot captured via desktopCapturer', {
            sourceName: primarySource.name,
            imageSize: image.getSize()
          });

          return {
            image,
            metadata: {
              sourceName: primarySource.name,
              dimensions: image.getSize(),
              captureTime: new Date().toISOString(),
              method: 'desktopCapturer'
            }
          };
        }
      }

      logger.warn('desktopCapturer returned empty results, trying Linux fallback');
    } catch (error) {
      logger.warn('desktopCapturer failed, trying Linux fallback', {
        error: error.message
      });
    }

    // Fallback: Use Linux command-line screenshot tools
    return this.captureLinuxFallback();
  }

  /**
   * Linux/Wayland fallback for screenshot capture.
   * Tries grim (Wayland), gnome-screenshot, spectacle, scrot, import (ImageMagick).
   */
  captureLinuxFallback() {
    const tempPath = path.join(
      os.tmpdir(),
      `Vysper-screenshot-${Date.now()}.png`
    );

    const tools = [
      {
        name: 'grim',
        cmd: `grim "${tempPath}"`,
        description: 'Wayland native screenshot tool (Sway/wlroots)'
      },
      {
        name: 'gnome-screenshot',
        cmd: `gnome-screenshot -f "${tempPath}"`,
        description: 'GNOME screenshot utility'
      },
      {
        name: 'spectacle',
        cmd: `spectacle -b -n -f -o "${tempPath}"`,
        description: 'KDE screenshot utility'
      },
      {
        name: 'scrot',
        cmd: `scrot "${tempPath}"`,
        description: 'X11 screenshot tool'
      },
      {
        name: 'import',
        cmd: `import -window root "${tempPath}"`,
        description: 'ImageMagick screenshot'
      }
    ];

    for (const tool of tools) {
      try {
        execSync(tool.cmd, { timeout: 5000, stdio: 'pipe' });

        if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
          const fileBuffer = fs.readFileSync(tempPath);
          const image = nativeImage.createFromBuffer(fileBuffer);

          if (!image.isEmpty()) {
            logger.info(`Screenshot captured via ${tool.name}`, {
              method: tool.name,
              imageSize: image.getSize()
            });

            // Clean up temp file after reading
            try {
              fs.unlinkSync(tempPath);
            } catch {}

            return {
              image,
              metadata: {
                sourceName: tool.name,
                dimensions: image.getSize(),
                captureTime: new Date().toISOString(),
                method: tool.name
              }
            };
          }
        }
      } catch (error) {
        logger.debug(`${tool.name} not available or failed`, {
          tool: tool.name,
          error: error.message
        });
      }
    }

    // Clean up temp file if created
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}

    throw new Error(
      'Screenshot capture failed on Linux. Install one of: grim (Wayland), ' +
      'gnome-screenshot, spectacle, scrot, or ImageMagick. ' +
      'For Wayland, run with: ./start-linux.sh or --enable-features=UseOzonePlatform --ozone-platform=wayland'
    );
  }

  async performOCR(screenshot) {
    const tempPath = this.createTempFile(screenshot.image);
    
    try {
      logger.debug('Starting OCR text extraction', { tempPath });
      
      const { data: { text } } = await Tesseract.recognize(tempPath, config.get('ocr.language'), {
        logger: progress => {
          if (progress.status === 'recognizing text') {
            logger.debug(`OCR progress: ${Math.round(progress.progress * 100)}%`);
          }
        }
      });

      const cleanText = this.sanitizeText(text);
      
      logger.info('OCR text extraction completed', {
        originalLength: text.length,
        cleanedLength: cleanText.length,
        wordsExtracted: cleanText.split(/\s+/).filter(w => w.length > 0).length
      });

      return cleanText;
    } catch (error) {
      logger.error('OCR processing failed', { error: error.message, tempPath });
      throw new Error(`Text extraction failed: ${error.message}`);
    }
  }

  createTempFile(image) {
    const tempPath = path.join(
      config.get('ocr.tempDir'), 
      `Vysper-screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
    );
    
    const buffer = image.toPNG();
    fs.writeFileSync(tempPath, buffer);
    
    this.tempFiles.add(tempPath);
    logger.debug('Temporary screenshot file created', { tempPath, size: buffer.length });
    
    return tempPath;
  }

  sanitizeText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();
  }

  cleanup() {
    for (const tempFile of this.tempFiles) {
      try {
        fs.unlinkSync(tempFile);
        logger.debug('Cleaned up temporary file', { file: tempFile });
      } catch (error) {
        logger.warn('Failed to cleanup temporary file', { 
          file: tempFile, 
          error: error.message 
        });
      }
    }
    this.tempFiles.clear();
  }

  async performOCRFromBuffer(buffer) {
    const tempPath = path.join(
      config.get('ocr.tempDir'), 
      `Vysper-ocr-buffer-${Date.now()}.png`
    );
    
    try {
      fs.writeFileSync(tempPath, buffer);
      const { data: { text } } = await Tesseract.recognize(tempPath, config.get('ocr.language'));
      const cleanText = this.sanitizeText(text);
      
      try { fs.unlinkSync(tempPath); } catch {}
      
      return cleanText;
    } catch (error) {
      logger.error('OCR from buffer failed', { error: error.message });
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      return "";
    }
  }
}

module.exports = new OCRService();
