import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('packaging and distribution', () => {
  it('declares npm package entry points and exports', () => {
    expect(pkg.main).toBe('./dist/core/index.js');
    expect(pkg.types).toBe('./dist/core/index.d.ts');
    expect(pkg.exports['.'].types).toBe('./dist/core/index.d.ts');
    expect(pkg.exports['./server'].require).toBe('./dist/server.js');
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'migrations/', 'scripts/postinstall.js']));
    expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true });
    expect(pkg.peerDependencies).toMatchObject({
      '@modelcontextprotocol/sdk': expect.any(String),
      openai: expect.any(String),
    });
  });

  it('provides install, postinstall, binary, release, and Homebrew packaging paths', () => {
    expect(pkg.scripts.postinstall).toBe('node scripts/postinstall.js');
    expect(pkg.scripts['install:local']).toBe('node scripts/install.js');
    expect(pkg.scripts['build:binaries']).toBe('node scripts/package-binaries.js');
    expect(read('scripts/postinstall.js')).toContain('better-sqlite3');
    expect(read('scripts/install.js')).toContain('npm');
    expect(read('scripts/package-binaries.js')).toContain('node18-linux-x64');
    expect(read('.github/workflows/release.yml')).toContain('npm publish --provenance');
    expect(read('packaging/homebrew/gtom.rb')).toContain('class Gtom < Formula');
  });

  it('documents tag release notes and release procedure', () => {
    expect(read('docs/RELEASING.md')).toContain('git tag -a gtom-vX.Y.Z');
    expect(read('docs/releases/gtom-v0.1.0.md')).toContain('Initial production-parity package release');
  });

  it('does not depend on sibling workspace modules for packaged builds', () => {
    const forbidden = 'shared' + '/src';
    const sourceFiles = walk(path.join(root, 'src')).filter((file) => file.endsWith('.ts'));
    for (const file of sourceFiles) {
      expect(fs.readFileSync(file, 'utf8')).not.toContain(forbidden);
    }
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}
