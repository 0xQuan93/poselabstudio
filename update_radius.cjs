const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dp = path.join(dir, f);
    let isDir = fs.statSync(dp).isDirectory();
    isDir ? walkDir(dp, callback) : callback(dp);
  });
}

walkDir('src', function(fp) {
  if (fp.endsWith('.css')) {
    let c = fs.readFileSync(fp, 'utf8');
    let u = c.replace(/border-radius:\s*0;?/g, 'border-radius: var(--radius-md);');
    if (c !== u) {
      fs.writeFileSync(fp, u, 'utf8');
      console.log('Updated CSS: ' + fp);
    }
  } else if (fp.endsWith('.tsx') || fp.endsWith('.ts')) {
    let c = fs.readFileSync(fp, 'utf8');
    let u = c.replace(/borderRadius:\s*(0|'0'|"0")/g, 'borderRadius: \'var(--radius-md)\'');
    if (c !== u) {
      fs.writeFileSync(fp, u, 'utf8');
      console.log('Updated TSX/TS: ' + fp);
    }
  }
});
