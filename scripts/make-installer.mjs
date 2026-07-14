// Locates the Inno Setup compiler and builds the installer from installer.iss.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const candidates = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
];

const iscc = candidates.find((p) => p && fs.existsSync(p));
if (!iscc) {
  console.error('Inno Setup 6 not found. Install it: winget install -e --id JRSoftware.InnoSetup');
  process.exit(1);
}

execFileSync(iscc, ['installer.iss'], { stdio: 'inherit' });
