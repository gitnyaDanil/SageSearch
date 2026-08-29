const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Open the file's containing folder in Windows Explorer.
 * Opening the folder is more reliable than explorer.exe /select,"path"
 * because Explorer may hand off /select requests to an existing shell
 * process without showing a visible window.
 * @param {string} filePath - Absolute path to the file
 */
function openInExplorer(filePath) {
  return new Promise((resolve) => {
    if (!filePath || typeof filePath !== 'string') {
      return resolve({ success: false, error: 'Path is required' });
    }

    const normalized = path.normalize(filePath);
    if (!fs.existsSync(normalized)) {
      return resolve({ success: false, error: 'File not found at path: ' + normalized });
    }

    try {
      const containingFolder = path.dirname(normalized);
      const child = spawn('explorer.exe', [containingFolder], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', (error) => resolve({ success: false, error: error.message }));
      child.once('spawn', () => {
        child.unref();
        resolve({
          success: true,
          message: `Opened Explorer folder: ${containingFolder}`,
          path: normalized,
        });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * Open a file with its default Windows application.
 * @param {string} filePath - Absolute path to the file
 */
function openFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath || typeof filePath !== 'string') {
      return resolve({ success: false, error: 'Path is required' });
    }

    const normalized = path.normalize(filePath);
    if (!fs.existsSync(normalized)) {
      return resolve({ success: false, error: 'File not found at path: ' + normalized });
    }

    try {
      const child = spawn('cmd.exe', ['/c', 'start', '""', normalized], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', (error) => resolve({ success: false, error: error.message }));
      child.once('spawn', () => {
        child.unref();
        resolve({ success: true, message: `Opened: ${path.basename(normalized)}` });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
}

module.exports = { openInExplorer, openFile };
