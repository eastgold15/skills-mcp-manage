import { spawn } from 'child_process';
import path from 'path';

export async function openMergeEditor(
  oursPath: string,
  theirsPath: string,
  basePath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['--wait', '--merge', oursPath, theirsPath, basePath, outputPath];
    const editor = spawn('code', args);
    
    editor.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code exited with code ${code}`));
      }
    });
    
    editor.on('error', (error) => {
      reject(error);
    });
  });
}

export async function openFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const editor = spawn('code', ['--wait', filePath]);
    
    editor.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code exited with code ${code}`));
      }
    });
    
    editor.on('error', (error) => {
      reject(error);
    });
  });
}