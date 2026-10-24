import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

for (const module of ['kinesiology-evaluations', 'patient-assignments']) {
  test(`${module} preserves inward dependencies and a compatibility-only barrel`, () => {
    const root = `src/modules/${module}`;
    const barrel = readFileSync(`${root}/index.ts`, 'utf8');
    assert.doesNotMatch(barrel, /\b(class|function|interface)\b/, 'barrel must not implement behavior');
    for (const layer of ['domain', 'application']) {
      const paths = sources(`${root}/${layer}`);
      assert.ok(paths.length > 0, `${layer} must be explicit`);
      for (const path of paths) {
        const content = readFileSync(path, 'utf8');
        assert.doesNotMatch(content, /from\s+['"](?:express|pg)['"]|\/infrastructure\/|\bQueryable\b|\bSELECT\b|\bINSERT INTO\b/);
        if (layer === 'domain') assert.doesNotMatch(content, /\/application\//);
      }
    }
    for (const path of sources(`${root}/infrastructure/routes`)) {
      const content = readFileSync(path, 'utf8');
      assert.doesNotMatch(content, /Pg\w+Repository|repository\.(?:create|edit|submit|reassign|end|list)/);
      assert.match(content, /application\//);
    }
  });
}
