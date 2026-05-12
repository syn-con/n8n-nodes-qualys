const fs = require('node:fs');
const path = require('node:path');

const targets = [
  ['nodes', 'Qualys'],
  ['credentials'],
];

for (const targetParts of targets) {
  const sourceDir = path.resolve(...targetParts);
  const destinationDir = path.resolve('dist', ...targetParts);
  copyIcons(sourceDir, destinationDir);
}

function copyIcons(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copyIcons(sourcePath, destinationPath);
      continue;
    }

    if (!/\.(svg|png)$/i.test(entry.name)) {
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}
