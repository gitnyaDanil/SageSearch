const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Open Windows Explorer with the file highlighted/selected.
 * Uses PowerShell Start-Process / explorer.exe /select,"path" command.
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

    const psCmd = `powershell -NoProfile -Command "Start-Process explorer.exe -ArgumentList '/select,\\"${normalized}\\"'"`;

    exec(psCmd, (error) => {
      if (error) {
        try {
          const child = spawn('explorer.exe', [`/select,${normalized}`], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return resolve({ success: true, message: `Opened Explorer for: ${path.basename(normalized)}` });
        } catch (spawnErr) {
          return resolve({ success: false, error: spawnErr.message });
        }
      }
      resolve({ success: true, message: `Opened Explorer for: ${path.basename(normalized)}` });
    });
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

    exec(`powershell -NoProfile -Command "Start-Process -FilePath \\"${normalized}\\""`, (error) => {
      if (error) {
        try {
          const child = spawn('cmd.exe', ['/c', 'start', '""', normalized], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return resolve({ success: true, message: `Opened: ${path.basename(normalized)}` });
        } catch (spawnErr) {
          return resolve({ success: false, error: spawnErr.message });
        }
      }
      resolve({ success: true, message: `Opened: ${path.basename(normalized)}` });
    });
  });
}

module.exports = { openInExplorer, openFile };
