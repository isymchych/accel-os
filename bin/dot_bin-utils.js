const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

async function execLocalTool(name) {
  let currentPath = process.cwd();

  while (currentPath !== '/') {
    const bin = path.join(currentPath, 'node_modules', '.bin', name);
    if (fs.existsSync(bin)) {
      const child = childProcess.spawn(bin, process.argv.slice(2), {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });

      return await new Promise((resolve) => {
        child.on('exit', resolve);
      });
    } else {
      currentPath = path.dirname(currentPath);
    }
  }

  console.error(`Can't find local tool ${name}`);

  return -1;
}

module.exports = {
  execLocalTool,
};
