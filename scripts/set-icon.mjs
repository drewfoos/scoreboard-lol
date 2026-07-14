// Stamps the crest icon and version metadata onto the packaged exe.
// Uses resedit (pure JS) — rcedit corrupts pkg binaries by shifting the
// appended JS payload; resedit is the community-verified safe tool.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exePath = path.join(root, 'dist', 'LoL-Scoreboard.exe');
const icoPath = path.join(root, 'assets', 'icon.ico');
const LANG = 1033; // en-US

const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

// icon
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries, 1, LANG, ico.icons.map((i) => i.data));

// version info
const vi = ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(1, 0, 0, 0, LANG);
vi.setProductVersion(1, 0, 0, 0, LANG);
vi.setStringValues({ lang: LANG, codepage: 1200 }, {
  ProductName: 'LoL Scoreboard',
  FileDescription: 'LoL Scoreboard — esports broadcast overlay',
  CompanyName: 'scoreboard-lol',
  OriginalFilename: 'LoL-Scoreboard.exe',
  FileVersion: '1.0.0',
  ProductVersion: '1.0.0',
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);

// Flip PE subsystem console -> GUI so launching the app opens no terminal
// window; the control panel window is the app's only visible surface.
exe.newHeader.optionalHeader.subsystem = 2; // IMAGE_SUBSYSTEM_WINDOWS_GUI

fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('exe icon + version info stamped, subsystem set to GUI (resedit)');
