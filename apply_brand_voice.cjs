const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules')) { 
            results = results.concat(walk(file));
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) { 
            results.push(file);
        }
    });
    return results;
}

const files = walk('./src');

const replacements = [
    { regex: />Import</g, replace: '>Load<' },
    { regex: />Screenshot</g, replace: '>Capture<' },
    { regex: /"Screenshot"/g, replace: '"Capture"' },
    { regex: />Character</g, replace: '>Avatar<' },
    { regex: /"Character"/g, replace: '"Avatar"' },
    { regex: />Project</g, replace: '>Session<' },
    { regex: /"Project"/g, replace: '"Session"' },
    { regex: />Just /g, replace: '>' },
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    replacements.forEach(({ regex, replace }) => {
        content = content.replace(regex, replace);
    });

    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log('Updated Text: ' + file);
    }
});
