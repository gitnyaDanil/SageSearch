const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Open Windows Explorer with the file highlighted/selected.
 * Uses the native `explorer /select,"path"` command.
 * @param {string} filePath - Absolute path to the file
 */
function openInExplorer(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      return resolve({ success: false, error: 'File not found at path: ' + filePath });
    }

    // Wrap in quotes to handle spaces in paths
    const cmd = `explorer /select,"${filePath}"`;

    exec(cmd, (error) => {
      if (error) {
        // Explorer sometimes returns a non-zero exit code even on success — check the error message
        if (error.code === 1) {
          // This is normal for explorer.exe on Windows
          return resolve({ success: true, message: `Opened Explorer for: ${path.basename(filePath)}` });
        }
        return resolve({ success: false, error: error.message });
      }
      resolve({ success: true, message: `Opened Explorer for: ${path.basename(filePath)}` });
    });
  });
}

/**
 * Open a file with its default Windows application.
 * @param {string} filePath - Absolute path to the file
 */
function openFile(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      return resolve({ success: false, error: 'File not found at path: ' + filePath });
    }

    // `start ""` opens with the default associated app
    const cmd = `start "" "${filePath}"`;

    exec(cmd, { shell: 'cmd.exe' }, (error) => {
      if (error) {
        return resolve({ success: false, error: error.message });
      }
      resolve({ success: true, message: `Opened: ${path.basename(filePath)}` });
    });
  });
}

module.exports = { openInExplorer, openFile };
