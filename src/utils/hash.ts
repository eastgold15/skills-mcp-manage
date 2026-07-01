import fs from 'fs-extra';
import crypto from 'crypto';

export async function calculateDirectoryHash(dirPath: string): Promise<string> {
  const hash = crypto.createHash('sha1');
  
  const files = await getSortedFiles(dirPath);
  
  for (const file of files) {
    const filePath = `${dirPath}/${file}`;
    const stat = await fs.stat(filePath);
    
    if (stat.isDirectory()) {
      continue;
    }
    
    const content = await fs.readFile(filePath);
    hash.update(content);
    hash.update(file);
    hash.update(stat.size.toString());
    hash.update(stat.mtime.toString());
  }
  
  return hash.digest('hex');
}

async function getSortedFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath);
  const sorted = entries.sort();
  return sorted;
}

export async function calculateFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(content).digest('hex');
}